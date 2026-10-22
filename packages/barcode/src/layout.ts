// Layout: a pattern becomes print geometry in design px at the document's
// dpi. Every bar or module is an exact rectangle at a whole multiple of the
// module width X, nothing overlaps and nothing is padded, and the quiet zones
// are part of the element's box. Optional: rounding X (and the bar width
// reduction) to whole printer dots, and narrowing every bar for print gain.

import { RULES } from "./symbologies";
import type { Pattern } from "./encode";

export interface LayoutOptions {
  /** Module width X, in mm. */
  moduleMm: number;
  /** Bar height of a linear code, in mm (ignored for matrix codes). */
  barHeightMm: number;
  /** Keep the quiet zones the symbology requires inside the element. */
  quietZones: boolean;
  /** Narrow every bar by this much (mm), half on each side; linear codes. */
  barWidthReductionMm?: number;
  /** Round X and the reduction to whole dots of a printer of this resolution. */
  printerDpi?: number;
  /** Show the human-readable line. */
  text: boolean;
  /** Font size of the human-readable line, in mm; default follows X. */
  textSizeMm?: number;
}

export interface Point { x: number; y: number }

export interface TextItem {
  text: string;
  /** Horizontal centre and top of the text box, in px. */
  cx: number;
  top: number;
  /** Font size in px. The box is one line of exactly this height (line
   *  height 1), with the baseline at its bottom edge, as danvas lays text out. */
  size: number;
}

export interface BarcodeLayout {
  /** Element size in px, quiet zones included. */
  width: number;
  height: number;
  /** Closed outlines of the dark area, filled together under the even-odd
   *  rule: one rectangle per bar of a linear code, the traced outline (holes
   *  included) of a matrix code. No two outlines share an edge, so no
   *  renderer can leave a seam between them. */
  contours: Point[][];
  texts: TextItem[];
  /** The module width actually used (after rounding to printer dots), in mm. */
  moduleMm: number;
  /** Printer dots per module when a printer resolution is set. */
  dotsPerModule?: number;
  /** The bar width reduction actually used, in mm. */
  reductionMm: number;
}

const px = (mm: number, dpi: number) => (mm / 25.4) * dpi;

const rect = (x: number, y: number, w: number, h: number): Point[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

/** The outline of the dark cells of a module matrix, in modules: every cell
 *  edge between dark and light (or the border) once, joined into closed
 *  loops, straight runs merged. Under the even-odd rule the loops fill
 *  exactly the dark cells, whichever way touching corners are joined. */
export function traceMatrix(cells: boolean[], cols: number, rows: number): Point[][] {
  const dark = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && cells[r * cols + c];
  // Directed boundary edges, clockwise around each dark cell (y grows downwards).
  const next = new Map<string, Point[]>();
  const key = (x: number, y: number) => `${x},${y}`;
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const k = key(ax, ay);
    const list = next.get(k);
    if (list) list.push({ x: bx, y: by }); else next.set(k, [{ x: bx, y: by }]);
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!dark(c, r)) continue;
      if (!dark(c, r - 1)) add(c, r, c + 1, r);
      if (!dark(c + 1, r)) add(c + 1, r, c + 1, r + 1);
      if (!dark(c, r + 1)) add(c + 1, r + 1, c, r + 1);
      if (!dark(c - 1, r)) add(c, r + 1, c, r);
    }
  }
  const loops: Point[][] = [];
  for (const [k, list] of next) {
    while (list.length) {
      const [sx, sy] = k.split(",").map(Number);
      const pts: Point[] = [{ x: sx, y: sy }];
      let cur = list.pop()!;
      while (cur.x !== sx || cur.y !== sy) {
        pts.push(cur);
        const out = next.get(key(cur.x, cur.y));
        if (!out || !out.length) break; // cannot happen: every vertex is balanced
        cur = out.pop()!;
      }
      // Drop the points in the middle of a straight run.
      const n = pts.length;
      const keep = pts.filter((p, i) => {
        const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
        return !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y));
      });
      if (keep.length >= 4) loops.push(keep);
    }
  }
  return loops;
}

/** Gap between bars and the tops of the characters, and how far guard bars
 *  reach below the others, in modules. */
const TEXT_GAP = 0.5;
const GUARD_EXTENSION = 5;
/** Share of the font size above the top of digits and capitals (their
 *  height is about 0.72 of the size in common fonts). */
const ABOVE_CAPS = 0.28;
/** Room below the baseline for descenders, as a share of the size. */
const DESCENT = 0.22;

/** The human-readable line's default size in mm for a module width. */
export function defaultTextSizeMm(p: Pattern, moduleMm: number): number {
  if (p.kind === "linear" && RULES[p.symbology].retail) return moduleMm * 11;
  if (p.kind === "matrix") return Math.max(2, moduleMm * 4);
  return Math.max(2, moduleMm * 9);
}

export function layout(p: Pattern, o: LayoutOptions, dpi: number): BarcodeLayout {
  const rules = RULES[p.symbology];
  let moduleMm = Math.max(0.01, o.moduleMm);
  let dotsPerModule: number | undefined;
  let reductionMm = Math.max(0, o.barWidthReductionMm ?? 0);
  if (o.printerDpi && o.printerDpi > 0) {
    const dot = 25.4 / o.printerDpi;
    dotsPerModule = Math.max(1, Math.round(moduleMm / dot));
    moduleMm = dotsPerModule * dot;
    reductionMm = Math.round(reductionMm / dot) * dot;
    // A bar keeps at least one dot.
    if (reductionMm > moduleMm - dot) reductionMm = Math.max(0, moduleMm - dot);
  } else if (reductionMm > moduleMm * 0.5) {
    reductionMm = moduleMm * 0.5;
  }
  const X = px(moduleMm, dpi);
  const textMm = o.textSizeMm && o.textSizeMm > 0 ? o.textSizeMm : defaultTextSizeMm(p, moduleMm);
  const size = px(textMm, dpi);
  const texts: TextItem[] = [];

  if (p.kind === "matrix") {
    const q = o.quietZones ? rules.quiet[0] : 0;
    const contours = traceMatrix(p.cells, p.cols, p.rows).map((loop) => loop.map((pt) => ({ x: (q + pt.x) * X, y: (q + pt.y) * X })));
    const width = (p.cols + 2 * q) * X;
    let height = (p.rows + 2 * q) * X;
    if (o.text && p.text) {
      const top = height - ABOVE_CAPS * size;
      texts.push({ text: p.text, cx: width / 2, top, size });
      height = top + size * (1 + DESCENT);
    }
    return { width, height, contours, texts, moduleMm, dotsPerModule, reductionMm: 0 };
  }

  const [ql, qr] = o.quietZones ? rules.quiet : [0, 0];
  const H = px(Math.max(0.1, o.barHeightMm), dpi);
  const red = px(reductionMm, dpi);
  const retail = rules.retail && o.text && !!p.digits;
  const guardH = retail ? H + GUARD_EXTENSION * X : H;
  const contours = p.bars.map((b) => rect((ql + b.x) * X + red / 2, 0, b.w * X - red, b.guard ? guardH : H));
  const width = (ql + p.modules + qr) * X;
  let height = H;
  if (retail && p.digits) {
    // Digits start just under the normal bars, between the extended guards.
    const top = H + TEXT_GAP * X - ABOVE_CAPS * size;
    for (const d of p.digits) {
      const s = d.small ? size * 0.7 : size;
      texts.push({ text: d.ch, cx: (ql + d.x) * X, top: d.small ? top + (size - s) : top, size: s });
    }
    height = Math.max(guardH, top + size);
  } else if (o.text && p.text) {
    const top = H + TEXT_GAP * X - ABOVE_CAPS * size;
    texts.push({ text: p.text, cx: (ql + p.modules / 2) * X, top, size });
    height = top + size * (1 + DESCENT);
  }
  return { width, height, contours, texts, moduleMm, dotsPerModule, reductionMm };
}
