// Vector exports: render pages through the regular engine into a recording
// canvas (pdfCanvas.ts, svgCanvas.ts). The PDF export assembles a PDF 1.7
// file at the design's true physical size (page px at the document dpi ->
// points), the SVG export one standalone file per page. Text is outlined, so
// both look identical on any machine without the fonts installed.

import { resolveReadingOrder, type DesignFile } from "@hc/schema";
import { createScene, renderScene, type CanvasLike, type Viewport } from "@hc/engine";
import { loadFace, type FaceRequest, type LoadedFace } from "./fontSource";
import { num, PdfCanvas, PdfResources, type ColorOut, type PdfPageStats, type PdfTag, type TextFont } from "./pdfCanvas";
import { SvgCanvas } from "./svgCanvas";
import { tr } from "@/lib/i18n";
import { resolveAssetUrl } from "@/lib/sdk";

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
  /** Tagged (accessible) PDF: structure tree in reading order, alt text,
   *  artifacts, and a real-text layer under the outlined glyphs. */
  tagged?: boolean;
  /** Natural language (BCP 47) when the design does not state one. */
  lang?: string;
}

export interface DrawPagesOptions {
  assets?: unknown;
  /** Write colours as CMYK through a profile. */
  color?: ColorOut;
  /** Flatten transparency onto a paper-white backdrop (EPS, PDF/X-1a). */
  flatten?: boolean;
  /** Mark up the drawing for a tagged PDF (see PdfCanvasOptions.tagged). */
  tagged?: boolean;
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
  /** Tagged mode: the page's tags in reading order (each points at its
   *  marked content by mcid). */
  tags?: PdfTag[];
}

/** Draw the given pages through PdfCanvas: content operators per page plus
 *  the shared resources (images, shadings, graphics states). The vector PDF
 *  and the PostScript exports both assemble their files from this. */
/** Shared setup of every vector export: the device size of each page and
 *  the font files its text needs (found by drawing the pages once in a
 *  collect pass, then loaded). */
async function preparePages(doc: DesignFile, pageIndexes: number[], assets: unknown) {
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
  const renderOpts = { assets, clear: false } as Parameters<typeof renderScene>[3];

  // Pass 1: which font faces does the text use?
  const wanted = new Map<string, FaceRequest>();
  const collectRes = new PdfResources();
  for (const p of pages) {
    const ctx = new PdfCanvas({ width: p.width, height: p.height, faces: new Map(), resources: collectRes, collect: wanted });
    renderScene(createScene(doc, p.index), ctx as unknown as CanvasLike, p.vp, renderOpts);
  }
  const faces = new Map<string, LoadedFace | null>();
  await Promise.all([...wanted].map(async ([key, req]) => faces.set(key, await loadFace(req, docFonts))));
  // SVG assets by the absolute URL their image element loads.
  const vectorSources = new Set<string>();
  for (const a of (doc as unknown as { assets?: { url?: string; mime?: string; kind?: string }[] }).assets ?? []) {
    if (!a.url || (a.kind !== "svg" && !/^image\/svg/i.test(a.mime ?? ""))) continue;
    try {
      vectorSources.add(new URL(resolveAssetUrl(a.url), typeof location === "undefined" ? undefined : location.href).href);
    } catch {
      /* not a URL: nothing loads it as an image either */
    }
  }
  return { dpi, pages, renderOpts, faces, vectorSources };
}

export async function drawPages(doc: DesignFile, pageIndexes: number[], opts: DrawPagesOptions = {}): Promise<{ dpi: number; pages: DrawnPage[]; resources: PdfResources; stats: PdfPageStats }> {
  const { dpi, pages, renderOpts, faces, vectorSources } = await preparePages(doc, pageIndexes, opts.assets);

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
    const ctx = new PdfCanvas({ width: p.width, height: p.height, faces, vectorSources, resources, color: opts.color, backdrop, tagged: opts.tagged });
    const hooks = opts.tagged ? { onNodeEnter: (n: Parameters<PdfCanvas["nodeEnter"]>[0]) => ctx.nodeEnter(n), onNodeExit: (n: Parameters<PdfCanvas["nodeExit"]>[0]) => ctx.nodeExit(n) } : {};
    renderScene(createScene(doc, p.index), ctx as unknown as CanvasLike, p.vp, { ...renderOpts, ...hooks });
    let tags: PdfTag[] | undefined;
    if (opts.tagged) {
      // Content is drawn in z-order, the structure is read in reading order:
      // the tags of each top-level element, elements in the author's order.
      const { tags: drawn, tops } = ctx.structure();
      const rank = new Map(resolveReadingOrder(p.pg).map((n, i) => [n.id, i]));
      const rankOf = (t: PdfTag) => rank.get(tops[t.top]) ?? Number.MAX_SAFE_INTEGER;
      tags = [...drawn].sort((a, b) => rankOf(a) - rankOf(b) || a.mcid - b.mcid);
    }
    out.push({ index: p.index, pg: p.pg, zoom: p.zoom, width: p.width, height: p.height, content: ctx.content(), tags });
    for (const k of Object.keys(stats) as (keyof PdfPageStats)[]) stats[k] += ctx.stats[k];
  }
  return { dpi, pages: out, resources, stats };
}

/** A BCP 47 tag as the tagged PDF's /Lang: the design's own language
 *  (`language`, or `meta.language` in older files), else the given fallback. */
function docLang(doc: DesignFile, fallback?: string): string {
  const d = doc as unknown as { language?: string; meta?: { language?: string } };
  const ok = (t?: string) => !!t && t.length <= 35 && /^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8}){0,2}$/.test(t);
  for (const t of [d.language, d.meta?.language, fallback]) if (ok(t)) return t!;
  return "en-US";
}

/** Write one text-layer font (Type0 / CIDFontType2, Identity-H with glyph ids
 *  as CIDs) and return its object number. Not embedded: text in render mode
 *  3 is never drawn, so viewers only need the widths, which keep selection
 *  boxes on the words, and the ToUnicode map, which gives the characters. */
async function writeTextFont(w: PdfWriter, tf: TextFont): Promise<number> {
  const f = tf.font;
  const k = 1000 / f.unitsPerEm;
  const base = (f.postscriptName ?? "").replace(/[^A-Za-z0-9+-]/g, "") || `Font${tf.name}`;
  const gids = [...tf.glyphs.keys()].sort((a, b) => a - b);
  const widths = gids.map((g) => `${g} [${num(tf.glyphs.get(g)!.width)}]`).join(" ");
  const utf16 = (s: string) => {
    let h = "";
    for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, "0");
    return h || "FFFD";
  };
  const hex = (g: number) => g.toString(16).padStart(4, "0");
  const lines: string[] = [];
  for (let i = 0; i < gids.length; i += 100) {
    const chunk = gids.slice(i, i + 100);
    lines.push(`${chunk.length} beginbfchar`, ...chunk.map((g) => `<${hex(g)}> <${utf16(tf.glyphs.get(g)!.unicode)}>`), "endbfchar");
  }
  const cmap = [
    "/CIDInit /ProcSet findresource begin", "12 dict begin", "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def", "/CMapType 2 def",
    "1 begincodespacerange", "<0000> <FFFF>", "endcodespacerange",
    // i18n-ignore: PostScript CMap program.
    ...lines, "endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end",
  ].join("\n");
  const bb = f.bbox;
  const toUnicode = w.alloc();
  const descriptor = w.alloc();
  const cid = w.alloc();
  const type0 = w.alloc();
  w.stream(toUnicode, "/Filter /FlateDecode", await deflate(enc.encode(cmap)));
  w.obj(descriptor, `<< /Type /FontDescriptor /FontName /${base} /Flags 32 /FontBBox [${[bb.minX, bb.minY, bb.maxX, bb.maxY].map((v) => num(v * k)).join(" ")}] /ItalicAngle 0 /Ascent ${num(f.ascent * k)} /Descent ${num(f.descent * k)} /CapHeight ${num((f.capHeight || f.ascent) * k)} /StemV 80 >>`);
  w.obj(cid, `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${base} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /DW 1000 /W [${widths}] /CIDToGIDMap /Identity >>`);
  w.obj(type0, `<< /Type /Font /Subtype /Type0 /BaseFont /${base} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${toUnicode} 0 R >>`);
  return type0;
}

/** Render one page of a design to a standalone SVG through the same engine
 *  as the editor, so layout, text and effects match it (see svgCanvas.ts). */
export async function exportVectorSvg(doc: DesignFile, pageIndex: number, opts: { assets?: unknown } = {}): Promise<string> {
  const { pages, renderOpts, faces, vectorSources } = await preparePages(doc, [pageIndex], opts.assets);
  const p = pages[0];
  const ctx = new SvgCanvas({ width: p.width, height: p.height, faces, vectorSources });
  renderScene(createScene(doc, p.index), ctx as unknown as CanvasLike, p.vp, renderOpts);
  return ctx.document(p.pg.width, p.pg.height, doc.title);
}

/** Render the given pages of a design to one vector PDF. */
export async function exportVectorPdf(doc: DesignFile, pageIndexes: number[], opts: VectorPdfOptions = {}): Promise<VectorPdfResult> {
  const { dpi, pages, resources, stats } = await drawPages(doc, pageIndexes, { assets: opts.assets, tagged: opts.tagged });
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
  // Text layer fonts: invisible (render mode 3), so only metrics and the
  // characters are needed, not the font programs.
  const fontRefs: string[] = [];
  for (const tf of resources.textFonts.values()) {
    if (tf.glyphs.size) fontRefs.push(`/${tf.name} ${await writeTextFont(w, tf)} 0 R`);
  }
  w.obj(resId, `<< /ExtGState << ${resources.extGStateDict()} >> /XObject << ${imageRefs.join(" ")} >> /Shading << ${resources.shadings.map((s) => `/${s.name} ${s.dict}`).join(" ")} >>${fontRefs.length ? ` /Font << ${fontRefs.join(" ")} >>` : ""} >>`);

  const kids: number[] = [];
  // Structure tree (tagged): Document > one Sect per page > one element per
  // tag; the parent tree maps each page's marked content back to them.
  const tagged = !!opts.tagged;
  const structRoot = tagged ? w.alloc() : 0;
  const docElem = tagged ? w.alloc() : 0;
  const sects: number[] = [];
  const nums: string[] = [];
  for (const [i, { content, p }] of contents.entries()) {
    const wPt = (p.pg.width * 72) / dpi;
    const hPt = (p.pg.height * 72) / dpi;
    const k = 72 / (dpi * p.zoom);
    const stream = `${num(k)} 0 0 ${num(-k)} 0 ${num(hPt)} cm\n${content}`;
    const cid = w.alloc();
    w.stream(cid, "/Filter /FlateDecode", await deflate(enc.encode(stream)));
    const pid = w.alloc();
    const box = `[0 0 ${num(wPt)} ${num(hPt)}]`;
    w.obj(pid, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox ${box} /TrimBox ${box} /Resources ${resId} 0 R /Contents ${cid} 0 R${tagged ? ` /StructParents ${i} /Tabs /S` : ""} >>`);
    kids.push(pid);
    if (tagged) {
      const sect = w.alloc();
      sects.push(sect);
      const byMcid: number[] = [];
      const leaves: number[] = [];
      for (const t of p.tags ?? []) {
        const id = w.alloc();
        w.obj(id, `<< /Type /StructElem /S /${t.role} /P ${sect} 0 R /Pg ${pid} 0 R /K ${t.mcid}${t.alt ? ` /Alt ${pdfString(t.alt)}` : ""} >>`);
        leaves.push(id);
        byMcid[t.mcid] = id;
      }
      const base = opts.title || doc.title;
      const title = p.pg.name?.trim() || (base ? `${base} ${p.index + 1}` : tr("editor.page_n", { n: p.index + 1 }));
      w.obj(sect, `<< /Type /StructElem /S /Sect /P ${docElem} 0 R /Pg ${pid} 0 R /T ${pdfString(title)} /K [${leaves.map((id) => `${id} 0 R`).join(" ")}] >>`);
      nums.push(`${i} [${Array.from(byMcid, (id) => `${id ?? 0} 0 R`).join(" ")}]`);
    }
  }
  w.obj(pagesId, `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] /Count ${kids.length} >>`);
  if (tagged) {
    const parentTree = w.alloc();
    w.obj(parentTree, `<< /Nums [${nums.join(" ")}] >>`);
    w.obj(structRoot, `<< /Type /StructTreeRoot /K [${docElem} 0 R] /ParentTree ${parentTree} 0 R /ParentTreeNextKey ${contents.length} >>`);
    w.obj(docElem, `<< /Type /StructElem /S /Document /P ${structRoot} 0 R /K [${sects.map((id) => `${id} 0 R`).join(" ")}] >>`);
    w.obj(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R /MarkInfo << /Marked true >> /StructTreeRoot ${structRoot} 0 R /Lang ${pdfString(docLang(doc, opts.lang))} /ViewerPreferences << /DisplayDocTitle true >> >>`);
  } else {
    w.obj(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  }
  const d = new Date();
  const pad = (v: number) => String(v).padStart(2, "0");
  const created = `D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  w.obj(infoId, `<< /Producer (danvas) /Creator (danvas ${opts.tagged ? "tagged" : "vector"} PDF) /Title ${pdfString(opts.title || doc.title || "Design")} /CreationDate (${created}) >>`); // i18n-ignore: file metadata

  const first = pages[0]?.pg;
  return {
    blob: w.finish(catalogId, infoId),
    widthMm: first ? (first.width / dpi) * 25.4 : 0,
    heightMm: first ? (first.height / dpi) * 25.4 : 0,
    stats,
  };
}
