// The raster and print formats of the download menu, as functions of the
// design alone: PNG, JPG, TIFF and the image PDF. The dialog calls these, and
// so does the export check (tests/export), so what is checked is exactly what
// a user downloads. The vector formats (PDF, EPS, SVG) live in lib/vectorPdf
// and lib/print/eps.

import type { DesignFile } from "@hc/schema";
import { createScene, renderScene, type CanvasLike, type Render2DOptions, type Viewport } from "@hc/engine";
import { imageAssets } from "@/lib/assetProvider";
import { clipToBleed, drawPrintMarks, printSheet, sheetViewport, type PrintParts, type PrintSheet } from "@/lib/print/sheet";
import type { ImposeSettings } from "@/lib/print/impose";
import { setJpegDpi, setPngDpi } from "@/lib/print/rasterMeta";
import type { CmykConverter } from "@/lib/print/cms";
import { hasOverprint, withoutDieLines } from "@/lib/print/nodePrint";

/** Where images come from (the app's asset provider by default). */
type Assets = Render2DOptions["assets"];

/**
 * One page drawn on a canvas at `scale` (device px per page px). Opaque fills
 * white first (JPG, PDF, TIFF, opaque PNG); otherwise the page background is
 * left out too, so a transparent PNG really is transparent. With `print`
 * the canvas is the page's print sheet: its bleed and/or crop marks. Die
 * line elements are cut information and never drawn (lib/print/nodePrint).
 */
export function renderPageCanvas(source: DesignFile, index: number, scale: number, opaque: boolean, print: PrintParts | false = false, assets: Assets = imageAssets as Assets): HTMLCanvasElement | null {
  const doc = withoutDieLines(source);
  const pg = doc.pages[index];
  if (!pg) return null;
  if (print && (print.bleed || print.marks)) {
    const sheet = printSheet(pg, doc.dpi ?? 96, print);
    const vp = sheetViewport(sheet, scale);
    const canvas = document.createElement("canvas");
    canvas.width = vp.width;
    canvas.height = vp.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    if (opaque) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, vp.width, vp.height);
    }
    ctx.save();
    clipToBleed(ctx, sheet, scale);
    renderScene(createScene(doc, index), ctx as unknown as CanvasLike, vp, { assets, clear: false, skipBackground: !opaque });
    ctx.restore();
    drawPrintMarks(ctx, sheet, scale);
    return canvas;
  }
  const w = Math.max(1, Math.round(pg.width * scale));
  const h = Math.max(1, Math.round(pg.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  if (opaque) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }
  const vp: Viewport = { zoom: scale, panX: 0, panY: 0, dpr: 1, width: w, height: h };
  renderScene(createScene(doc, index), ctx as unknown as CanvasLike, vp, { assets, clear: false, skipBackground: !opaque });
  return canvas;
}

/** A page as PNG or JPEG, with the resolution written into the file (the
 *  page's physical size kept). */
export async function rasterBlob(doc: DesignFile, index: number, o: { format: "png" | "jpg"; scale: number; opaque: boolean; print?: PrintParts | false; quality?: number; assets?: Assets }): Promise<Blob | null> {
  const canvas = renderPageCanvas(doc, index, o.scale, o.format === "jpg" || o.opaque, o.print ?? false, o.assets);
  if (!canvas) return null;
  const type = o.format === "png" ? "image/png" : "image/jpeg";
  const raw: Blob | null = await new Promise((res) => canvas.toBlob(res, type, o.format === "jpg" ? (o.quality ?? 92) / 100 : undefined));
  if (!raw) return null;
  const bytes = new Uint8Array(await raw.arrayBuffer());
  const ppi = (doc.dpi ?? 96) * o.scale;
  return new Blob([(o.format === "png" ? setPngDpi(bytes, ppi) : setJpegDpi(bytes, ppi)) as BlobPart], { type });
}

/** A page as TIFF at `dpi`: CMYK through the converter (its profile
 *  embedded) or RGB. */
export async function tiffBlob(doc: DesignFile, index: number, o: { dpi: number; converter: CmykConverter | null; print?: PrintParts | false; assets?: Assets }): Promise<Blob | null> {
  const { encodeTiff } = await import("@/lib/print/tiff");
  // Elements that overprint: the inks as they print over each other.
  if (o.converter && hasOverprint(doc, [index])) {
    const { pageCmyk } = await import("@/lib/print/proofRender");
    const r = pageCmyk(doc, index, o.dpi / (doc.dpi ?? 96), o.print ?? false, o.converter, false);
    return encodeTiff({ width: r.width, height: r.height, data: r.cmyk, mode: "cmyk", dpi: o.dpi, icc: o.converter.icc });
  }
  const canvas = renderPageCanvas(doc, index, o.dpi / (doc.dpi ?? 96), true, o.print ?? false, o.assets);
  if (!canvas) return null;
  const rgba = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
  const n = canvas.width * canvas.height;
  let data: Uint8Array;
  if (o.converter) data = o.converter.pixels(rgba, n);
  else {
    data = new Uint8Array(n * 3);
    for (let j = 0; j < n; j++) { data[j * 3] = rgba[j * 4]; data[j * 3 + 1] = rgba[j * 4 + 1]; data[j * 3 + 2] = rgba[j * 4 + 2]; }
  }
  return encodeTiff({ width: canvas.width, height: canvas.height, data, mode: o.converter ? "cmyk" : "rgb", dpi: o.dpi, icc: o.converter?.icc });
}

/** The image PDF: one picture per page at `scale`, CMYK through the
 *  converter or RGB, with the sheets' page boxes, optionally PDF/X-4. With
 *  `impose`, one picture per imposed sheet (F45). */
export async function imagePdfBlob(doc: DesignFile, pages: number[], o: { scale: number; converter: CmykConverter | null; pdfx?: boolean; print?: PrintParts | false; title?: string; assets?: Assets; impose?: { settings: ImposeSettings; sheetMm: [number, number] } }): Promise<Blob | null> {
  const { exportImagePdf } = await import("@/lib/vectorPdf");
  const dpi = doc.dpi ?? 96;
  if (o.impose) {
    const { imposeCanvases } = await import("@/lib/print/imposeRaster");
    const sheets = imposeCanvases(doc, pages, o.impose.settings, o.impose.sheetMm, dpi * o.scale, !!o.print && o.print.bleed);
    if (!sheets.length) return null;
    return exportImagePdf(sheets.map((s) => {
      // The sheet is trim, bleed and media box at once.
      const w = (s.widthMm / 25.4) * dpi, h = (s.heightMm / 25.4) * dpi;
      const sheet: PrintSheet = { width: w, height: h, bleed: 0, margin: 0, sheetWidth: w, sheetHeight: h, marks: [], stroke: { color: "#000000", width: 0, dash: [], cap: "butt" } };
      return { rgba: s.canvas.getContext("2d")!.getImageData(0, 0, s.canvas.width, s.canvas.height).data, width: s.canvas.width, height: s.canvas.height, sheet };
    }), dpi, { title: o.title, converter: o.converter, pdfx: !!o.converter && !!o.pdfx });
  }
  const imgs = [];
  for (const i of pages) {
    const pg = doc.pages[i];
    if (!pg) continue;
    // Elements that overprint: the inks as they print over each other.
    if (o.converter && hasOverprint(doc, [i])) {
      const { pageCmyk } = await import("@/lib/print/proofRender");
      const r = pageCmyk(doc, i, o.scale, o.print ?? false, o.converter, false);
      imgs.push({ rgba: r.rgba, cmyk: r.cmyk, width: r.width, height: r.height, sheet: printSheet(pg, dpi, o.print ?? false) });
      continue;
    }
    const canvas = renderPageCanvas(doc, i, o.scale, true, o.print ?? false, o.assets);
    if (!canvas) continue;
    imgs.push({ rgba: canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height, sheet: printSheet(pg, dpi, o.print ?? false) });
  }
  if (!imgs.length) return null;
  return exportImagePdf(imgs, dpi, { title: o.title, converter: o.converter, pdfx: !!o.converter && !!o.pdfx });
}
