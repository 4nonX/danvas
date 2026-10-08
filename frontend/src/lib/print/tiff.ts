// Baseline TIFF writer for print: 8-bit RGB or CMYK (separated), Adobe
// Deflate compression with horizontal differencing (predictor 2), the
// physical resolution, and the ICC profile embedded so the print shop's RIP
// knows exactly which printing condition the CMYK values were made for.

export interface TiffInput {
  width: number;
  height: number;
  /** Interleaved samples: RGB (3) or CMYK (4) bytes per pixel. */
  data: Uint8Array;
  mode: "rgb" | "cmyk";
  dpi: number;
  /** ICC profile of the data: the output profile for CMYK. RGB is written
   *  without one, which readers and RIPs take as sRGB (what designs are in). */
  icc?: Uint8Array;
  software?: string;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Horizontal differencing per row and sample (TIFF predictor 2), in place. */
function predict(rows: Uint8Array, width: number, spp: number): void {
  const stride = width * spp;
  for (let r = 0; r * stride < rows.length; r++) {
    const base = r * stride;
    for (let i = stride - 1; i >= spp; i--) rows[base + i] = (rows[base + i] - rows[base + i - spp]) & 255;
  }
}

export async function encodeTiff(input: TiffInput): Promise<Blob> {
  const { width, height, mode, dpi } = input;
  const spp = mode === "cmyk" ? 4 : 3;
  if (input.data.length !== width * height * spp) throw new Error("TIFF: sample count does not match the size");
  const rowBytes = width * spp;
  const rowsPerStrip = Math.max(1, Math.floor((256 * 1024) / rowBytes));
  const strips: Uint8Array[] = [];
  for (let y = 0; y < height; y += rowsPerStrip) {
    const rows = input.data.slice(y * rowBytes, Math.min(height, y + rowsPerStrip) * rowBytes);
    predict(rows, width, spp);
    strips.push(await deflate(rows));
  }

  // Layout: header | strips | out-of-line tag values | IFD.
  const parts: Uint8Array[] = [];
  let offset = 8;
  const put = (b: Uint8Array): number => {
    const at = offset;
    parts.push(b);
    offset += b.length;
    if (offset % 2) { parts.push(new Uint8Array(1)); offset++; } // word alignment
    return at;
  };
  const stripOffsets = strips.map((s) => put(s));
  const u16 = (vals: number[]) => { const b = new Uint8Array(vals.length * 2); const v = new DataView(b.buffer); vals.forEach((x, i) => v.setUint16(i * 2, x, true)); return b; };
  const u32 = (vals: number[]) => { const b = new Uint8Array(vals.length * 4); const v = new DataView(b.buffer); vals.forEach((x, i) => v.setUint32(i * 4, x, true)); return b; };
  const ascii = (s: string) => new TextEncoder().encode(s + "\0");
  const res = Math.round(dpi * 100);

  type Entry = { tag: number; type: number; count: number; value?: number; at?: number };
  const SHORT = 3, LONG = 4, RATIONAL = 5, ASCII = 2, UNDEFINED = 7;
  const entries: Entry[] = [
    { tag: 256, type: LONG, count: 1, value: width },
    { tag: 257, type: LONG, count: 1, value: height },
    { tag: 258, type: SHORT, count: spp, at: put(u16(new Array(spp).fill(8))) },
    { tag: 259, type: SHORT, count: 1, value: 8 }, // Adobe Deflate
    { tag: 262, type: SHORT, count: 1, value: mode === "cmyk" ? 5 : 2 },
    strips.length === 1
      ? { tag: 273, type: LONG, count: 1, value: stripOffsets[0] }
      : { tag: 273, type: LONG, count: strips.length, at: put(u32(stripOffsets)) },
    { tag: 277, type: SHORT, count: 1, value: spp },
    { tag: 278, type: LONG, count: 1, value: rowsPerStrip },
    strips.length === 1
      ? { tag: 279, type: LONG, count: 1, value: strips[0].length }
      : { tag: 279, type: LONG, count: strips.length, at: put(u32(strips.map((s) => s.length))) },
    { tag: 282, type: RATIONAL, count: 1, at: put(u32([res, 100])) },
    { tag: 283, type: RATIONAL, count: 1, at: put(u32([res, 100])) },
    { tag: 284, type: SHORT, count: 1, value: 1 },
    { tag: 296, type: SHORT, count: 1, value: 2 }, // inches
  ];
  const sw = ascii(input.software ?? "danvas"); // i18n-ignore: file metadata
  entries.push({ tag: 305, type: ASCII, count: sw.length, at: put(sw) });
  entries.push({ tag: 317, type: SHORT, count: 1, value: 2 }); // horizontal predictor
  if (mode === "cmyk") entries.push({ tag: 332, type: SHORT, count: 1, value: 1 }); // InkSet: CMYK
  if (input.icc) entries.push({ tag: 34675, type: UNDEFINED, count: input.icc.length, at: put(input.icc) });

  const ifdAt = offset;
  const ifd = new Uint8Array(2 + entries.length * 12 + 4);
  const v = new DataView(ifd.buffer);
  v.setUint16(0, entries.length, true);
  entries.forEach((e, i) => {
    const o = 2 + i * 12;
    v.setUint16(o, e.tag, true);
    v.setUint16(o + 2, e.type, true);
    v.setUint32(o + 4, e.count, true);
    if (e.at !== undefined) v.setUint32(o + 8, e.at, true);
    else if (e.type === SHORT) v.setUint16(o + 8, e.value!, true);
    else v.setUint32(o + 8, e.value!, true);
  });
  v.setUint32(2 + entries.length * 12, 0, true); // no next IFD
  parts.push(ifd);

  const header = new Uint8Array(8);
  const hv = new DataView(header.buffer);
  header[0] = 0x49; header[1] = 0x49; // "II": little endian
  hv.setUint16(2, 42, true);
  hv.setUint32(4, ifdAt, true);
  return new Blob([header, ...parts] as BlobPart[], { type: "image/tiff" });
}
