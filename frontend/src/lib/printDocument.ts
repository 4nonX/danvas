// The document handed to the browser's print, and through it to the system
// printer driver. What the driver receives is the page size (@page) and one
// image per page: it lays them onto the printer's paper itself. So the paper
// has to be one the printer has:
//
// - "design": paper the size of each page's sheet (page plus bleed and
//   marks), for label and roll printers loaded with that media, and "Save as
//   PDF". Each size gets a named @page, so pages of different sizes keep
//   their own.
// - a standard sheet (A4, A3, Letter), turned to fit the design: at actual
//   size the design sits in the middle at 100 %; fitted, it is scaled into a
//   margin most printers can print to.
//
// The browser sends RGB; colour management is the driver's. Printing at
// actual size also needs 100 % ("Default") scaling in the system dialog.

export type PrintPaper = "design" | "a4" | "a3" | "letter";
export type PrintSize = "actual" | "fit";

export const PRINT_PAPERS: PrintPaper[] = ["design", "a4", "a3", "letter"];

const PAPER_MM: Record<Exclude<PrintPaper, "design">, [number, number]> = {
  a4: [210, 297],
  a3: [297, 420],
  letter: [215.9, 279.4],
};

/** A standard paper in portrait, mm. */
export function paperSizeMm(paper: Exclude<PrintPaper, "design">): [number, number] {
  return PAPER_MM[paper];
}

/** How much shorter than the paper each page's box is (see printHtml). */
const SAFETY_MM = 0.5;

/** Margin left for the printer's unprintable edge when fitting. */
export const FIT_MARGIN_MM = 6;

export interface PrintPage {
  url: string;
  /** The printed sheet (page plus bleed and marks), mm. */
  widthMm: number;
  heightMm: number;
}

/** The paper a page goes on, mm, turned to the page's orientation. */
export function paperFor(page: Pick<PrintPage, "widthMm" | "heightMm">, paper: PrintPaper): { widthMm: number; heightMm: number } {
  if (paper === "design") return { widthMm: page.widthMm, heightMm: page.heightMm };
  const [a, b] = PAPER_MM[paper];
  return page.widthMm > page.heightMm ? { widthMm: b, heightMm: a } : { widthMm: a, heightMm: b };
}

/** Pages that do not fit their paper at actual size (they would be cut). */
export function oversizedPages(pages: Pick<PrintPage, "widthMm" | "heightMm">[], paper: PrintPaper, size: PrintSize): number {
  if (paper === "design" || size === "fit") return 0;
  return pages.filter((p) => {
    const sheet = paperFor(p, paper);
    return p.widthMm > sheet.widthMm + 0.01 || p.heightMm > sheet.heightMm + 0.01;
  }).length;
}

const mm = (n: number) => n.toFixed(2);

/** The print frame's document: one named @page per paper size, one image
 *  per page, placed at actual size or fitted. */
export function printHtml(pages: PrintPage[], o: { size: PrintSize; paper: PrintPaper; title: string }): string {
  const sheets = pages.map((p) => paperFor(p, o.paper));
  const keys = [...new Set(sheets.map((s) => `${mm(s.widthMm)}x${mm(s.heightMm)}`))];
  const fit = o.size === "fit";
  const css = keys.map((k, i) => {
    const [w, h] = k.split("x");
    return `@page s${i} { size: ${w}mm ${h}mm; margin: 0; }`;
  }).join("\n");
  const body = pages.map((p, i) => {
    const s = sheets[i];
    const name = `s${keys.indexOf(`${mm(s.widthMm)}x${mm(s.heightMm)}`)}`;
    // A box a hair shorter than the paper (content exactly as tall as the
    // page overflows it by rounding, and the browser then adds blank pages
    // of a default size, which the driver prints too). The image is placed
    // absolutely, centred, so it never takes part in the page breaking: at
    // its own size, or fitted within the printable margin.
    const pad = fit && o.paper !== "design" ? FIT_MARGIN_MM : 0;
    const img = fit
      ? `<img src="${p.url}" alt="" style="left: ${pad}mm; top: ${pad}mm; width: calc(100% - ${2 * pad}mm); height: calc(100% - ${2 * pad}mm); object-fit: contain">`
      : `<img src="${p.url}" alt="" style="left: 50%; top: 50%; width: ${mm(p.widthMm)}mm; height: ${mm(p.heightMm)}mm; transform: translate(-50%, -50%)">`;
    return `<div class="pg" style="page: ${name}; width: ${mm(s.widthMm)}mm; height: ${mm(s.heightMm - SAFETY_MM)}mm">${img}</div>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${o.title.replace(/[<>&]/g, "")}</title>
<style>
${css}
html, body { margin: 0; padding: 0; background: #fff; }
.pg { position: relative; overflow: hidden; break-after: page; break-inside: avoid; }
.pg:last-child { break-after: auto; }
img { position: absolute; display: block; }
</style></head><body>${body}</body></html>`;
}
