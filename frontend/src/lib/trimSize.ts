// The finished size an export profile is made for (F48): a label profile
// knows it is for 50 x 100 mm, so the download menu can say which designs
// are not, before a wrong file goes to the print shop. It only warns; the
// download stays possible like with every other export check.

import type { DesignFile } from "@hc/schema";
import { tr } from "@/lib/i18n";

/** Width and height of the finished (trimmed) page, in millimetres. */
export interface TrimSize { w: number; h: number }

/** Below this a size counts as matching (a design drawn at 96 dpi is
 *  89.96 mm for 90 mm). */
export const TRIM_TOLERANCE_MM = 0.5;

export function normalizeTrimSize(raw: unknown): TrimSize | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const ok = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 5000;
  return ok(r.w) && ok(r.h) ? { w: Math.round(r.w * 100) / 100, h: Math.round(r.h * 100) / 100 } : null;
}

/** A page's finished size in mm (the page itself, without bleed). */
export function pageSizeMm(doc: DesignFile, index: number): { w: number; h: number } {
  const p = doc.pages[index];
  const dpi = doc.dpi ?? 96;
  return { w: (p.width * 25.4) / dpi, h: (p.height * 25.4) / dpi };
}

export interface TrimMismatch {
  /** The first page not in the size, in mm as exported. */
  wMm: number;
  hMm: number;
  /** It is the size, only turned a quarter (landscape for portrait). */
  turned: boolean;
}

/** Whether the pages are not `size`; `roundMm` compares the whole-mm size
 *  the export makes of them. Null when they all are. */
export function trimMismatch(doc: DesignFile, pages: number[], size: TrimSize, roundMm = false): TrimMismatch | null {
  const near = (a: number, b: number) => Math.abs(a - b) <= TRIM_TOLERANCE_MM;
  for (const i of pages) {
    if (!doc.pages[i]) continue;
    const m = pageSizeMm(doc, i);
    const w = roundMm ? Math.round(m.w) : m.w;
    const h = roundMm ? Math.round(m.h) : m.h;
    if (near(w, size.w) && near(h, size.h)) continue;
    return { wMm: w, hMm: h, turned: near(w, size.h) && near(h, size.w) };
  }
  return null;
}

const mm = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });
/** "50 x 100 mm" */
export function trimSizeText(s: { w: number; h: number }): string {
  return `${mm(s.w)} × ${mm(s.h)} mm`; // i18n-ignore: a size
}

/** How one design is off: "90 × 40 mm" or "100 × 50 mm, landscape instead
 *  of portrait". */
export function mismatchText(m: TrimMismatch, size: TrimSize): string {
  const got = trimSizeText({ w: m.wMm, h: m.hMm });
  if (!m.turned) return got;
  return tr(size.h > size.w ? "editor.trim_turned_landscape" : "editor.trim_turned_portrait", { size: got });
}
