// Vector PDF export: renders pages through the regular engine into PdfCanvas
// (pdfCanvas.ts) and assembles a PDF 1.7 file at the design's true physical
// size (page px at the document dpi -> points). Text is outlined, so the file
// prints identically on any machine without the fonts installed.

import type { DesignFile } from "@hc/schema";
import { createScene, renderScene, type CanvasLike, type Viewport } from "@hc/engine";
import { loadFace, type FaceRequest, type LoadedFace } from "./fontSource";
import { num, PdfCanvas, PdfResources, type ColorOut, type PdfPageStats } from "./pdfCanvas";

export { num, type ColorOut } from "./pdfCanvas";

/** Resolution used for effect patches (shadows, blurs) and SVG images. */
const PATCH_DPI = 600;
/** Upper bound for one page's device canvas, in pixels. */
const MAX_DEVICE_PIXELS = 36e6;

const enc = new TextEncoder();

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** PDF text string (UTF-16BE with BOM), safe for any title. */
function pdfString(s: string): string {
  let hex = "FEFF";
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, "0");
  return `<${hex}>`;
}

class PdfWriter {
  private parts: Uint8Array[] = [];
  private offsets: number[] = [];
  private length = 0;

  constructor() {
    this.push(enc.encode("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n"));
  }
  private push(b: Uint8Array) {
    this.parts.push(b);
    this.length += b.length;
  }
  /** Reserve an object number. */
  alloc(): number {
    this.offsets.push(-1);
    return this.offsets.length;
  }
  obj(id: number, body: string): void {
    this.offsets[id - 1] = this.length;
    this.push(enc.encode(`${id} 0 obj\n${body}\nendobj\n`));
  }
  stream(id: number, dict: string, data: Uint8Array): void {
    this.offsets[id - 1] = this.length;
    this.push(enc.encode(`${id} 0 obj\n<< ${dict} /Length ${data.length} >>\nstream\n`));
    this.push(data);
    this.push(enc.encode("\nendstream\nendobj\n"));
  }
  finish(rootId: number, infoId: number): Blob {
    const xref = this.length;
    const lines = [`xref\n0 ${this.offsets.length + 1}\n0000000000 65535 f \n`];
    for (const off of this.offsets) lines.push(`${String(Math.max(0, off)).padStart(10, "0")} 00000 n \n`);
    lines.push(`trailer\n<< /Size ${this.offsets.length + 1} /Root ${rootId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    this.push(enc.encode(lines.join("")));
    return new Blob(this.parts as BlobPart[], { type: "application/pdf" });
  }
}

export interface VectorPdfResult {
  blob: Blob;
  /** Page size in millimetres (first page), for the UI. */
  widthMm: number;
  heightMm: number;
  stats: PdfPageStats;
}

export interface VectorPdfOptions {
  assets?: unknown;
  title?: string;
}

export interface DrawPagesOptions {
  assets?: unknown;
  /** Write colours as CMYK through a profile. */
  color?: ColorOut;
  /** Flatten transparency onto a paper-white backdrop (EPS, PDF/X-1a). */
  flatten?: boolean;
}

export interface DrawnPage {
  index: number;
  pg: DesignFile["pages"][number];
  /** Device px per page px. */
  zoom: number;
  width: number;
  height: number;
  /** Content operators in device space (y down). */
  content: string;
}

/** Draw the given pages through PdfCanvas: content operators per page plus
 *  the shared resources (images, shadings, graphics states). The vector PDF
 *  and the PostScript exports both assemble their files from this. */
export async function drawPages(doc: DesignFile, pageIndexes: number[], opts: DrawPagesOptions = {}): Promise<{ dpi: number; pages: DrawnPage[]; resources: PdfResources; stats: PdfPageStats }> {
  const dpi = (doc as unknown as { dpi?: number }).dpi ?? 96;
  const docFonts = ((doc as unknown as { fonts?: { family?: string; url?: string }[] }).fonts) ?? [];
  if (typeof document !== "undefined" && document.fonts?.ready) await document.fonts.ready;

  const pages = pageIndexes.map((i) => {
    const pg = doc.pages[i];
    let zoom = PATCH_DPI / dpi;
    zoom = Math.min(zoom, Math.sqrt(MAX_DEVICE_PIXELS / Math.max(1, pg.width * pg.height)));
    const width = Math.ceil(pg.width * zoom);
    const height = Math.ceil(pg.height * zoom);
    const vp: Viewport = { zoom, panX: 0, panY: 0, dpr: 1, width, height };
    return { index: i, pg, zoom, width, height, vp };
  });
  const renderOpts = { assets: opts.assets, clear: false } as Parameters<typeof renderScene>[3];

  // Pass 1: which font faces does the text use?
  const wanted = new Map<string, FaceRequest>();
  const collectRes = new PdfResources();
  for (const p of pages) {
    const ctx = new PdfCanvas({ width: p.width, height: p.height, faces: new Map(), resources: collectRes, collect: wanted });
    renderScene(createScene(doc, p.index), ctx as unknown as CanvasLike, p.vp, renderOpts);
  }
  const faces = new Map<string, LoadedFace | null>();
  await Promise.all([...wanted].map(async ([key, req]) => faces.set(key, await loadFace(req, docFonts))));

  // Pass 2: draw.
  const resources = new PdfResources();
  const stats: PdfPageStats = { vectorOps: 0, textRuns: 0, rasterPatches: 0, images: 0 };
  const out: DrawnPage[] = [];
  for (const p of pages) {
    let backdrop: CanvasRenderingContext2D | undefined;
    if (opts.flatten) {
      const c = document.createElement("canvas");
      c.width = p.width;
      c.height = p.height;
      backdrop = c.getContext("2d", { willReadFrequently: true })!;
      backdrop.fillStyle = "#ffffff";
      backdrop.fillRect(0, 0, p.width, p.height);
    }
    const ctx = new PdfCanvas({ width: p.width, height: p.height, faces, resources, color: opts.color, backdrop });
    renderScene(createScene(doc, p.index), ctx as unknown as CanvasLike, p.vp, renderOpts);
    out.push({ index: p.index, pg: p.pg, zoom: p.zoom, width: p.width, height: p.height, content: ctx.content() });
    for (const k of Object.keys(stats) as (keyof PdfPageStats)[]) stats[k] += ctx.stats[k];
  }
  return { dpi, pages: out, resources, stats };
}

/** Render the given pages of a design to one vector PDF. */
export async function exportVectorPdf(doc: DesignFile, pageIndexes: number[], opts: VectorPdfOptions = {}): Promise<VectorPdfResult> {
  const { dpi, pages, resources, stats } = await drawPages(doc, pageIndexes, { assets: opts.assets });
  const contents = pages.map((p) => ({ content: p.content, p }));

  const w = new PdfWriter();
  const catalogId = w.alloc();
  const pagesId = w.alloc();
  const resId = w.alloc();
  const infoId = w.alloc();

  // Images (+ alpha as soft masks).
  const imageRefs: string[] = [];
  for (const img of resources.images) {
    const n = img.width * img.height;
    const rgb = new Uint8Array(n * 3);
    const alpha = new Uint8Array(n);
    let opaque = true;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const a = img.rgba[j + 3];
      alpha[i] = a;
      if (a !== 255) opaque = false;
      // Canvas pixels are not premultiplied in ImageData; store as-is.
      rgb[i * 3] = img.rgba[j];
      rgb[i * 3 + 1] = img.rgba[j + 1];
      rgb[i * 3 + 2] = img.rgba[j + 2];
    }
    const id = w.alloc();
    let smask = "";
    if (!opaque) {
      const sid = w.alloc();
      w.stream(sid, `/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, await deflate(alpha));
      smask = ` /SMask ${sid} 0 R`;
    }
    w.stream(id, `/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Interpolate true /Filter /FlateDecode${smask}`, await deflate(rgb));
    imageRefs.push(`/${img.name} ${id} 0 R`);
  }
  w.obj(resId, `<< /ExtGState << ${resources.extGStateDict()} >> /XObject << ${imageRefs.join(" ")} >> /Shading << ${resources.shadings.map((s) => `/${s.name} ${s.dict}`).join(" ")} >> >>`);

  const kids: number[] = [];
  for (const { content, p } of contents) {
    const wPt = (p.pg.width * 72) / dpi;
    const hPt = (p.pg.height * 72) / dpi;
    const k = 72 / (dpi * p.zoom);
    const stream = `${num(k)} 0 0 ${num(-k)} 0 ${num(hPt)} cm\n${content}`;
    const cid = w.alloc();
    w.stream(cid, "/Filter /FlateDecode", await deflate(enc.encode(stream)));
    const pid = w.alloc();
    const box = `[0 0 ${num(wPt)} ${num(hPt)}]`;
    w.obj(pid, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox ${box} /TrimBox ${box} /Resources ${resId} 0 R /Contents ${cid} 0 R >>`);
    kids.push(pid);
  }
  w.obj(pagesId, `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] /Count ${kids.length} >>`);
  w.obj(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const d = new Date();
  const pad = (v: number) => String(v).padStart(2, "0");
  const created = `D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  w.obj(infoId, `<< /Producer (HyCanvas) /Creator (HyCanvas vector PDF) /Title ${pdfString(opts.title ?? doc.title ?? "Design")} /CreationDate (${created}) >>`);

  const first = pages[0]?.pg;
  return {
    blob: w.finish(catalogId, infoId),
    widthMm: first ? (first.width / dpi) * 25.4 : 0,
    heightMm: first ? (first.height / dpi) * 25.4 : 0,
    stats,
  };
}
