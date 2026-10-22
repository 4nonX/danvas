// Imposition (F45): many copies of a small design on one printer sheet, in a
// grid with cut marks. This module is the layout only, in millimetres with
// the origin at the sheet's top left: how many fit, where each item's trim
// box sits, how far each item's bleed may reach, and where the cut marks
// go. The exports draw it (vector PDF, image PDF, printing).

export type ImposeSheet = "a4" | "a3" | "sra3" | "letter" | "custom";
export type ImposeOrientation = "auto" | "portrait" | "landscape";
export type ImposeFill = "repeat" | "sequence";

/** What an export profile or print preset stores. */
export interface ImposeSettings {
  on: boolean;
  /** Download only: the sheet (printing uses the dialog's paper). */
  sheet: ImposeSheet;
  widthMm: number;
  heightMm: number;
  orientation: ImposeOrientation;
  /** What the printer cannot print, on every side. */
  marginMm: number;
  /** Between neighbouring items (0: they share the cut). */
  gapMm: number;
  marks: boolean;
  /** Turn items a quarter when that fits more. */
  rotate: boolean;
  fill: ImposeFill;
}

export const SHEET_SIZES: Record<Exclude<ImposeSheet, "custom">, [number, number]> = {
  a4: [210, 297],
  a3: [297, 420],
  sra3: [320, 450],
  letter: [215.9, 279.4],
};

/** Cut marks on the sheet: 2 mm from the cut line, 4 mm long. */
export const IMPOSE_MARK = { offsetMm: 2, lengthMm: 4 } as const;

export function defaultImposeSettings(): ImposeSettings {
  return { on: false, sheet: "a4", widthMm: 210, heightMm: 297, orientation: "auto", marginMm: 5, gapMm: 0, marks: true, rotate: true, fill: "repeat" };
}

const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

/** A stored setting, completed; off when missing (older profiles). */
export function normalizeImpose(raw: unknown): ImposeSettings {
  const d = defaultImposeSettings();
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    on: r.on === true,
    sheet: ["a4", "a3", "sra3", "letter", "custom"].includes(r.sheet as string) ? (r.sheet as ImposeSheet) : d.sheet,
    widthMm: num(r.widthMm, d.widthMm, 20, 2000),
    heightMm: num(r.heightMm, d.heightMm, 20, 2000),
    orientation: r.orientation === "portrait" || r.orientation === "landscape" ? r.orientation : "auto",
    marginMm: num(r.marginMm, d.marginMm, 0, 50),
    gapMm: num(r.gapMm, d.gapMm, 0, 50),
    marks: typeof r.marks === "boolean" ? r.marks : d.marks,
    rotate: typeof r.rotate === "boolean" ? r.rotate : d.rotate,
    fill: r.fill === "sequence" ? "sequence" : "repeat",
  };
}

/** The sheet's size in mm (portrait as listed; custom as entered). */
export function sheetSizeMm(s: Pick<ImposeSettings, "sheet" | "widthMm" | "heightMm">): [number, number] {
  return s.sheet === "custom" ? [s.widthMm, s.heightMm] : SHEET_SIZES[s.sheet];
}

export interface ImposeSlot {
  /** Trim box of the item on the sheet. */
  x: number;
  y: number;
  /** How far the item's bleed may reach past each trim edge. */
  bleed: { left: number; right: number; top: number; bottom: number };
}

export interface ImposePlan {
  sheetW: number;
  sheetH: number;
  /** Items turned a quarter (clockwise) in their slots. */
  rotated: boolean;
  cols: number;
  rows: number;
  /** Item size on the sheet (after turning). */
  itemW: number;
  itemH: number;
  slots: ImposeSlot[];
  /** Cut marks, as lines on the sheet. */
  marks: { x1: number; y1: number; x2: number; y2: number }[];
}

export interface ImposeInput {
  /** Trim size of the item and its bleed, mm. */
  itemW: number;
  itemH: number;
  bleed: number;
  /** The sheet in portrait (it may be turned). */
  sheetW: number;
  sheetH: number;
  orientation: ImposeOrientation;
  marginMm: number;
  gapMm: number;
  marks: boolean;
  rotate: boolean;
}

const EPS = 1e-6;
const fit = (avail: number, size: number, gap: number) => Math.max(0, Math.floor((avail + gap + EPS) / (size + gap)));

/** The layout fitting the most items, or null when not even one fits. Ties
 *  go to unturned items, then to portrait. */
export function planImposition(i: ImposeInput): ImposePlan | null {
  // Marks start past the bleed so they never print on the artwork.
  const markStart = Math.max(IMPOSE_MARK.offsetMm, i.bleed + 0.5);
  const reach = i.marks ? markStart + IMPOSE_MARK.lengthMm : 0;
  // Outside the grid the bleed and the marks must fit inside the margin.
  const edge = i.marginMm + Math.max(reach, i.bleed);
  const sheets: [number, number][] = [];
  const portrait: [number, number] = [Math.min(i.sheetW, i.sheetH), Math.max(i.sheetW, i.sheetH)];
  const landscape: [number, number] = [portrait[1], portrait[0]];
  if (i.orientation !== "landscape") sheets.push(portrait);
  if (i.orientation !== "portrait") sheets.push(landscape);
  let best: { sw: number; sh: number; rotated: boolean; cols: number; rows: number } | null = null;
  for (const rotated of i.rotate ? [false, true] : [false]) {
    for (const [sw, sh] of sheets) {
      const w = rotated ? i.itemH : i.itemW;
      const h = rotated ? i.itemW : i.itemH;
      const cols = fit(sw - 2 * edge, w, i.gapMm);
      const rows = fit(sh - 2 * edge, h, i.gapMm);
      if (cols * rows > (best ? best.cols * best.rows : 0)) best = { sw, sh, rotated, cols, rows };
    }
  }
  if (!best) return null;
  const { sw, sh, rotated, cols, rows } = best;
  const itemW = rotated ? i.itemH : i.itemW;
  const itemH = rotated ? i.itemW : i.itemH;
  const gridW = cols * itemW + (cols - 1) * i.gapMm;
  const gridH = rows * itemH + (rows - 1) * i.gapMm;
  const x0 = (sw - gridW) / 2;
  const y0 = (sh - gridH) / 2;
  const inner = Math.min(i.bleed, i.gapMm / 2);
  const slots: ImposeSlot[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      slots.push({
        x: x0 + c * (itemW + i.gapMm),
        y: y0 + r * (itemH + i.gapMm),
        bleed: {
          left: c === 0 ? i.bleed : inner,
          right: c === cols - 1 ? i.bleed : inner,
          top: r === 0 ? i.bleed : inner,
          bottom: r === rows - 1 ? i.bleed : inner,
        },
      });
    }
  }
  const marks: ImposePlan["marks"] = [];
  if (i.marks) {
    const xs = new Set<number>();
    const ys = new Set<number>();
    for (let c = 0; c < cols; c++) { xs.add(x0 + c * (itemW + i.gapMm)); xs.add(x0 + c * (itemW + i.gapMm) + itemW); }
    for (let r = 0; r < rows; r++) { ys.add(y0 + r * (itemH + i.gapMm)); ys.add(y0 + r * (itemH + i.gapMm) + itemH); }
    const l = IMPOSE_MARK.lengthMm;
    const out = markStart;
    for (const x of xs) {
      marks.push({ x1: x, y1: y0 - out, x2: x, y2: y0 - out - l }, { x1: x, y1: y0 + gridH + out, x2: x, y2: y0 + gridH + out + l });
    }
    for (const y of ys) {
      marks.push({ x1: x0 - out, y1: y, x2: x0 - out - l, y2: y }, { x1: x0 + gridW + out, y1: y, x2: x0 + gridW + out + l, y2: y });
    }
  }
  return { sheetW: sw, sheetH: sh, rotated, cols, rows, itemW, itemH, slots, marks };
}

/** Which page goes into which slot of which sheet: "repeat" fills a sheet
 *  with copies of one page, "sequence" fills the slots in page order. */
export function assignSlots(pages: number[], perSheet: number, fill: ImposeFill): number[][] {
  if (perSheet < 1 || !pages.length) return [];
  if (fill === "repeat") return pages.map((p) => Array.from({ length: perSheet }, () => p));
  const sheets: number[][] = [];
  for (let k = 0; k < pages.length; k += perSheet) sheets.push(pages.slice(k, k + perSheet));
  return sheets;
}

/** For the dialogs: how a set of pages of one size lays out (from the first
 *  page), how many fit per sheet and how many sheets the pages make. */
export function imposeSummary(page: { widthMm: number; heightMm: number; bleedMm: number } | null, pageCount: number, s: ImposeSettings, sheetMm: [number, number]): { plan: ImposePlan; perSheet: number; sheets: number } | null {
  if (!page || pageCount < 1) return null;
  const plan = planImposition({ itemW: page.widthMm, itemH: page.heightMm, bleed: page.bleedMm, sheetW: sheetMm[0], sheetH: sheetMm[1], orientation: s.orientation, marginMm: s.marginMm, gapMm: s.gapMm, marks: s.marks, rotate: s.rotate });
  if (!plan) return null;
  const perSheet = plan.slots.length;
  return { plan, perSheet, sheets: s.fill === "repeat" ? pageCount : Math.ceil(pageCount / perSheet) };
}
