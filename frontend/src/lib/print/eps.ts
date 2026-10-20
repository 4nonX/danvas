// EPS export (PostScript Level 3). Pages are drawn by the same PDF canvas as
// the vector PDF, in flatten mode: PostScript has no transparency, so
// anything translucent becomes an opaque patch with its background baked in,
// while everything opaque stays vector. The prolog defines the PDF operator
// names the canvas emits (m, l, c, f, W, cm, ...) as their PostScript
// equivalents, so the drawing operators pass through unchanged; gradients
// become Level 3 shadings, images compressed reusable streams.

import type { PrintExtras, PrintParts } from "./sheet";
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
  /** Include the page's bleed and/or crop marks. */
  print?: boolean | PrintParts;
  /** Black-only paint overprints (CMYK). */
  overprintBlack?: boolean;
  /** Registration-colour marks and a die line. */
  extras?: PrintExtras;
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

/** PostScript string literal (also the DSC comments' text syntax): the
 *  UTF-8 bytes, parentheses and backslash escaped, anything outside printable
 *  ASCII as an octal escape. A spot colour's separation name so carries the
 *  same bytes as in the PDF ("Prägung" stays "Prägung", not "Pr?gung"). */
export function psText(s: string): string {
  let out = "";
  for (const b of new TextEncoder().encode(s)) {
    const c = String.fromCharCode(b);
    out += c === "(" || c === ")" || c === "\\" ? `\\${c}` : b >= 0x20 && b < 0x7f ? c : `\\${b.toString(8).padStart(3, "0")}`;
  }
  return `(${out})`;
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
/gs {GSD exch get exec} bind def
/cs {CSD exch get setcolorspace} bind def /CS {CSD exch get setcolorspace} bind def
/scn {setcolor} bind def /SCN {setcolor} bind def
/BDC {pop pop} bind def /EMC {} bind def
/sh {ShD exch get shfill} bind def
/Do {ImD exch get exec} bind def
end`;

/** One page as an EPS file. */
export async function exportEps(doc: DesignFile, pageIndex: number, opts: EpsOptions = {}): Promise<Blob> {
  const conv = opts.converter ?? null;
  const { dpi, pages, resources } = await drawPages(doc, [pageIndex], {
    assets: opts.assets,
    flatten: true,
    print: opts.print,
    color: conv ? { cmyk: (r, g, b) => conv.cmyk(r, g, b), blackOnly: opts.blackOnly ?? true, overprintBlack: !!opts.overprintBlack, overprintAsSeparation: true } : undefined,
    extras: opts.extras,
  });
  const p = pages[0];
  // The whole sheet: bleed and crop marks when the page has them and the
  // export asks for them.
  const wPt = (p.sheet.sheetWidth * 72) / dpi;
  const hPt = (p.sheet.sheetHeight * 72) / dpi;
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
  // Graphics states: only overprint matters here (transparency is
  // flattened). Spot colours: separations that fall back to their CMYK look.
  const gsProcs = [...resources.extGStates].map(([key, name]) => `/${name} {${key.split("|")[3] === "1" ? "true" : "false"} setoverprint}`);
  const spots = [...resources.spots.values()];
  const csDefs = spots.map(({ name, spot }) => {
    const [c, m, y, k] = spot.cmyk.map(num);
    return `/${name} [/Separation ${psText(spot.name)} cvn /DeviceCMYK {dup ${c} mul exch dup ${m} mul exch dup ${y} mul exch ${k} mul}]`;
  });
  // Separations that are not process plates or "All" are custom colours.
  const custom = spots.filter((e) => !["All", "Cyan", "Magenta", "Yellow", "Black"].includes(e.spot.name)); // i18n-ignore: separation names

  const d = new Date();
  const lines = [
    "%!PS-Adobe-3.0 EPSF-3.0",
    `%%BoundingBox: 0 0 ${Math.ceil(wPt)} ${Math.ceil(hPt)}`,
    `%%HiResBoundingBox: 0 0 ${num(wPt)} ${num(hPt)}`,
    `%%Title: ${psText(opts.title || doc.title || "Design")}`, // i18n-ignore: file metadata
    "%%Creator: danvas",
    `%%CreationDate: ${d.toISOString()}`,
    "%%LanguageLevel: 3",
    "%%DocumentData: Clean7Bit",
    ...(conv ? ["%%DocumentProcessColors: Cyan Magenta Yellow Black"] : []),
    ...(custom.length ? [`%%DocumentCustomColors: ${custom.map((e) => psText(e.spot.name)).join(" ")}`, ...custom.map((e) => `%%CMYKCustomColor: ${e.spot.cmyk.map(num).join(" ")} ${psText(e.spot.name)}`)] : []),
    "%%Pages: 1",
    "%%EndComments",
    "%%BeginProlog",
    PROLOG,
    "%%EndProlog",
    "%%Page: 1 1",
    "save",
    "HyCanvasDict begin", // i18n-ignore: PostScript
    `/ShD << ${shadings.join("\n")} >> def`,
    `/GSD << ${gsProcs.join("\n")} >> def`,
    `/CSD << ${csDefs.join("\n")} >> def`,
    ...imageDefs,
    `/ImD << ${imageProcs.join("\n")} >> def`,
    `${conv ? "0 0 0 1 setcmykcolor" : "0 0 0 setrgbcolor"} 1 setlinewidth [] 0 setdash`,
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
