// The colour list that can go with any export: every colour a design uses,
// in every common notation (hex, RGB, HSL, HSB, CMYK, Lab, LCh), with what
// the print file carries for it (CMYK through the export's
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
  /** The workspace's colour libraries: each gets its nearest entry. */
  libraries: readonly { name: string; entries: readonly ColorLibraryEntry[] }[];
}

export interface ColorListRow {
  hex: string;
  /** sRGB 0..255. */
  rgb: [number, number, number];
  /** Hue 0..360, saturation and lightness / brightness 0..100. */
  hsl: [number, number, number];
  hsb: [number, number, number];
  /** How the print file carries it. */
  print: "spot" | "exact" | "converted";
  spotName?: string;
  cmyk: Cmyk4;
  lab: Lab3;
  /** Lab as L*, C*ab, h°ab. */
  lch: Lab3;
  brand?: { name: string; role: string; pantone?: string; deltaE: number };
  /** The nearest entry of each library, in the libraries' order. */
  matches: { library: string; name: string; deltaE: number }[];
  uses: ColorUseKind[];
  pages: number[];
}

/** Brand colours closer than this (CIEDE2000, on screen) count as the same. */
export const BRAND_MATCH_DELTA_E = 1;

export function hslOf(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [hueOf(r, g, b, max, d), s * 100, l * 100];
}
export function hsbOf(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  return [hueOf(r, g, b, max, d), max === 0 ? 0 : (d / max) * 100, max * 100];
}
function hueOf(r: number, g: number, b: number, max: number, d: number): number {
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
export const lchOf = (lab: Lab3): Lab3 => [lab[0], Math.hypot(lab[1], lab[2]), ((Math.atan2(lab[2], lab[1]) * 180) / Math.PI + 360) % 360];

export function colorListRows(colors: readonly UsedColor[], ctx: ColorListContext): ColorListRow[] {
  const swatches = (ctx.kit?.palettes ?? []).flatMap((p) => p.colors).map((s) => ({
    s, key: keyOf(s.value), lab: ctx.srgbLab(s.value.srgb.r, s.value.srgb.g, s.value.srgb.b),
  }));
  const L = (v: Lab3) => ({ l: v[0], a: v[1], b: v[2] });
  return colors.map((u) => {
    const c = u.color;
    const { r, g, b } = c.srgb;
    const cmyk: Cmyk4 = c.spot ? [c.spot.fallback.c, c.spot.fallback.m, c.spot.fallback.y, c.spot.fallback.k]
      : c.cmyk ? [c.cmyk.c, c.cmyk.m, c.cmyk.y, c.cmyk.k]
      : ctx.converter.cmyk(r, g, b);
    const lab = ctx.converter.lab(...cmyk);
    const row: ColorListRow = {
      hex: u.hex,
      rgb: [r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)) as [number, number, number],
      hsl: hslOf(r, g, b),
      hsb: hsbOf(r, g, b),
      print: c.spot ? "spot" : c.cmyk ? "exact" : "converted",
      cmyk, lab, lch: lchOf(lab),
      matches: [],
      uses: u.uses, pages: u.pages,
    };
    if (c.spot) row.spotName = c.spot.name;
    // The brand colour: the same print colour, else the closest on screen.
    const screen = ctx.srgbLab(r, g, b);
    let best: ColorListRow["brand"];
    for (const w of swatches) {
      const d = w.key === u.key ? 0 : ciede2000(L(screen), L(w.lab));
      if (d <= BRAND_MATCH_DELTA_E && (!best || d < best.deltaE)) best = { name: w.s.name || w.s.role, role: w.s.role, pantone: w.s.pantone, deltaE: d };
    }
    if (best) row.brand = best;
    for (const lib of ctx.libraries) {
      const m = nearestEntry(lab, lib.entries);
      if (m) row.matches.push({ library: lib.name, name: m.entry.name, deltaE: m.deltaE });
    }
    return row;
  });
}

/** The labels of the list, in the user's language. */
export interface ColorListLabels {
  title: string;
  /** "Design", "Colour profile", ... as `key: value` lines under the title. */
  meta: [string, string][];
  columns: { color: string; print: string; lab: string; screen: string; brand: string; nearest: string; used: string };
  spot: string;
  exact: string;
  converted: string;
  /** "Brand", "Role", "Pantone", "Used as", "Pages", "Name", "In the print file" for the CSV header. */
  csv: { name: string; brand: string; role: string; pantone: string; used: string; pages: string; print: string; spot: string };
  uses: Record<ColorUseKind, string>;
  page: string;
  images: string | null;
  note: string;
  none: string;
}

// The PDF uses the built-in Helvetica (WinAnsi): other characters are
// replaced, so the caller passes English labels for scripts it cannot show.
const latin = (s: string) =>
  s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D\u201E]/g, "\"").replace(/[\u2013\u2014]/g, "-").replace(/[^\n\x20-\x7e\xa0-\xff]/g, "?");
export const fitsLatin1 = (s: string) => /^[\x00-\xff\u2018\u2019\u201C\u201D\u201E\u2013]*$/.test(s);

const pct = (v: number) => Math.round(v * 100);
const f1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
const r0 = (v: number) => String(Math.round(v));
const cmykText = (c: Cmyk4) => `C${pct(c[0])} M${pct(c[1])} Y${pct(c[2])} K${pct(c[3])}`;

/** The colour list as an A4 PDF. */
export async function colorListPdf(rows: readonly ColorListRow[], labels: ColorListLabels): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const W = 297, H = 210, M = 12;
  const widths = [34, 40, 30, 32, 40, 58, 39];
  const names = [labels.columns.color, labels.columns.print, labels.columns.lab, labels.columns.screen, labels.columns.brand, labels.columns.nearest, labels.columns.used];
  let x = M;
  const cols = widths.map((w, i) => { const c = { x, w, label: names[i] }; x += w; return c; });
  const text = (s: string, x: number, y: number, w: number, size = 7.5, bold = false) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(latin(s), w - 2) as string[];
    pdf.text(lines, x, y);
    return lines.length;
  };
  let y = M + 4;
  const head = () => {
    pdf.setDrawColor(200);
    for (const c of cols) text(c.label, c.x, y, c.w, 7.5, true);
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
      `${r.hex.toUpperCase()}\nRGB ${r.rgb.join(" ")}`,
      `${r.print === "spot" ? `${labels.spot}: ${r.spotName}` : r.print === "exact" ? labels.exact : labels.converted}\n${cmykText(r.cmyk)}`,
      `L ${f1(r.lab[0])}  a ${f1(r.lab[1])}  b ${f1(r.lab[2])}\nLCh ${f1(r.lch[0])} ${f1(r.lch[1])} ${r0(r.lch[2])}`,
      `HSL ${r0(r.hsl[0])} ${r0(r.hsl[1])}% ${r0(r.hsl[2])}%\nHSB ${r0(r.hsb[0])} ${r0(r.hsb[1])}% ${r0(r.hsb[2])}%`,
      r.brand ? `${r.brand.name}${r.brand.name !== r.brand.role ? ` (${r.brand.role})` : ""}${r.brand.pantone ? `\n${r.brand.pantone}` : ""}` : "",
      r.matches.map((m) => `${m.library}: ${m.name} (dE00 ${f1(m.deltaE)})`).join("\n"),
      `${r.uses.map((u) => labels.uses[u]).join(", ")}\n${labels.page} ${r.pages.join(", ")}`,
    ];
    // Row height from the tallest cell (3.2 mm a line at 7.5 pt).
    pdf.setFontSize(7.5);
    const heights = cells.map((c, i) => (pdf.splitTextToSize(latin(c), cols[i].w - 2) as string[]).length);
    const h = Math.max(12, Math.max(...heights) * 3.2 + 3);
    if (y + h > H - M - 14) { pdf.addPage(); y = M + 4; head(); }
    pdf.setFillColor(r.rgb[0], r.rgb[1], r.rgb[2]);
    pdf.setDrawColor(180);
    pdf.rect(M, y - 3, 8, 8, "FD");
    text(cells[0], M + 10, y, cols[0].w - 10);
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

/** The colour list as CSV: one row per colour, every code in its own column,
 *  ";" between fields and the decimal mark of the reader's language (what a
 *  spreadsheet there expects), UTF-8 with a byte order mark. */
export function colorListCsv(rows: readonly ColorListRow[], labels: ColorListLabels, decimal: "." | "," = "."): Blob {
  const libs = [...new Set(rows.flatMap((r) => r.matches.map((m) => m.library)))];
  const n = (v: number, digits = 2) => (Math.round(v * 10 ** digits) / 10 ** digits).toFixed(digits).replace(".", decimal);
  const cell = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, "\"\"")}"` : v);
  // i18n-ignore: colour notation names (Hex, RGB, HSL, HSB, CMYK, Lab, LCh) are the same in every language
  const head = [
    labels.csv.name, "Hex", "R", "G", "B", "HSL H", "HSL S", "HSL L", "HSB H", "HSB S", "HSB B",
    labels.csv.print, labels.csv.spot, "C", "M", "Y", "K", "L*", "a*", "b*", "C*ab", "h ab",
    labels.csv.brand, labels.csv.role, labels.csv.pantone,
    ...libs.flatMap((l) => [l, `${l} dE00`]),
    labels.csv.used, labels.csv.pages,
  ];
  const lines = rows.map((r) => [
    r.brand?.name ?? r.spotName ?? r.hex.toUpperCase(), r.hex.toUpperCase(), ...r.rgb.map(String),
    n(r.hsl[0], 1), n(r.hsl[1], 1), n(r.hsl[2], 1), n(r.hsb[0], 1), n(r.hsb[1], 1), n(r.hsb[2], 1),
    r.print === "spot" ? labels.spot : r.print === "exact" ? labels.exact : labels.converted, r.spotName ?? "",
    ...r.cmyk.map((v) => n(v * 100, 1)), ...r.lab.map((v) => n(v)), n(r.lch[1]), n(r.lch[2], 1),
    r.brand?.name ?? "", r.brand?.role ?? "", r.brand?.pantone ?? "",
    ...libs.flatMap((l) => { const m = r.matches.find((x) => x.library === l); return m ? [m.name, n(m.deltaE)] : ["", ""]; }),
    r.uses.map((u) => labels.uses[u]).join(", "), r.pages.join(", "),
  ]);
  const text = [head, ...lines].map((l) => l.map(cell).join(";")).join("\r\n") + "\r\n";
  return new Blob(["\uFEFF", text], { type: "text/csv;charset=utf-8" });
}

/** The colours as Adobe Swatch Exchange (.ase): one swatch per colour with
 *  the CMYK the print file carries, a spot colour as a spot swatch under its
 *  name, so the print shop loads them as swatches in Illustrator or InDesign. */
export function colorListAse(rows: readonly ColorListRow[], groupName: string): Blob {
  const parts: number[] = [];
  const u16 = (v: number) => parts.push((v >> 8) & 255, v & 255);
  const u32 = (v: number) => parts.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  const f32 = (v: number) => { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, v); for (let i = 0; i < 4; i++) parts.push(b.getUint8(i)); };
  const str = (s: string) => { u16(s.length + 1); for (const ch of s) u16(ch.charCodeAt(0) & 0xffff); u16(0); };
  const block = (type: number, body: () => void) => {
    const start = parts.length;
    body();
    const len = parts.length - start;
    const content = parts.splice(start, len);
    u16(type); u32(len); parts.push(...content);
  };
  const used = new Set<string>();
  const unique = (s: string) => { let n = s, i = 2; while (used.has(n)) n = `${s} ${i++}`; used.add(n); return n; };
  parts.push(..."ASEF".split("").map((c) => c.charCodeAt(0)));
  u16(1); u16(0);
  u32(rows.length + 2); // group start, swatches, group end
  block(0xc001, () => str(groupName.slice(0, 120)));
  for (const r of rows) {
    const name = unique(r.spotName ?? (r.brand ? `${r.brand.name} ${r.hex.toUpperCase()}` : `${r.hex.toUpperCase()} ${cmykText(r.cmyk)}`));
    block(0x0001, () => {
      str(name);
      parts.push(..."CMYK".split("").map((c) => c.charCodeAt(0)));
      r.cmyk.forEach(f32);
      u16(r.print === "spot" ? 1 : 2); // spot, else normal (process)
    });
  }
  block(0xc002, () => undefined);
  return new Blob([new Uint8Array(parts)], { type: "application/octet-stream" });
}
