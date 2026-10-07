// Browser font provider: lazy-loads catalog web fonts via the CSS
// Font Loading API and notifies subscribers when a face is ready so the canvas
// reflows from the fallback to the real typeface. Mirrors the imageAssets
// provider pattern. System fonts need no loading. Workspace fonts (uploaded
// by an admin, one file per face) register here as well and take precedence
// over a catalog or system family of the same name: they are the files the
// workspace's designs are meant to use.

import type { DesignFile, Node } from "@hc/schema";
import { getFontEntry, fontCssUrl, isSystemFont } from "@hc/text";

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

/** One face of a workspace font family. */
export interface WorkspaceFace {
  id: string;
  family: string;
  weight: number;
  style: "normal" | "italic";
}

class FontProvider {
  // Workspace fonts: key (lowercased family) -> faces; bytes fetched once.
  private ws = new Map<string, WorkspaceFace[]>();
  private wsBytes = new Map<string, Promise<Uint8Array>>();
  private wsFetch: ((id: string) => Promise<Uint8Array>) | null = null;
  private loaded = new Set<string>();
  private loading = new Set<string>();
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
    return this.isReady(family) || !this.loading.has((family ?? "").toLowerCase());
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

  /** The file of the workspace face closest to a weight/style (for exports
   *  that embed glyph outlines); null when the family is not a workspace one. */
  async workspaceFaceBytes(family: string, weight: number, italic: boolean): Promise<Uint8Array | null> {
    const faces = this.ws.get(family.toLowerCase());
    if (!faces?.length) return null;
    const styled = faces.filter((f) => (f.style === "italic") === italic);
    const pool = styled.length ? styled : faces;
    const best = pool.reduce((a, b) => (Math.abs(b.weight - weight) < Math.abs(a.weight - weight) ? b : a));
    return this.faceBytes(best.id);
  }

  private loadWorkspaceFamily(key: string): void {
    const faces = this.ws.get(key);
    if (!faces || typeof document === "undefined" || typeof FontFace === "undefined") return;
    this.loading.add(key);
    void Promise.all(faces.map(async (f) => {
      const bytes = await this.faceBytes(f.id);
      const face = new FontFace(f.family, bytes.slice().buffer, { weight: String(f.weight), style: f.style });
      await face.load();
      (document as unknown as { fonts: { add: (f: FontFace) => void } }).fonts.add(face);
    })).then(
      () => { this.loading.delete(key); this.loaded.add(key); this.notify(); },
      () => { this.loading.delete(key); this.notify(); },
    );
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
    try {
      const face = new FontFace(family, `url(${src})`);
      await face.load();
      (document as unknown as { fonts: { add: (f: FontFace) => void } }).fonts.add(face);
      this.loaded.add(key);
      this.custom.set(key, { family, src });
      if (persist) this.persistCustom();
      this.notify();
      return true;
    } catch {
      return false;
    }
  }

  private persistCustom(): void {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(CUSTOM_FONTS_KEY, JSON.stringify([...this.custom.values()])); } catch { /* quota: skip persistence */ }
  }

  /** Ensure a family is loading/loaded; repaints subscribers when it arrives. */
  ensure(family: string | undefined): void {
    const wsKey = (family ?? "").toLowerCase();
    if (this.ws.has(wsKey)) {
      if (!this.loaded.has(wsKey) && !this.loading.has(wsKey)) this.loadWorkspaceFamily(wsKey);
      return;
    }
    if (isSystemFont(family) || typeof document === "undefined") return;
    const key = family!.toLowerCase();
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
          for (const para of (n as unknown as { content: { runs: { style: { fontFamily?: string } }[] }[] }).content) {
            for (const run of para.runs) this.ensure(run.style.fontFamily);
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
