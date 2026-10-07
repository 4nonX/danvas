// EPS export (PostScript Level 3). Pages are drawn by the same PDF canvas as
// the vector PDF, in flatten mode: PostScript has no transparency, so
// anything translucent becomes an opaque patch with its background baked in,
// while everything opaque stays vector. The prolog defines the PDF operator
// names the canvas emits (m, l, c, f, W, cm, ...) as their PostScript
// equivalents, so the drawing operators pass through unchanged; gradients
// become Level 3 shadings, images compressed reusable streams.

import type { DesignFile } from "@hc/schema";
import { drawPages, num } from "@/lib/vectorPdf";
import type { CmykConverter } from "./cms";

export interface EpsOptions {
  assets?: unknown;
  title?: string;
  /** CMYK through this profile; RGB when absent. */
  converter?: CmykConverter | null;
  /** Pure black in black ink only (CMYK). */
  blackOnly?: boolean;
}

const enc = new TextEncoder();

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** ASCII85 with line breaks every 76 characters, terminated by "~>". */
export function ascii85(data: Uint8Array): string {
  const out: string[] = [];
  let line = "";
  const emit = (s: string) => {
    line += s;
    while (line.length >= 76) { out.push(line.slice(0, 76)); line = line.slice(76); }
  };
  for (let i = 0; i < data.length; i += 4) {
    const n = Math.min(4, data.length - i);
    let v = 0;
    for (let k = 0; k < 4; k++) v = v * 256 + (k < n ? data[i + k] : 0);
    if (n === 4 && v === 0) { emit("z"); continue; }
    const chars = new Array(5);
    for (let k = 4; k >= 0; k--) { chars[k] = String.fromCharCode(33 + (v % 85)); v = Math.floor(v / 85); }
    emit(chars.slice(0, n + 1).join(""));
  }
  out.push(line + "~>");
  return out.join("\n");
}

/** PostScript string literal (PDF-style hex for anything non-ASCII). */
function psText(s: string): string {
  return /^[\x20-\x7e]*$/.test(s) && !/[()\\]/.test(s) ? `(${s})` : `(${s.replace(/[^\x20-\x7e]|[()\\]/g, "?")})`;
}

// PDF content operators as PostScript procedures.
const PROLOG = `/HyCanvasDict 64 dict def
HyCanvasDict begin
/q {gsave} bind def /Q {grestore} bind def
/cm {6 array astore concat} bind def
/m {moveto} bind def /l {lineto} bind def /c {curveto} bind def /h {closepath} bind def
/f {fill} bind def /f* {eofill} bind def /S {stroke} bind def
/W {clip} bind def /W* {eoclip} bind def /n {newpath} bind def
/rg {setrgbcolor} bind def /RG {setrgbcolor} bind def
/k {setcmykcolor} bind def /K {setcmykcolor} bind def
/w {setlinewidth} bind def /J {setlinecap} bind def /j {setlinejoin} bind def
/M {setmiterlimit} bind def /d {setdash} bind def
/gs {pop} bind def
/sh {ShD exch get shfill} bind def
/Do {ImD exch get exec} bind def
end`;

/** One page as an EPS file. */
export async function exportEps(doc: DesignFile, pageIndex: number, opts: EpsOptions = {}): Promise<Blob> {
  const conv = opts.converter ?? null;
  const { dpi, pages, resources } = await drawPages(doc, [pageIndex], {
    assets: opts.assets,
    flatten: true,
    color: conv ? { cmyk: (r, g, b) => conv.cmyk(r, g, b), blackOnly: opts.blackOnly ?? true } : undefined,
  });
  const p = pages[0];
  const wPt = (p.pg.width * 72) / dpi;
  const hPt = (p.pg.height * 72) / dpi;
  const k = 72 / (dpi * p.zoom);

  // Images used by the page: reusable compressed streams, drawn by name.
  const used = new Set([...p.content.matchAll(/\/(Im\d+) Do/g)].map((m) => m[1]));
  const imageDefs: string[] = [];
  const imageProcs: string[] = [];
  for (const img of resources.images) {
    if (!used.has(img.name)) continue;
    const n = img.width * img.height;
    let samples: Uint8Array;
    if (conv) samples = conv.pixels(img.rgba, n);
    else {
      // Flattened output is opaque; any remaining alpha composites on white.
      samples = new Uint8Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = img.rgba[i * 4 + 3] / 255;
        samples[i * 3] = img.rgba[i * 4] * a + 255 * (1 - a);
        samples[i * 3 + 1] = img.rgba[i * 4 + 1] * a + 255 * (1 - a);
        samples[i * 3 + 2] = img.rgba[i * 4 + 2] * a + 255 * (1 - a);
      }
    }
    const data = ascii85(await deflate(samples));
    imageDefs.push(`/${img.name}Src currentfile /ASCII85Decode filter /ReusableStreamDecode filter\n${data}\ndef`);
    const space = conv ? "/DeviceCMYK" : "/DeviceRGB";
    const decode = conv ? "[0 1 0 1 0 1 0 1]" : "[0 1 0 1 0 1]";
    imageProcs.push(`/${img.name} {${img.name}Src 0 setfileposition ${space} setcolorspace << /ImageType 1 /Width ${img.width} /Height ${img.height} /BitsPerComponent 8 /Decode ${decode} /Interpolate true /ImageMatrix [${img.width} 0 0 ${-img.height} 0 ${img.height}] /DataSource ${img.name}Src /FlateDecode filter >> image}`);
  }
  const usedSh = new Set([...p.content.matchAll(/\/(Sh\d+) sh/g)].map((m) => m[1]));
  const shadings = resources.shadings.filter((s) => usedSh.has(s.name)).map((s) => `/${s.name} ${s.dict}`);

  const d = new Date();
  const lines = [
    "%!PS-Adobe-3.0 EPSF-3.0",
    `%%BoundingBox: 0 0 ${Math.ceil(wPt)} ${Math.ceil(hPt)}`,
    `%%HiResBoundingBox: 0 0 ${num(wPt)} ${num(hPt)}`,
    `%%Title: ${psText(opts.title ?? doc.title ?? "Design")}`,
    "%%Creator: HyCanvas",
    `%%CreationDate: ${d.toISOString()}`,
    "%%LanguageLevel: 3",
    "%%DocumentData: Clean7Bit",
    ...(conv ? ["%%DocumentProcessColors: Cyan Magenta Yellow Black"] : []),
    "%%Pages: 1",
    "%%EndComments",
    "%%BeginProlog",
    PROLOG,
    "%%EndProlog",
    "%%Page: 1 1",
    "save",
    "HyCanvasDict begin",
    `/ShD << ${shadings.join("\n")} >> def`,
    ...imageDefs,
    `/ImD << ${imageProcs.join("\n")} >> def`,
    "0 0 0 setrgbcolor 1 setlinewidth [] 0 setdash",
    `${num(k)} 0 0 ${num(-k)} 0 ${num(hPt)} cm`,
    p.content,
    "end",
    "restore",
    "showpage",
    "%%Trailer",
    "%%EOF",
    "",
  ];
  return new Blob([enc.encode(lines.join("\n"))], { type: "application/postscript" });
}
