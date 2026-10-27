// Browser font provider: lazy-loads catalog web fonts via the CSS
// Font Loading API and notifies subscribers when a face is ready so the canvas
// reflows from the fallback to the real typeface. Mirrors the imageAssets
// provider pattern. System fonts need no loading. Workspace fonts (uploaded
// by an admin, one file per face) register here as well and take precedence
// over a catalog or system family of the same name: they are the files the
// workspace's designs are meant to use.

import type { DesignFile, Node } from "@hc/schema";
import { getFontEntry, fontCssUrl, isSystemFont } from "@hc/text";
import { weightFromFontStyle } from "@hc/engine";

const CUSTOM_FONTS_KEY = "oc-custom-fonts";

// The only hosts a webfont stylesheet may load from. fontCssUrl builds URLs on
// exactly these (Bunny is the default, Google optional); a non-empty href off
// this list should be impossible, so we drop it rather than inject it.
const FONT_CSS_HOST_ALLOWLIST = new Set(["fonts.bunny.net", "fonts.googleapis.com"]);

/** True only for an https URL on the webfont-CSS host allowlist. */
function isAllowedFontCssHref(href: string): boolean {
  if (!href) return false;
  try {
    const u = new URL(href);
    return u.protocol === "https:" && FONT_CSS_HOST_ALLOWLIST.has(u.hostname);
  } catch {
    return false;
  }
}

/** A face of a family a design draws with: weight and slant. */
export interface FaceWant {
  weight: number;
  italic: boolean;
}

/** One face of a workspace font family. */
export interface WorkspaceFace {
  id: string;
  family: string;
  weight: number;
  style: "normal" | "italic";
}

export type RunFont = { fontFamily?: string; fontStyle?: string; axes?: Record<string, number> };

/** The face a text run draws with, matched the way canvasFontString names it. */
export function faceOf(style: RunFont): FaceWant {
  const weight = style.axes?.wght ?? weightFromFontStyle(style.fontStyle);
  const italic = (style.axes?.ital ?? 0) >= 0.5 || (style.axes?.slnt ?? 0) < 0 || /italic|oblique/i.test(style.fontStyle ?? "");
  return { weight, italic };
}

class FontProvider {
  // Workspace fonts: key (lowercased family) -> faces; bytes fetched once.
  private ws = new Map<string, WorkspaceFace[]>();
  private wsBytes = new Map<string, Promise<Uint8Array>>();
  private wsFetch: ((id: string) => Promise<Uint8Array>) | null = null;
  private loaded = new Set<string>();
  private loading = new Set<string>();
  /** Workspace faces whose file the browser refused: not tried again. */
  private wsFailed = new Set<string>();
  // Catalog faces beyond the first: the stylesheet names every face, but the
  // browser fetches one only when asked, and canvas text drawn before then
  // uses the fallback. Keyed `family|weight|italic`.
  private sheetReady = new Set<string>();
  private wanted = new Map<string, Map<string, FaceWant>>();
  private faceLoading = new Set<string>();
  private faceDone = new Set<string>();
  private faceMissing = new Set<string>();
  private subs = new Set<() => void>();
  // Uploaded fonts (FR-6): key (lowercased family) -> { family, src (data URL) }.
  private custom = new Map<string, { family: string; src: string }>();

  constructor() {
    if (typeof window === "undefined") return;
    try {
      const saved = JSON.parse(window.localStorage.getItem(CUSTOM_FONTS_KEY) || "[]") as { family: string; src: string }[];
      for (const f of saved) void this.registerCustomFont(f.family, f.src, false);
    } catch { /* ignore corrupt store */ }
  }

  /** Whether this app can render a family at all: a workspace font, a catalog
   *  font or a system font (used to pick the usable entry of a CSS font list). */
  knows(family: string): boolean {
    const key = family.toLowerCase();
    return this.ws.has(key) || !!getFontEntry(family) || isSystemFont(family);
  }

  /** Whether a family's web font is loaded and ready to render. */
  isReady(family: string | undefined): boolean {
    const key = (family ?? "").toLowerCase();
    if (this.ws.has(key)) return this.loaded.has(key);
    return isSystemFont(family) || this.loaded.has(key);
  }

  /** Whether a family is done loading, successfully or not: a family that is
   *  unknown, or whose file failed, will never become ready, so waiting for
   *  it (exports outside the editor) must not block. */
  isSettled(family: string | undefined): boolean {
    const key = (family ?? "").toLowerCase();
    if (!this.isReady(family) && this.loading.has(key)) return false;
    for (const k of this.faceLoading) if (k.startsWith(`${key}|`)) return false;
    return true;
  }

  /** Whether the canvas draws a face with its own font: "failed" when the
   *  family is unknown here or its file did not load, so a fallback font
   *  draws it (unless the family happens to be installed on this device). */
  faceState(family: string | undefined, face: FaceWant): "ready" | "loading" | "failed" {
    if (isSystemFont(family)) return "ready";
    const key = family!.toLowerCase();
    if (this.loading.has(key)) return "loading";
    if (!this.loaded.has(key)) return "failed";
    if (this.ws.has(key)) {
      const f = this.closestFace(key, face.weight, face.italic);
      return f && this.wsFailed.has(f.id) ? "failed" : "ready";
    }
    if (this.custom.has(key)) return "ready";
    const k = `${key}|${face.weight}|${face.italic ? 1 : 0}`;
    if (this.faceLoading.has(k)) return "loading";
    return this.faceMissing.has(k) ? "failed" : "ready";
  }

  /** Install the workspace's font library (replaces the previous one). */
  setWorkspaceFonts(faces: WorkspaceFace[], fetchFile: (id: string) => Promise<Uint8Array>): void {
    this.wsFetch = fetchFile;
    const next = new Map<string, WorkspaceFace[]>();
    for (const f of faces) {
      const key = f.family.toLowerCase();
      next.set(key, [...(next.get(key) ?? []), f]);
    }
    // A family whose faces changed loads again on next use.
    for (const key of new Set([...this.ws.keys(), ...next.keys()])) {
      const a = (this.ws.get(key) ?? []).map((f) => f.id).sort().join();
      const b = (next.get(key) ?? []).map((f) => f.id).sort().join();
      if (a !== b) { this.loaded.delete(key); this.loading.delete(key); }
    }
    this.ws = next;
    this.notify();
  }

  /** Family names of the workspace font library, sorted. */
  workspaceFamilies(): string[] {
    return [...this.ws.values()].map((faces) => faces[0].family).sort((a, b) => a.localeCompare(b));
  }

  isWorkspaceFamily(family: string | undefined): boolean {
    return this.ws.has((family ?? "").toLowerCase());
  }

  private faceBytes(id: string): Promise<Uint8Array> {
    let p = this.wsBytes.get(id);
    if (!p) {
      if (!this.wsFetch) return Promise.reject(new Error("no workspace font source"));
      p = this.wsFetch(id).catch((e: unknown) => { this.wsBytes.delete(id); throw e; });
      this.wsBytes.set(id, p);
    }
    return p;
  }

  /** The workspace face closest to a weight/style and its file (for exports
   *  that embed glyph outlines); null when the family is not a workspace one.
   *  The face's own weight and style say what the browser has to synthesize. */
  async workspaceFace(family: string, weight: number, italic: boolean): Promise<{ bytes: Uint8Array; weight: number; italic: boolean } | null> {
    const best = this.closestFace(family.toLowerCase(), weight, italic);
    if (!best) return null;
    return { bytes: await this.faceBytes(best.id), weight: best.weight, italic: best.style === "italic" };
  }

  /** The workspace face drawn for a weight and style: the same style if the
   *  family has it, then the nearest weight. */
  private closestFace(key: string, weight: number, italic: boolean): WorkspaceFace | null {
    const faces = this.ws.get(key);
    if (!faces?.length) return null;
    const styled = faces.filter((f) => (f.style === "italic") === italic);
    const pool = styled.length ? styled : faces;
    return pool.reduce((a, b) => (Math.abs(b.weight - weight) < Math.abs(a.weight - weight) ? b : a));
  }

  private loadWorkspaceFamily(key: string): void {
    const faces = this.ws.get(key);
    if (!faces || typeof document === "undefined" || typeof FontFace === "undefined") return;
    this.loading.add(key);
    // Each face on its own: one file the browser refuses must neither keep
    // the family's other faces from being used nor be fetched again and again.
    // A file that could not be fetched is tried again on the next use.
    let fetchFailed = false;
    void Promise.all(faces.map(async (f) => {
      if (this.wsFailed.has(f.id)) return;
      let bytes: Uint8Array;
      try { bytes = await this.faceBytes(f.id); } catch { fetchFailed = true; return; }
      try {
        const face = new FontFace(f.family, bytes.slice().buffer, { weight: String(f.weight), style: f.style });
        await face.load();
        (document as unknown as { fonts: { add: (f: FontFace) => void } }).fonts.add(face);
      } catch {
        this.wsFailed.add(f.id);
      }
    })).then(() => {
      this.loading.delete(key);
      if (!fetchFailed) this.loaded.add(key);
      this.notify();
    });
  }

  /** The source (data URL or URL) of an uploaded custom font, for exports
   *  that need the font file itself (vector PDF glyph outlines). */
  customSource(family: string): string | undefined {
    return this.custom.get(family.toLowerCase())?.src;
  }

  /** Family names of all uploaded custom fonts (for the picker). */
  customFamilies(): string[] {
    return [...this.custom.values()].map((f) => f.family);
  }

  /** Load an uploaded font (data URL) into document.fonts so the canvas can draw
   *  it, and (by default) persist it across sessions. Returns true on success. */
  async registerCustomFont(family: string, src: string, persist = true): Promise<boolean> {
    if (typeof document === "undefined" || typeof FontFace === "undefined") return false;
    const key = family.toLowerCase();
    if (this.loaded.has(key) && this.custom.has(key)) return true; // already registered
    // Loading until the file is in, so isSettled (exports outside the editor)
    // waits for it instead of drawing the fallback font.
    this.loading.add(key);
    try {
      const face = new FontFace(family, `url(${src})`);
      await face.load();
      (document as unknown as { fonts: { add: (f: FontFace) => void } }).fonts.add(face);
      this.loaded.add(key);
      this.custom.set(key, { family, src });
      if (persist) this.persistCustom();
      return true;
    } catch {
      return false;
    } finally {
      this.loading.delete(key);
      this.notify();
    }
  }

  private persistCustom(): void {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(CUSTOM_FONTS_KEY, JSON.stringify([...this.custom.values()])); } catch { /* quota: skip persistence */ }
  }

  /** Fetch the wanted faces of a catalog family whose stylesheet is in. */
  private loadFaces(key: string, family: string): void {
    for (const [id, f] of this.wanted.get(key) ?? []) {
      const k = `${key}|${id}`;
      if (this.faceDone.has(k) || this.faceLoading.has(k)) continue;
      this.faceLoading.add(k);
      void document.fonts
        .load(`${f.italic ? "italic " : ""}${f.weight} 16px "${family}"`)
        .then((got) => got.length > 0, () => false)
        .then((ok) => {
          if (!ok) this.faceMissing.add(k);
          this.faceLoading.delete(k);
          this.faceDone.add(k);
          this.notify();
        });
    }
  }

  /** Ensure a family is loading/loaded; repaints subscribers when it arrives.
   *  `face` names a weight/slant the text uses, fetched as well. */
  ensure(family: string | undefined, face?: FaceWant): void {
    const wsKey = (family ?? "").toLowerCase();
    if (this.ws.has(wsKey)) {
      if (!this.loaded.has(wsKey) && !this.loading.has(wsKey)) this.loadWorkspaceFamily(wsKey);
      return;
    }
    if (isSystemFont(family) || typeof document === "undefined") return;
    const key = family!.toLowerCase();
    if (face) {
      const faces = this.wanted.get(key) ?? new Map<string, FaceWant>();
      faces.set(`${face.weight}|${face.italic ? 1 : 0}`, face);
      this.wanted.set(key, faces);
    }
    if (this.sheetReady.has(key)) this.loadFaces(key, family!);
    if (this.loaded.has(key) || this.loading.has(key)) return;
    const entry = getFontEntry(family!);
    if (!entry) return;
    this.loading.add(key);

    const probe = entry.weights.includes(400) ? 400 : entry.weights[0];
    // Actually fetch the face into document.fonts (canvas text does NOT trigger
    // font loading on its own), then repaint. document.fonts.load only works
    // once the @font-face rule exists, so it must run AFTER the stylesheet
    // loads, not before.
    const fetchFace = () => {
      void document.fonts
        .load(`${probe} 16px "${family}"`)
        .then(() => {
          this.loading.delete(key);
          this.loaded.add(key);
          this.sheetReady.add(key);
          this.loadFaces(key, family!);
          this.notify();
        })
        .catch(() => {
          this.loading.delete(key);
          this.notify();
        });
    };

    const id = `oc-font-${key.replace(/\s+/g, "-")}`;
    const existing = document.getElementById(id) as HTMLLinkElement | null;
    if (existing) {
      // Stylesheet already injected; the @font-face is (or will shortly be)
      // registered, so loading can start now.
      fetchFace();
      return;
    }
    const href = fontCssUrl(family!, entry.weights);
    // Defense in depth before the DOM sink: fontCssUrl only returns URLs on the
    // fixed webfont-CSS host allowlist (Bunny / Google), so anything else means
    // the input was not a catalog family and we do not inject a stylesheet.
    if (!isAllowedFontCssHref(href)) {
      this.loading.delete(key);
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.id = id;
    link.href = href;
    // Only load the face once the @font-face rules from the stylesheet exist.
    link.addEventListener("load", fetchFace);
    link.addEventListener("error", () => this.loading.delete(key));
    document.head.appendChild(link);
  }

  /** Preload every font family referenced by a design's text nodes. */
  ensureForDoc(doc: DesignFile): void {
    // Cross-device uploaded fonts: register any FontRef that carries a URL (an
    // uploaded font asset) so the canvas can draw it on this device too. Local
    // localStorage persistence is skipped (the design is the source of truth).
    const refs = (doc as unknown as { fonts?: { family?: string; url?: string; source?: string }[] }).fonts;
    if (Array.isArray(refs)) {
      for (const f of refs) {
        if (f.url && f.family && !this.loaded.has(f.family.toLowerCase())) {
          void this.registerCustomFont(f.family, f.url, false);
        }
      }
    }
    const walk = (nodes: Node[]) => {
      for (const n of nodes) {
        if (n.type === "text") {
          for (const para of (n as unknown as { content: { runs: { style: RunFont }[] }[] }).content) {
            for (const run of para.runs) this.ensure(run.style.fontFamily, faceOf(run.style));
          }
        }
        const kids = (n as unknown as { children?: Node[] }).children;
        if (Array.isArray(kids)) walk(kids);
      }
    };
    for (const page of doc.pages) walk(page.children);
  }

  onChange(cb: () => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  private notify(): void {
    for (const cb of this.subs) cb();
  }
}

/** Shared font provider for the editor canvas and export. */
export const fonts = new FontProvider();
