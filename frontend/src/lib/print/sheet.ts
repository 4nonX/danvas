// The printed sheet of a page: the page itself (the trim, where it is cut),
// its bleed (artwork that runs past the cut), and room around it for crop
// marks. Every print export (vector PDF, image PDF, TIFF, EPS) draws the
// same sheet, so they agree to the pixel.
//
// Coordinates are page px with the trim's top-left at (0, 0): the bleed and
// the marks lie at negative coordinates and past the page's width and height,
// which is where the engine already draws content that runs off the page.

import type { Color, DesignFile, Page, PrintMarks } from "@hc/schema";
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

/** Which of a page's print additions an export includes. */
export interface PrintParts { bleed: boolean; marks: boolean }

/** `true` is both, `false` neither. */
export const printParts = (include: boolean | Partial<PrintParts>): PrintParts =>
  typeof include === "boolean" ? { bleed: include, marks: include } : { bleed: !!include.bleed, marks: !!include.marks };

/**
 * The sheet of `page`, with the bleed and the crop marks each included or
 * not. With neither (an export without print additions) it is the bare trim.
 * Marks without the bleed start at their offset from the trim.
 */
export function printSheet(page: Pick<Page, "width" | "height" | "bleed" | "printMarks">, dpi: number, include: boolean | Partial<PrintParts> = true): PrintSheet {
  const w = page.width, h = page.height;
  const parts = printParts(include);
  const bleed = parts.bleed ? pageBleed(page) : 0;
  const m = parts.marks ? resolvedMarks(page, dpi) : null;
  const marks: MarkLine[] = [];
  let margin = bleed;
  const pxPerPt = dpi / 72;
  let stroke: PrintSheet["stroke"] = { color: "#000000", width: 0, dash: [], cap: "butt" };
  if (m) {
    // A mark starts at its gap from the trim line, exactly as set (a gap
    // smaller than the bleed lays the mark over the bleed, which is cut away
    // with it), and runs outward along the trim line. Round dots reach half
    // the line weight past their ends, so dotted marks keep that much inside
    // their own span.
    const width = m.weightPt * pxPerPt;
    const cap = m.style === "dotted" ? width / 2 : 0;
    const outer = m.offset + m.length;
    const start = m.offset + cap;
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

/** Which print additions any of these pages has. */
export function printAdditions(pages: Pick<Page, "bleed" | "printMarks">[]): PrintParts {
  return { bleed: pages.some((p) => pageBleed(p) > 0), marks: pages.some((p) => !!p.printMarks?.crop) };
}

/** Does any of these pages add something to a print export? */
export function hasPrintAdditions(pages: Pick<Page, "bleed" | "printMarks">[]): boolean {
  const a = printAdditions(pages);
  return a.bleed || a.marks;
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

/** A context that can paint in a spot colour and group paint into layers
 *  (the PDF and PostScript writers); others draw a plain colour instead. */
interface SpotCtx {
  setSpot?(spot: { name: string; cmyk: [number, number, number, number]; overprint?: boolean } | null): void;
  beginLayer?(title: string): void;
  endLayer?(): void;
}

/** Extras of a vector print file (PDF, EPS). */
export interface PrintExtras {
  /** Crop marks in registration colour: on every printing plate, as press
   *  operators expect (the PDF separation "All"). */
  registration?: boolean;
  /** A die line (cut contour) along the trim: a spot colour of its own that
   *  is not printed but tells the press where to cut or punch. */
  dieLine?: DieLine;
}

export interface DieLine {
  /** The spot colour's name, as the print shop calls it ("Stanze",
   *  "CutContour", ...). */
  name: string;
  /** Corner radius in mm (0: square corners). */
  radiusMm: number;
}

/**
 * Draw the sheet's marks on a context that was rendered with the sheet's
 * viewport (`sheetViewport`), at the given zoom (device px per page px).
 * In registration colour where the context can paint spot colours.
 */
export function drawPrintMarks(ctx: StrokeCtx & SpotCtx, sheet: PrintSheet, zoom: number, registration = false): void {
  if (!sheet.marks.length) return;
  const spot = registration && typeof ctx.setSpot === "function";
  if (spot) ctx.setSpot!({ name: "All", cmyk: [1, 1, 1, 1] }); // i18n-ignore: the registration separation
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
  if (spot) ctx.setSpot!(null);
}

/**
 * Draw a die line along the trim (a rounded rectangle) in its own spot
 * colour, overprinting, on a layer named after it. Only for contexts that
 * paint spot colours: anywhere else the line would be printed.
 */
/** The die line's spot colour as defined in the files: full magenta, so it
 *  stands out on screen and in a proof. */
export const DIE_LINE_CMYK: [number, number, number, number] = [0, 1, 0, 0];

export function drawDieLine(ctx: StrokeCtx & SpotCtx & { roundRect(x: number, y: number, w: number, h: number, r: number): void }, sheet: PrintSheet, zoom: number, die: DieLine, dpi: number): void {
  if (typeof ctx.setSpot !== "function") return;
  const w = sheet.width, h = sheet.height;
  const r = Math.max(0, Math.min(mmToPx(die.radiusMm, dpi), w / 2, h / 2));
  ctx.beginLayer?.(die.name);
  ctx.setSpot({ name: die.name, cmyk: DIE_LINE_CMYK, overprint: true });
  ctx.save();
  ctx.setTransform(zoom, 0, 0, zoom, sheet.margin * zoom, sheet.margin * zoom);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = "#ff00ff";
  ctx.lineWidth = 0.25 * (dpi / 72);
  ctx.lineCap = "butt";
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, r);
  ctx.stroke();
  ctx.restore();
  ctx.setSpot(null);
  ctx.endLayer?.();
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

/** A page's crop marks (defaults filled in) in the units the fields show. */
export function marksMmOf(page: Pick<Page, "printMarks">, dpi: number) {
  const m = resolvedMarks({ printMarks: { ...(page.printMarks ?? {}), crop: true } }, dpi)!;
  return { style: m.style as string, color: m.color, weightPt: m.weightPt, lengthMm: pxToMm(m.length, dpi), offsetMm: pxToMm(m.offset, dpi) };
}

/** Field values (mm, pt) as a PrintMarks patch in page px. */
export function marksPatchPx(p: { style?: string; color?: Color; weightPt?: number; lengthMm?: number; offsetMm?: number }, dpi: number): Partial<PrintMarks> {
  const out: Partial<PrintMarks> = {};
  if (p.style !== undefined) out.style = p.style;
  if (p.color !== undefined) out.color = p.color;
  if (p.weightPt !== undefined) out.weight = p.weightPt;
  if (p.lengthMm !== undefined) out.length = mmToPx(p.lengthMm, dpi);
  if (p.offsetMm !== undefined) out.offset = mmToPx(p.offsetMm, dpi);
  return out;
}

/** One bleed and one set of crop marks for a whole export, in mm and pt so
 *  they mean the same on designs of any dpi. */
export interface PrintOverride {
  bleed: boolean;
  bleedMm: number;
  marks: boolean;
  style: string;
  color?: Color;
  weightPt: number;
  lengthMm: number;
  offsetMm: number;
}

/**
 * The design with every page's bleed and crop marks set to `o` (the export
 * from the dashboard, where one setting applies to all selected designs).
 * Returns a copy; the design itself is not changed.
 */
export function withPrintOverride(doc: DesignFile, o: PrintOverride): DesignFile {
  const dpi = doc.dpi ?? 96;
  const marks: PrintMarks | undefined = o.marks
    ? { crop: true, style: o.style, ...(o.color ? { color: o.color } : {}), weight: o.weightPt, length: mmToPx(o.lengthMm, dpi), offset: mmToPx(o.offsetMm, dpi) }
    : undefined;
  return {
    ...doc,
    pages: doc.pages.map((p) => {
      const { bleed: _b, printMarks: _m, ...rest } = p;
      void _b; void _m;
      return { ...rest, ...(o.bleed && o.bleedMm > 0 ? { bleed: mmToPx(o.bleedMm, dpi) } : {}), ...(marks ? { printMarks: marks } : {}) };
    }),
  } as DesignFile;
}

/** The override a dashboard export starts from: the first page among the
 *  designs that sets anything, else 3 mm and default marks. */
export function initialPrintOverride(docs: DesignFile[]): PrintOverride {
  for (const d of docs) {
    const dpi = d.dpi ?? 96;
    const p = d.pages.find((pg) => pageBleed(pg) > 0 || pg.printMarks?.crop);
    if (p) {
      const m = marksMmOf(p, dpi);
      return { bleed: pageBleed(p) > 0, bleedMm: pageBleed(p) > 0 ? pxToMm(pageBleed(p), dpi) : 3, marks: !!p.printMarks?.crop, ...m };
    }
  }
  const dpi = 96;
  return { bleed: false, bleedMm: 3, marks: false, ...marksMmOf({}, dpi) };
}
