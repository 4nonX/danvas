// Browser side of the export check: exports a design through the very
// functions the download menu uses (lib/exportFormats, lib/vectorPdf,
// lib/print/eps) in every format and print variant, and draws a reference of
// each sheet. The reference is drawn without viewport culling, so an element
// the engine wrongly skips while exporting shows up as a difference.
// Bundled by run.mjs; talks to it through window.__exportCheck.

import { createScene, renderScene, type CanvasLike, type Viewport } from "@hc/engine";
import { validate } from "@hc/schema";
import type { DesignFile } from "@hc/schema";
import { imageAssets } from "@/lib/assetProvider";
import { imagePdfBlob, rasterBlob, tiffBlob } from "@/lib/exportFormats";
import { exportVectorPdf, exportVectorSvg } from "@/lib/vectorPdf";
import { exportEps } from "@/lib/print/eps";
import { createCmykConverter, type CmykConverter } from "@/lib/print/cms";
import { checkPrintFile, type FileFinding } from "@/lib/print/fileCheck";
import { applyBlackOnly } from "@/lib/print/proof";
import { spotNamesOf } from "@/lib/print/printColor";
import { renderPageCanvas } from "@/lib/exportFormats";
import { clipToBleed, drawPrintMarks, printSheet, sheetViewport, type PrintExtras, type PrintParts } from "@/lib/print/sheet";
import { installRandomUuidPolyfill } from "@/lib/randomUuidPolyfill";
import { whenRenderable } from "@/lib/loadDesignForExport";
import { fixtures, type Fixture } from "./fixtures";

installRandomUuidPolyfill();

/** Device px per page px of every raster in the check (192 dpi). */
export const SCALE = 2;

export interface Output {
  id: string;
  fixture: string;
  format: "png" | "jpg" | "svg" | "pdf-vector" | "pdf-image" | "eps" | "tiff";
  ext: string;
  /** The file, base64. */
  data: string;
  /** SVG drawn by the browser at the check's scale (PNG, base64). */
  svgRaster?: string;
  cmyk: boolean;
  /** The editor's output check on this file (print files only). */
  fileFindings?: FileFinding[];
  /** Mean ink per process plate the editor's preview computes for this
   *  sheet, in percent; compared with the file's real plates. */
  proofCoverage?: Record<"Cyan" | "Magenta" | "Yellow" | "Black", number>;
  /** The prepress case's exact values (see Fixture.prepress). */
  prepress?: Fixture["prepress"];
  /** Reference key (one reference per fixture, page and print variant). */
  ref: string;
  /** What the file must state. */
  expect: {
    sheetPt: [number, number];
    trimPt: [number, number, number, number];
    bleedPt: [number, number, number, number];
    pdfx?: boolean;
    separations?: string[];
    dpi?: number;
    overprintBlack?: boolean;
  };
}

const b64 = async (blob: Blob) => {
  const u = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

function photos(): { photo: string; alpha: string } {
  const c = document.createElement("canvas");
  c.width = 400; c.height = 300;
  const g = c.getContext("2d")!;
  const lg = g.createLinearGradient(0, 0, 400, 300);
  lg.addColorStop(0, "#1d6fb8"); lg.addColorStop(1, "#f3a712");
  g.fillStyle = lg; g.fillRect(0, 0, 400, 300);
  g.fillStyle = "#ffffff"; g.beginPath(); g.arc(200, 150, 80, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#2b2b2b"; g.fillRect(40, 220, 320, 30);
  const a = document.createElement("canvas");
  a.width = 200; a.height = 200;
  const h = a.getContext("2d")!;
  h.fillStyle = "rgba(200, 30, 60, 0.85)"; h.beginPath(); h.arc(100, 100, 90, 0, Math.PI * 2); h.fill();
  return { photo: c.toDataURL("image/png"), alpha: a.toDataURL("image/png") };
}

/** Images and fonts loaded the way the dashboard export loads them. */
async function ready(doc: DesignFile): Promise<void> {
  await whenRenderable(doc);
  await document.fonts.ready;
}

/** The sheet drawn the way an export draws it, but without culling. */
function reference(doc: DesignFile, index: number, print: PrintParts | false): HTMLCanvasElement {
  const pg = doc.pages[index];
  const sheet = printSheet(pg, doc.dpi ?? 96, print);
  const vp: Viewport = sheetViewport(sheet, SCALE);
  const c = document.createElement("canvas");
  c.width = vp.width; c.height = vp.height;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.save();
  clipToBleed(ctx, sheet, SCALE);
  renderScene(createScene(doc, index), ctx as unknown as CanvasLike, vp, { assets: imageAssets, clear: false, cull: false });
  ctx.restore();
  drawPrintMarks(ctx, sheet, SCALE);
  return c;
}

async function svgRaster(svg: string, w: number, h: number): Promise<string> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL("image/png").split(",")[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

let converter: CmykConverter | null = null;
async function cmyk(): Promise<CmykConverter> {
  if (!converter) {
    const icc = new Uint8Array(await (await fetch("/icc/PSO_Uncoated_ISO12647_eci.icc")).arrayBuffer());
    converter = await createCmykConverter(icc, "relative");
  }
  return converter;
}

/** The preview's plates for page 0, as the proof view computes them. */
function previewCoverage(doc: DesignFile, print: PrintParts, conv: CmykConverter): NonNullable<Output["proofCoverage"]> {
  const canvas = renderPageCanvas(doc, 0, 1, true, print);
  if (!canvas) throw new Error("preview: no canvas");
  const rgba = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
  const n = canvas.width * canvas.height;
  const ink = conv.pixels(rgba, n);
  applyBlackOnly(rgba, ink);
  const sum = [0, 0, 0, 0];
  for (let i = 0; i < ink.length; i += 4) for (let p = 0; p < 4; p++) sum[p] += ink[i + p];
  const pct = (p: number) => (sum[p] / 255 / n) * 100;
  return { Cyan: pct(0), Magenta: pct(1), Yellow: pct(2), Black: pct(3) };
}

/** Every export of one design (page 0) the check covers. */
async function exportAll(fx: Fixture, printCase: boolean, only?: Output["format"][]): Promise<{ outputs: Output[]; refs: Record<string, string>; invalid?: string }> {
  const doc = fx.doc as unknown as DesignFile;
  const v = validate(doc);
  if (!v.ok) return { outputs: [], refs: {}, invalid: `${v.pointer}: ${v.message}` };
  await ready(doc);
  const dpi = doc.dpi ?? 96;
  const outputs: Output[] = [];
  const refs: Record<string, string> = {};
  const pt = (px: number) => (px * 72) / dpi;
  const variant = (name: string, print: PrintParts | false) => {
    const sheet = printSheet(doc.pages[0], dpi, print);
    const key = `${fx.name}/${name}`;
    if (!refs[key]) refs[key] = reference(doc, 0, print).toDataURL("image/png").split(",")[1];
    const m = pt(sheet.margin), b = pt(sheet.bleed);
    const W = pt(sheet.sheetWidth), H = pt(sheet.sheetHeight);
    return { key, sheet, expect: { sheetPt: [W, H] as [number, number], trimPt: [m, m, W - m, H - m] as [number, number, number, number], bleedPt: [m - b, m - b, W - m + b, H - m + b] as [number, number, number, number] } };
  };
  const want = (f: Output["format"]) => !only || only.includes(f);
  const add = async (id: string, format: Output["format"], ext: string, blob: Blob | null, ref: ReturnType<typeof variant>, more: Partial<Output["expect"]> = {}, isCmyk = false, svg?: string) => {
    if (!blob) throw new Error(`${fx.name} ${id}: no file`);
    outputs.push({
      id: `${fx.name}/${id}`, fixture: fx.name, format, ext, data: await b64(blob), cmyk: isCmyk, ref: ref.key,
      expect: { ...ref.expect, ...more },
      svgRaster: svg !== undefined ? await svgRaster(svg, Math.ceil(ref.sheet.sheetWidth * SCALE), Math.ceil(ref.sheet.sheetHeight * SCALE)) : undefined,
    });
  };
  const assets = imageAssets;
  const exportsFor = async (name: string, print: PrintParts | false) => {
    const ref = variant(name, print);
    if (want("png")) await add(`${name}/png`, "png", "png", await rasterBlob(doc, 0, { format: "png", scale: SCALE, opaque: true, print }), ref, { dpi: dpi * SCALE });
    if (want("jpg")) await add(`${name}/jpg`, "jpg", "jpg", await rasterBlob(doc, 0, { format: "jpg", scale: SCALE, opaque: true, print, quality: 95 }), ref, { dpi: dpi * SCALE });
    if (want("svg")) {
      const svg = await exportVectorSvg(doc, 0, { assets, print });
      await add(`${name}/svg`, "svg", "svg", new Blob([svg], { type: "image/svg+xml" }), ref, {}, false, svg);
    }
    if (want("pdf-vector")) await add(`${name}/pdf-vector`, "pdf-vector", "pdf", (await exportVectorPdf(doc, [0], { assets, title: fx.name, print })).blob, ref);
    if (want("pdf-image")) await add(`${name}/pdf-image`, "pdf-image", "pdf", await imagePdfBlob(doc, [0], { scale: SCALE, converter: null, print, title: fx.name }), ref);
    if (want("eps")) await add(`${name}/eps`, "eps", "eps", await exportEps(doc, 0, { assets, title: fx.name, print }), ref);
    if (want("tiff")) await add(`${name}/tiff`, "tiff", "tif", await tiffBlob(doc, 0, { dpi: dpi * SCALE, converter: null, print }), ref, { dpi: dpi * SCALE });
  };
  await exportsFor("page", false);
  if (printCase) {
    const both: PrintParts = { bleed: true, marks: true };
    await exportsFor("sheet", both);
    const conv = await cmyk();
    const extras: PrintExtras = { registration: true, dieLine: { name: "Prägung (Stanze)", radiusMm: 2 } };
    const ref = variant("sheet", both);
    await add("sheet/pdf-vector-cmyk", "pdf-vector", "pdf", (await exportVectorPdf(doc, [0], { assets, title: fx.name, print: both, converter: conv, blackOnly: true, overprintBlack: true, pdfx: true, extras })).blob, ref, { pdfx: true, separations: ["All", "Prägung (Stanze)"], overprintBlack: true }, true);
    await add("sheet/eps-cmyk", "eps", "eps", await exportEps(doc, 0, { assets, title: fx.name, print: both, converter: conv, blackOnly: true, overprintBlack: true, extras }), ref, { separations: ["Prägung (Stanze)"], overprintBlack: true }, true);
    await add("sheet/pdf-image-cmyk", "pdf-image", "pdf", await imagePdfBlob(doc, [0], { scale: SCALE, converter: conv, pdfx: true, print: both, title: fx.name }), ref, { pdfx: true }, true);
    // What the editor's preview and output check say about these files.
    const proofOf = (o: Output) => o.id === `${fx.name}/sheet/pdf-vector-cmyk`;
    for (const o of outputs.filter((x) => x.id.endsWith("sheet/pdf-vector-cmyk") || x.id.endsWith("sheet/eps-cmyk"))) {
      const bytes = Uint8Array.from(atob(o.data), (ch) => ch.charCodeAt(0));
      o.fileFindings = await checkPrintFile(bytes, { kind: o.ext === "eps" ? "eps" : "pdf", cmyk: true, pdfx: o.ext === "pdf", bleed: true, spots: ["Prägung (Stanze)"] });
      if (proofOf(o)) o.proofCoverage = previewCoverage(doc, both, conv);
    }
    await add("sheet/tiff-cmyk", "tiff", "tif", await tiffBlob(doc, 0, { dpi: dpi * SCALE, converter: conv, print: both }), ref, { dpi: dpi * SCALE }, true);
    // The print shop's request: the bleed only, no marks.
    const bleedOnly: PrintParts = { bleed: true, marks: false };
    const refB = variant("bleed", bleedOnly);
    await add("bleed/pdf-vector-cmyk", "pdf-vector", "pdf", (await exportVectorPdf(doc, [0], { assets, title: fx.name, print: bleedOnly, converter: conv, blackOnly: true, overprintBlack: true, pdfx: true })).blob, refB, { pdfx: true }, true);
    const marksOnly: PrintParts = { bleed: false, marks: true };
    const refM = variant("marks", marksOnly);
    await add("marks/pdf-vector", "pdf-vector", "pdf", (await exportVectorPdf(doc, [0], { assets, title: fx.name, print: marksOnly })).blob, refM);
  }
  if (fx.prepress) {
    // Exact print values: CMYK vector PDF and EPS with the bleed, no marks.
    const conv = await cmyk();
    const bleedOnly: PrintParts = { bleed: true, marks: false };
    const ref = variant("print", bleedOnly);
    const more = { pdfx: true, separations: fx.prepress.spots, overprintBlack: false };
    await add("print/pdf-vector-cmyk", "pdf-vector", "pdf", (await exportVectorPdf(doc, [0], { assets, title: fx.name, print: bleedOnly, converter: conv, blackOnly: true, pdfx: true })).blob, ref, more, true);
    await add("print/eps-cmyk", "eps", "eps", await exportEps(doc, 0, { assets, title: fx.name, print: bleedOnly, converter: conv, blackOnly: true }), ref, { separations: fx.prepress.spots }, true);
    for (const o of outputs.filter((x) => x.id.includes("/print/"))) {
      o.prepress = fx.prepress;
      // The editor's output check on it: the design's spot colours expected.
      const bytes = Uint8Array.from(atob(o.data), (ch) => ch.charCodeAt(0));
      o.fileFindings = await checkPrintFile(bytes, { kind: o.ext === "eps" ? "eps" : "pdf", cmyk: true, pdfx: o.ext === "pdf", bleed: true, spots: spotNamesOf(doc) });
    }
  }
  return { outputs, refs };
}

declare global {
  interface Window {
    __exportCheck: {
      list(font: string): { name: string; ink: Fixture["ink"] }[];
      run(font: string, name: string): Promise<{ outputs: Output[]; refs: Record<string, string>; invalid?: string }>;
      runDesign(doc: DesignFile, formats?: Output["format"][]): Promise<{ outputs: Output[]; refs: Record<string, string>; invalid?: string }>;
    };
  }
}

window.__exportCheck = {
  list: (font) => { const p = photos(); return fixtures(font, p.photo, p.alpha).map((f) => ({ name: f.name, ink: f.ink })); },
  run: async (font, name) => {
    const p = photos();
    const fx = fixtures(font, p.photo, p.alpha).find((f) => f.name === name);
    if (!fx) throw new Error(`no fixture ${name}`);
    return exportAll(fx, fx.name === "label");
  },
  // A real design (the --designs mode): every page-0 export, no print case.
  runDesign: (doc, formats) => exportAll({ name: String((doc as unknown as { id?: string }).id ?? "design"), doc: doc as unknown as Record<string, unknown>, ink: [] }, false, formats),
};
