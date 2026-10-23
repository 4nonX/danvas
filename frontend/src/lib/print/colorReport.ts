// The colour list that can go with a print export: every colour a design
// uses, with what the print file carries for it (CMYK through the export's
// profile, or the exact CMYK or spot colour given), the CIE L*a*b* that
// CMYK prints as on the profile's paper (the value a print shop measures),
// the brand colour it is with its colour book reference, and the nearest
// entry of a colour library the workspace uploaded, with the CIEDE2000
// distance. It names references and distances; it is no proof and changes
// nothing in the print file.

import type { Color, DesignFile } from "@hc/schema";
import type { BrandKit } from "@hc/sdk";
import { ciede2000 } from "@hc/color";
import { nearestEntry, type ColorLibraryEntry } from "./colorLibrary";

type Lab3 = [number, number, number];
type Cmyk4 = [number, number, number, number];

/** Where a colour is used. */
export type ColorUseKind = "fill" | "stroke" | "text" | "gradient" | "background" | "effect";

export interface UsedColor {
  /** Identity: the spot colour, the exact CMYK, or the sRGB hex. */
  key: string;
  color: Color;
  hex: string;
  uses: ColorUseKind[];
  /** 1-based page numbers. */
  pages: number[];
}

export interface DesignColors {
  colors: UsedColor[];
  /** Pictures (image nodes and image fills): their colours go through the
   *  profile pixel by pixel and are not listed. */
  images: number;
}

const hex2 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, "0");
export const hexOfColor = (c: Color) => `#${hex2(c.srgb.r)}${hex2(c.srgb.g)}${hex2(c.srgb.b)}`;

function keyOf(c: Color): string {
  if (c.spot?.name) return `spot:${c.spot.name}`;
  if (c.cmyk) return `cmyk:${[c.cmyk.c, c.cmyk.m, c.cmyk.y, c.cmyk.k].map((v) => Math.round(v * 1000)).join(",")}`;
  return hexOfColor(c);
}

function kindOf(path: string[], nodeType: string | null): ColorUseKind {
  const has = (k: string) => path.includes(k);
  if (has("stops")) return "gradient";
  if (has("effects") || has("shadow") || has("shadows")) return "effect";
  if (has("stroke") || has("strokes")) return "stroke";
  if (has("background")) return "background";
  if (nodeType === "text" || has("runs") || has("textColor")) return "text";
  return "fill";
}

/** Every colour a design shows (hidden nodes and fully transparent colours
 *  left out), each once, in the order first met. */
export function collectDesignColors(doc: DesignFile): DesignColors {
  const byKey = new Map<string, UsedColor>();
  let images = 0;
  const walk = (v: unknown, path: string[], page: number, nodeType: string | null) => {
    if (Array.isArray(v)) { for (const x of v) walk(x, path, page, nodeType); return; }
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (o.hidden === true) return;
    // A node (has an id) sets the use for its colours; an image node or an
    // image fill is a picture.
    if (typeof o.type === "string" && typeof o.id === "string") nodeType = o.type;
    if (o.type === "image" && o.source) images++;
    const srgb = o.srgb as { a?: unknown } | undefined;
    if (srgb && typeof srgb === "object" && typeof srgb.a === "number") {
      const c = o as unknown as Color;
      if (c.srgb.a <= 0) return;
      const key = keyOf(c);
      let u = byKey.get(key);
      if (!u) { u = { key, color: c, hex: hexOfColor(c), uses: [], pages: [] }; byKey.set(key, u); }
      const kind = kindOf(path, nodeType);
      if (!u.uses.includes(kind)) u.uses.push(kind);
      if (!u.pages.includes(page)) u.pages.push(page);
      return;
    }
    for (const k in o) walk(o[k], [...path, k], page, nodeType);
  };
  doc.pages.forEach((p, i) => walk(p, [], i + 1, null));
  return { colors: [...byKey.values()], images };
}

/** What the export knows to work the values out. */
export interface ColorListContext {
  /** sRGB to the profile's CMYK, and CMYK to Lab as printed. */
  converter: { cmyk(r: number, g: number, b: number): Cmyk4; lab(c: number, m: number, y: number, k: number): Lab3 };
  /** sRGB to Lab, for matching against the brand's screen colours. */
  srgbLab(r: number, g: number, b: number): Lab3;
  kit: BrandKit | null;
  library: readonly ColorLibraryEntry[] | null;
}

export interface ColorListRow {
  hex: string;
  /** How the print file carries it. */
  print: "spot" | "exact" | "converted";
  spotName?: string;
  cmyk: Cmyk4;
  lab: Lab3;
  brand?: { name: string; pantone?: string; deltaE: number };
  nearest?: { name: string; deltaE: number };
  uses: ColorUseKind[];
  pages: number[];
}

/** Brand colours closer than this (CIEDE2000, on screen) count as the same. */
export const BRAND_MATCH_DELTA_E = 1;

export function colorListRows(colors: readonly UsedColor[], ctx: ColorListContext): ColorListRow[] {
  const swatches = (ctx.kit?.palettes ?? []).flatMap((p) => p.colors).map((s) => ({
    s, key: keyOf(s.value), lab: ctx.srgbLab(s.value.srgb.r, s.value.srgb.g, s.value.srgb.b),
  }));
  const L = (v: Lab3) => ({ l: v[0], a: v[1], b: v[2] });
  return colors.map((u) => {
    const c = u.color;
    const cmyk: Cmyk4 = c.spot ? [c.spot.fallback.c, c.spot.fallback.m, c.spot.fallback.y, c.spot.fallback.k]
      : c.cmyk ? [c.cmyk.c, c.cmyk.m, c.cmyk.y, c.cmyk.k]
      : ctx.converter.cmyk(c.srgb.r, c.srgb.g, c.srgb.b);
    const lab = ctx.converter.lab(...cmyk);
    const row: ColorListRow = { hex: u.hex, print: c.spot ? "spot" : c.cmyk ? "exact" : "converted", cmyk, lab, uses: u.uses, pages: u.pages };
    if (c.spot) row.spotName = c.spot.name;
    // The brand colour: the same print colour, else the closest on screen.
    const screen = ctx.srgbLab(c.srgb.r, c.srgb.g, c.srgb.b);
    let best: { name: string; pantone?: string; deltaE: number } | undefined;
    for (const w of swatches) {
      const d = w.key === u.key ? 0 : ciede2000(L(screen), L(w.lab));
      if (d <= BRAND_MATCH_DELTA_E && (!best || d < best.deltaE)) best = { name: w.s.name || w.s.role, pantone: w.s.pantone, deltaE: d };
    }
    if (best) row.brand = best;
    if (ctx.library?.length) {
      const m = nearestEntry(lab, ctx.library);
      if (m) row.nearest = { name: m.entry.name, deltaE: m.deltaE };
    }
    return row;
  });
}

/** The labels of the list, in the user's language. */
export interface ColorListLabels {
  title: string;
  /** "Design", "Colour profile", ... as `key: value` lines under the title. */
  meta: [string, string][];
  columns: { color: string; print: string; lab: string; brand: string; nearest: string; used: string };
  spot: string;
  exact: string;
  converted: string;
  uses: Record<ColorUseKind, string>;
  page: string;
  images: string | null;
  note: string;
  none: string;
}

// The PDF uses the built-in Helvetica (WinAnsi): other characters are
// replaced, so the caller passes English labels for scripts it cannot show.
const latin = (s: string) =>
  s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d\u201e]/g, "\"").replace(/[\u2013\u2014]/g, "-").replace(/[^\n\x20-\x7e\xa0-\xff]/g, "?");
export const fitsLatin1 = (s: string) => /^[\x00-\xff\u2018\u2019\u201c\u201d\u201e\u2013]*$/.test(s);

const pct = (v: number) => Math.round(v * 100);
const f1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

/** The colour list as an A4 PDF. */
export async function colorListPdf(rows: readonly ColorListRow[], labels: ColorListLabels): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const W = 297, H = 210, M = 12;
  const cols = [
    { x: M, w: 34, label: labels.columns.color },
    { x: M + 34, w: 44, label: labels.columns.print },
    { x: M + 78, w: 34, label: labels.columns.lab },
    { x: M + 112, w: 52, label: labels.columns.brand },
    { x: M + 164, w: 54, label: labels.columns.nearest },
    { x: M + 218, w: W - M - (M + 218), label: labels.columns.used },
  ];
  const text = (s: string, x: number, y: number, w: number, size = 8, bold = false) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(latin(s), w - 2) as string[];
    pdf.text(lines, x, y);
    return lines.length;
  };
  let y = M + 4;
  const head = () => {
    pdf.setDrawColor(200);
    for (const c of cols) text(c.label, c.x, y, c.w, 8, true);
    y += 2;
    pdf.line(M, y, W - M, y);
    y += 5;
  };
  text(labels.title, M, y, W - 2 * M, 14, true);
  y += 7;
  for (const [k, v] of labels.meta) {
    text(`${k}: ${v}`, M, y, W - 2 * M, 9);
    y += 4.5;
  }
  y += 3;
  head();
  if (!rows.length) { text(labels.none, M, y, W - 2 * M, 9); y += 6; }
  for (const r of rows) {
    const cells = [
      `${r.hex.toUpperCase()}`,
      `${r.print === "spot" ? `${labels.spot}: ${r.spotName}\n` : r.print === "exact" ? `${labels.exact}\n` : `${labels.converted}\n`}C${pct(r.cmyk[0])} M${pct(r.cmyk[1])} Y${pct(r.cmyk[2])} K${pct(r.cmyk[3])}`,
      `L ${f1(r.lab[0])}\na ${f1(r.lab[1])}\nb ${f1(r.lab[2])}`,
      r.brand ? `${r.brand.name}${r.brand.pantone ? `\n${r.brand.pantone}` : ""}` : "",
      r.nearest ? `${r.nearest.name}\ndE00 ${f1(r.nearest.deltaE)}` : "",
      `${r.uses.map((u) => labels.uses[u]).join(", ")}\n${labels.page} ${r.pages.join(", ")}`,
    ];
    // Row height from the tallest cell (3.4 mm a line at 8 pt).
    pdf.setFontSize(8);
    const heights = cells.map((c, i) => (pdf.splitTextToSize(latin(c), cols[i].w - 2) as string[]).length);
    const h = Math.max(12, Math.max(...heights) * 3.4 + 3);
    if (y + h > H - M - 14) { pdf.addPage(); y = M + 4; head(); }
    pdf.setFillColor(Math.round(parseInt(r.hex.slice(1, 3), 16)), parseInt(r.hex.slice(3, 5), 16), parseInt(r.hex.slice(5, 7), 16));
    pdf.setDrawColor(180);
    pdf.rect(M, y - 3, 9, 9, "FD");
    text(cells[0], M + 11, y, cols[0].w - 11);
    cells.slice(1).forEach((c, i) => text(c, cols[i + 1].x, y, cols[i + 1].w));
    y += h;
    pdf.setDrawColor(230);
    pdf.line(M, y - 4, W - M, y - 4);
  }
  // The closing notes stay together, on a new page when the rows end low.
  if (y > H - M - 14) { pdf.addPage(); y = M + 4; }
  if (labels.images) { y += 5 * text(labels.images, M, y, W - 2 * M, 8) - 1; }
  text(labels.note, M, y, W - 2 * M, 7.5);
  return pdf.output("blob");
}
