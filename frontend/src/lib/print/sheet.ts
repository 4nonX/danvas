// The printed sheet of a page: the page itself (the trim, where it is cut),
// its bleed (artwork that runs past the cut), and room around it for crop
// marks. Every print export (vector PDF, image PDF, TIFF, EPS) draws the
// same sheet, so they agree to the pixel.
//
// Coordinates are page px with the trim's top-left at (0, 0): the bleed and
// the marks lie at negative coordinates and past the page's width and height,
// which is where the engine already draws content that runs off the page.

import type { Color, Page, PrintMarks } from "@hc/schema";
import { pageBleed } from "@hc/engine";

const MM_PER_INCH = 25.4;

/** Millimetres to design px at the document's dpi. */
export const mmToPx = (mm: number, dpi: number) => (mm / MM_PER_INCH) * dpi;
/** Design px to millimetres at the document's dpi. */
export const pxToMm = (px: number, dpi: number) => (px / dpi) * MM_PER_INCH;

/** Defaults for marks a page switches on without further settings. */
export const MARK_DEFAULTS = { weightPt: 0.25, lengthMm: 5, offsetMm: 3 } as const;

export type MarkStyle = "solid" | "dashed" | "dotted";
export const MARK_STYLES: MarkStyle[] = ["solid", "dashed", "dotted"];

export interface MarkLine { x1: number; y1: number; x2: number; y2: number }

export interface PrintSheet {
  /** Trim (finished) size in page px. */
  width: number;
  height: number;
  /** Bleed on every side, page px. */
  bleed: number;
  /** How far the sheet reaches past the trim on every side, page px: the
   *  bleed, or as far as the marks reach when there are marks. */
  margin: number;
  /** The whole sheet, page px. */
  sheetWidth: number;
  sheetHeight: number;
  marks: MarkLine[];
  /** How the marks are drawn: color as CSS, weight in page px, dash pattern
   *  in page px (empty for solid), line cap. */
  stroke: { color: string; width: number; dash: number[]; cap: "butt" | "round" };
}

const hex2 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
const cssOf = (c: Color | undefined) => (c ? `#${hex2(c.srgb.r)}${hex2(c.srgb.g)}${hex2(c.srgb.b)}` : "#000000");

/** Read a page's marks with their defaults applied, or null when off. */
export function resolvedMarks(page: Pick<Page, "printMarks">, dpi: number) {
  const m: PrintMarks | undefined = page.printMarks;
  if (!m?.crop) return null;
  const pos = (v: number | undefined, fallback: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback);
  const style: MarkStyle = m.style === "dashed" || m.style === "dotted" ? m.style : "solid";
  return {
    style,
    color: m.color,
    weightPt: Math.max(0.05, pos(m.weight, MARK_DEFAULTS.weightPt)),
    length: Math.max(1, pos(m.length, mmToPx(MARK_DEFAULTS.lengthMm, dpi))),
    offset: pos(m.offset, mmToPx(MARK_DEFAULTS.offsetMm, dpi)),
  };
}

/**
 * The sheet of `page`. With `include` false (an export without print
 * additions) it is the bare trim: no bleed, no marks.
 */
export function printSheet(page: Pick<Page, "width" | "height" | "bleed" | "printMarks">, dpi: number, include = true): PrintSheet {
  const w = page.width, h = page.height;
  const bleed = include ? pageBleed(page) : 0;
  const m = include ? resolvedMarks(page, dpi) : null;
  const marks: MarkLine[] = [];
  let margin = bleed;
  const pxPerPt = dpi / 72;
  let stroke: PrintSheet["stroke"] = { color: "#000000", width: 0, dash: [], cap: "butt" };
  if (m) {
    // A mark starts outside the bleed, so it never prints on artwork that is
    // meant to be cut away, and runs outward along the trim line. Round dots
    // reach half the line weight past their ends, so dotted marks keep that
    // much inside their own span.
    const width = m.weightPt * pxPerPt;
    const cap = m.style === "dotted" ? width / 2 : 0;
    const outer = Math.max(m.offset, bleed) + m.length;
    const start = Math.max(m.offset, bleed) + cap;
    const end = outer - cap;
    margin = Math.max(bleed, outer);
    for (const x of [0, w]) {
      marks.push({ x1: x, y1: -start, x2: x, y2: -end }, { x1: x, y1: h + start, x2: x, y2: h + end });
    }
    for (const y of [0, h]) {
      marks.push({ x1: -start, y1: y, x2: -end, y2: y }, { x1: w + start, y1: y, x2: w + end, y2: y });
    }
    stroke = {
      color: cssOf(m.color),
      width,
      dash: m.style === "dashed" ? [2 * pxPerPt, 1.5 * pxPerPt] : m.style === "dotted" ? [0, Math.max(1.2 * pxPerPt, 3 * width)] : [],
      cap: m.style === "dotted" ? "round" : "butt",
    };
  }
  return { width: w, height: h, bleed, margin, sheetWidth: w + 2 * margin, sheetHeight: h + 2 * margin, marks, stroke };
}

/** Does any of these pages add something to a print export? */
export function hasPrintAdditions(pages: Pick<Page, "bleed" | "printMarks">[]): boolean {
  return pages.some((p) => pageBleed(p) > 0 || !!p.printMarks?.crop);
}

interface StrokeCtx {
  save(): void;
  restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  setLineDash(seg: number[]): void;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: string;
  globalAlpha: number;
  globalCompositeOperation: string;
}

/**
 * Draw the sheet's marks on a context that was rendered with the sheet's
 * viewport (`sheetViewport`), at the given zoom (device px per page px).
 */
export function drawPrintMarks(ctx: StrokeCtx, sheet: PrintSheet, zoom: number): void {
  if (!sheet.marks.length) return;
  ctx.save();
  ctx.setTransform(zoom, 0, 0, zoom, sheet.margin * zoom, sheet.margin * zoom);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = sheet.stroke.color;
  ctx.lineWidth = sheet.stroke.width;
  ctx.lineCap = sheet.stroke.cap;
  ctx.setLineDash(sheet.stroke.dash);
  ctx.beginPath();
  for (const l of sheet.marks) {
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Clip what follows to the bleed box, so artwork that runs further past the
 * page than the bleed ends at the bleed line instead of running into the
 * marks. Nothing to do for a bare page, whose edge the file itself cuts.
 * Wrap it and the drawing in save()/restore().
 */
export function clipToBleed(ctx: StrokeCtx & { rect(x: number, y: number, w: number, h: number): void; clip(): void }, sheet: PrintSheet, zoom: number): void {
  if (sheet.margin <= sheet.bleed) return;
  const b = sheet.bleed;
  ctx.setTransform(zoom, 0, 0, zoom, sheet.margin * zoom, sheet.margin * zoom);
  ctx.beginPath();
  ctx.rect(-b, -b, sheet.width + 2 * b, sheet.height + 2 * b);
  ctx.clip();
}

/** The viewport that renders the whole sheet at `zoom`. */
export function sheetViewport(sheet: PrintSheet, zoom: number) {
  const width = Math.max(1, Math.ceil(sheet.sheetWidth * zoom));
  const height = Math.max(1, Math.ceil(sheet.sheetHeight * zoom));
  return { zoom, panX: -sheet.margin, panY: -sheet.margin, dpr: 1, width, height };
}

/** PDF page boxes in points (origin bottom left) for a sheet. */
export function pdfBoxes(sheet: PrintSheet, dpi: number) {
  const pt = (px: number) => (px * 72) / dpi;
  const W = pt(sheet.sheetWidth), H = pt(sheet.sheetHeight);
  const m = pt(sheet.margin), b = pt(sheet.bleed);
  const trim = [m, m, W - m, H - m];
  const bleed = [m - b, m - b, W - m + b, H - m + b];
  return { width: W, height: H, media: [0, 0, W, H], trim, bleed };
}
