// Print presets: named settings of the print dialog (printing on one's own
// printer through the system dialog), kept apart from the download menu's
// export profiles but stored the same way (kind "print"). Defined, completed
// and described here like lib/exportProfiles.

import { normalizeProfilePrint, type ProfilePrint } from "@/lib/exportProfiles";
import { PRINT_PAPERS, type PrintPaper } from "@/lib/printDocument";
import { tr } from "@/lib/i18n";

export interface PrintSettings {
  v: 1;
  /** Every page, or the one being edited (the editor). */
  pages: "all" | "current";
  /** "actual": the design's physical size on the paper (100 %); "fit":
   *  scaled to the paper the printer has. */
  size: "actual" | "fit";
  /** The paper handed to the printer driver: each page's own size (label and
   *  roll printers, Save as PDF) or a standard sheet. */
  paper: PrintPaper;
  /** Raster resolution sent to the printer. */
  dpi: (typeof PRINT_DPIS)[number];
  print: ProfilePrint;
}

/** The usual printer resolutions: 203 and 300 dpi are the dot grids of label
 *  and thermal printers (8 and 11.8 dots per mm), 600 and 1200 dpi office
 *  lasers. Printing at a printer's own resolution keeps every barcode bar a
 *  whole number of its dots. */
export const PRINT_DPIS = [150, 200, 203, 300, 600, 1200] as const;

/** A resolution as offered in the pickers, with what it is for where that helps. */
export function printDpiLabel(dpi: number): string {
  if (dpi === 150) return tr("editor.print_dpi_draft", { dpi });
  if (dpi === 203) return tr("editor.print_dpi_label_printer", { dpi });
  if (dpi === 300) return tr("editor.print_dpi_label_or_office", { dpi });
  if (dpi === 1200) return tr("editor.print_dpi_laser", { dpi });
  return tr("editor.print_dpi_value", { dpi });
}

/** Longest side, in pixels, a page is rendered at for printing (browser memory). */
export const PRINT_MAX_DIM = 7000;

/** The render scale for one print sheet: the chosen resolution, reduced so the
 *  sheet's longest side stays within PRINT_MAX_DIM. `docDpi` is the design's own
 *  resolution (pixels per inch of its page units). */
export function printScale(sheetWidth: number, sheetHeight: number, docDpi: number, dpi: number): number {
  return Math.max(0.1, Math.min(dpi / docDpi, PRINT_MAX_DIM / Math.max(1, sheetWidth, sheetHeight)));
}

/** The lowest resolution any of `sheets` actually prints at, rounded down, when
 *  it falls noticeably (over 5 %) below the chosen `dpi`; otherwise null. */
export function cappedPrintDpi(sheets: { sheetWidth: number; sheetHeight: number; docDpi: number }[], dpi: number): number | null {
  let lowest = Infinity;
  for (const s of sheets) lowest = Math.min(lowest, printScale(s.sheetWidth, s.sheetHeight, s.docDpi, dpi) * s.docDpi);
  return lowest < dpi * 0.95 ? Math.floor(lowest) : null;
}

export function defaultPrintSettings(): PrintSettings {
  return { v: 1, pages: "all", size: "actual", paper: "a4", dpi: 200, print: { source: "page", bleed: false, marks: false } };
}

/** A stored preset's settings as a complete, valid object. */
export function normalizePrintSettings(raw: unknown): PrintSettings {
  const d = defaultPrintSettings();
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const print = normalizeProfilePrint(r.print, d.print);
  return {
    v: 1,
    pages: r.pages === "current" ? "current" : "all",
    size: r.size === "fit" ? "fit" : "actual",
    paper: PRINT_PAPERS.includes(r.paper as PrintPaper) ? (r.paper as PrintPaper) : d.paper,
    dpi: PRINT_DPIS.includes(r.dpi as 150) ? (r.dpi as PrintSettings["dpi"]) : d.dpi,
    print,
  };
}

/** The name of a paper choice (A4 and the like are not translated). */
export function paperLabel(p: PrintPaper): string {
  // i18n-ignore: paper format names are the same in every language
  return p === "design" ? tr("editor.print_paper_design") : p === "letter" ? "Letter" : p.toUpperCase();
}

export function samePrintSettings(a: PrintSettings, b: PrintSettings): boolean {
  return JSON.stringify(normalizePrintSettings(a)) === JSON.stringify(normalizePrintSettings(b));
}

const mm = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/** One line saying what a preset does ("Actual size · 300 dpi · bleed 1.5 mm"). */
export function describePrintSettings(s: PrintSettings): string {
  const parts = [paperLabel(s.paper), s.size === "actual" ? tr("editor.print_size_actual") : tr("editor.print_size_fit"), `${s.dpi} dpi`];
  if (s.pages === "current") parts.push(tr("editor.current_page"));
  if (s.print.source === "fixed") {
    const o = s.print.override;
    if (o.bleed) parts.push(tr("editor.profile_bleed_mm", { mm: mm(o.bleedMm) }));
    if (o.marks) parts.push(tr("editor.profile_crop_marks"));
  } else if (s.print.bleed || s.print.marks) {
    parts.push(tr("editor.profile_page_print"));
  }
  return parts.join(" · ");
}
