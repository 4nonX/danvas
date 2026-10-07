// Font binaries for the vector PDF export. The editor draws text with web
// fonts the browser loaded from the font CSS (Google Fonts / Bunny Fonts) or
// with uploaded custom fonts; the PDF needs the same font files to turn each
// glyph into a vector outline. This module fetches and parses them (fontkit,
// WOFF2 included) and answers "which parsed font draws this code point in
// family X, weight W, italic I".
//
// Web font CSS splits a face into unicode-range subsets (latin, latin-ext,
// cyrillic, ...), so one requested face can be several font files; a lookup
// returns all of them and the caller picks the subset that has the glyph.

import * as fontkit from "fontkit";
import { fontCssUrl, getFontEntry, isSystemFont } from "@hc/text";
import { fonts as fontProvider } from "@/lib/fontProvider";

export interface FaceRequest {
  family: string;
  weight: number;
  italic: boolean;
  /** CSS font-stretch percentage (100 = normal). */
  stretch: number;
}

/** The files that together draw one requested face. */
export interface LoadedFace {
  subsets: fontkit.Font[];
}

const fileCache = new Map<string, Promise<fontkit.Font | null>>();
const faceCache = new Map<string, Promise<LoadedFace | null>>();
const cssCache = new Map<string, Promise<string | null>>();

function faceKey(r: FaceRequest): string {
  return `${r.family.toLowerCase()}|${r.weight}|${r.italic ? 1 : 0}|${r.stretch}`;
}

async function loadFile(url: string): Promise<fontkit.Font | null> {
  let p = fileCache.get(url);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(url, { credentials: url.startsWith("data:") ? undefined : "omit" });
        if (!res.ok) return null;
        const parsed = fontkit.create(new Uint8Array(await res.arrayBuffer()));
        return "fonts" in parsed ? parsed.fonts[0] ?? null : parsed;
      } catch {
        return null;
      }
    })();
    fileCache.set(url, p);
  }
  return p;
}

async function loadCss(url: string): Promise<string | null> {
  let p = cssCache.get(url);
  if (!p) {
    p = fetch(url, { credentials: "omit" }).then((r) => (r.ok ? r.text() : null)).catch(() => null);
    cssCache.set(url, p);
  }
  return p;
}

interface CssFace {
  italic: boolean;
  weightMin: number;
  weightMax: number;
  url: string;
}

function parseFontFaces(css: string): CssFace[] {
  const out: CssFace[] = [];
  for (const block of css.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
    const style = /font-style:\s*([a-z]+)/i.exec(block)?.[1] ?? "normal";
    const weight = /font-weight:\s*(\d+)(?:\s+(\d+))?/i.exec(block);
    const url = /url\(\s*['"]?([^'")]+)['"]?\s*\)/i.exec(block)?.[1];
    if (!url || !weight) continue;
    const wMin = Number(weight[1]);
    out.push({ italic: style !== "normal", weightMin: wMin, weightMax: weight[2] ? Number(weight[2]) : wMin, url });
  }
  return out;
}

/** Apply weight/width to a variable font; static fonts pass through. */
function vary(font: fontkit.Font, req: FaceRequest): fontkit.Font {
  const axes = font.variationAxes ?? {};
  const settings: Record<string, number> = {};
  if (axes.wght) settings.wght = Math.min(axes.wght.max, Math.max(axes.wght.min, req.weight));
  if (axes.wdth && req.stretch !== 100) settings.wdth = Math.min(axes.wdth.max, Math.max(axes.wdth.min, req.stretch));
  if (!Object.keys(settings).length) return font;
  try {
    return font.getVariation(settings);
  } catch {
    return font;
  }
}

async function loadWebFace(req: FaceRequest): Promise<LoadedFace | null> {
  const entry = getFontEntry(req.family);
  if (!entry || entry.system) return null;
  const css = await loadCss(fontCssUrl(req.family, entry.weights));
  if (!css) return null;
  const faces = parseFontFaces(css);
  if (!faces.length) return null;
  // Same style when the family has it, else the other (the browser would
  // synthesize the slant; the upright outline is the closest real glyph).
  const styled = faces.filter((f) => f.italic === req.italic);
  const pool = styled.length ? styled : faces;
  // Nearest weight, like the CSS font matching the browser did on screen.
  const dist = (f: CssFace) => (req.weight < f.weightMin ? f.weightMin - req.weight : req.weight > f.weightMax ? req.weight - f.weightMax : 0);
  const best = Math.min(...pool.map(dist));
  const chosen = pool.filter((f) => dist(f) === best);
  const target = chosen[0].weightMin === chosen[0].weightMax ? chosen[0].weightMin : req.weight;
  const files = await Promise.all([...new Set(chosen.filter((f) => f.weightMin === chosen[0].weightMin).map((f) => f.url))].map(loadFile));
  const subsets = files.filter((f): f is fontkit.Font => !!f).map((f) => vary(f, { ...req, weight: target }));
  return subsets.length ? { subsets } : null;
}

async function loadCustomFace(req: FaceRequest, docFonts: { family?: string; url?: string }[]): Promise<LoadedFace | null> {
  const src = fontProvider.customSource(req.family) ?? docFonts.find((f) => f.family?.toLowerCase() === req.family.toLowerCase())?.url;
  if (!src) return null;
  const font = await loadFile(src);
  return font ? { subsets: [vary(font, req)] } : null;
}

// Parsed per file: the provider hands out one byte array per face.
const wsFileCache = new WeakMap<Uint8Array, fontkit.Font | null>();

/** A workspace font family's file (the face nearest the request). */
async function loadWorkspaceFace(req: FaceRequest): Promise<LoadedFace | null> {
  const bytes = await fontProvider.workspaceFaceBytes(req.family, req.weight, req.italic);
  if (!bytes) return null;
  let font = wsFileCache.get(bytes);
  if (font === undefined) {
    try {
      const parsed = fontkit.create(bytes);
      font = "fonts" in parsed ? parsed.fonts[0] ?? null : parsed;
    } catch {
      font = null;
    }
    wsFileCache.set(bytes, font);
  }
  return font ? { subsets: [vary(font, req)] } : null;
}

/** Load the font files for a face; null when the family has no font file the
 *  export can read (system fonts), in which case that text is rasterized. */
export function loadFace(req: FaceRequest, docFonts: { family?: string; url?: string }[] = []): Promise<LoadedFace | null> {
  // A workspace font wins over a system or catalog family of the same name.
  const workspace = fontProvider.isWorkspaceFamily(req.family);
  if (!workspace && isSystemFont(req.family)) return Promise.resolve(null);
  const key = faceKey(req);
  let p = faceCache.get(key);
  if (!p) {
    p = (async () => (workspace ? await loadWorkspaceFace(req) : null) ?? (await loadCustomFace(req, docFonts)) ?? (await loadWebFace(req)))().catch(() => null);
    faceCache.set(key, p);
  }
  return p;
}

const STRETCH: Record<string, number> = {
  "ultra-condensed": 50, "extra-condensed": 62.5, condensed: 75, "semi-condensed": 87.5,
  normal: 100, "semi-expanded": 112.5, expanded: 125, "extra-expanded": 150, "ultra-expanded": 200,
};

/** Parse a canvas `font` shorthand as the engine writes it
 *  (`[italic ][small-caps ]<weight> [<stretch> ]<size>px "<Family>", <stack>`). */
export function parseCanvasFont(font: string): (FaceRequest & { size: number; smallCaps: boolean }) | null {
  const m = /^\s*((?:(?:italic|oblique|small-caps|normal|bold|bolder|lighter|\d{3}|(?:[a-z]+-)?condensed|(?:[a-z]+-)?expanded)\s+)*)([\d.]+)px\s+(.+)$/i.exec(font);
  if (!m) return null;
  const pre = m[1].toLowerCase().split(/\s+/).filter(Boolean);
  const numeric = pre.find((t) => /^\d{3}$/.test(t));
  const weight = numeric ? Number(numeric) : pre.includes("bold") ? 700 : 400;
  const stretchWord = pre.find((t) => t in STRETCH);
  // First family of the stack; quotes stripped.
  const first = m[3].split(",")[0].trim().replace(/^["']|["']$/g, "");
  return {
    family: first,
    weight,
    italic: pre.includes("italic") || pre.includes("oblique"),
    stretch: stretchWord ? STRETCH[stretchWord] : 100,
    size: Number(m[2]),
    smallCaps: pre.includes("small-caps"),
  };
}

export function faceKeyOf(req: FaceRequest): string {
  return faceKey(req);
}
