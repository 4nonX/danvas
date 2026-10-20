// The resolution a PNG or JPEG states in its header. Browsers encode canvases
// without one (or at 72/96 dpi), so print software opens a 300 dpi export as
// a huge picture. These patch the encoded bytes: PNG gets a pHYs chunk, JPEG
// a JFIF header with the density in dots per inch.

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

/** The PNG with its resolution set to `dpi` (an existing pHYs is replaced).
 *  Anything that is not a PNG comes back unchanged. */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  if (png.length < 33 || PNG_SIG.some((b, i) => png[i] !== b)) return png;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const ppm = Math.max(1, Math.round(dpi / 0.0254));
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  const cv = new DataView(chunk.buffer);
  cv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  cv.setUint32(8, ppm);
  cv.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  cv.setUint32(17, crc32(chunk.subarray(4, 17)));
  // Copy the chunks, dropping any pHYs, and put the new one after IHDR.
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  let p = 8;
  while (p + 12 <= png.length) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7]);
    const end = p + 12 + len;
    if (end > png.length) return png;
    if (type !== "pHYs") parts.push(png.subarray(p, end));
    if (type === "IHDR") parts.push(chunk);
    p = end;
  }
  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}

/** The JPEG with its JFIF density set to `dpi` (a JFIF header is added when
 *  there is none). Anything that is not a JPEG comes back unchanged. */
export function setJpegDpi(jpg: Uint8Array, dpi: number): Uint8Array {
  if (jpg.length < 4 || jpg[0] !== 0xff || jpg[1] !== 0xd8) return jpg;
  const d = Math.max(1, Math.min(65535, Math.round(dpi)));
  const isJfif = jpg[2] === 0xff && jpg[3] === 0xe0 && String.fromCharCode(...jpg.subarray(6, 11)) === "JFIF\0";
  if (isJfif && jpg.length > 17) {
    const out = jpg.slice();
    out[13] = 1; // units: dots per inch
    out[14] = d >> 8; out[15] = d & 0xff;
    out[16] = d >> 8; out[17] = d & 0xff;
    return out;
  }
  const app0 = new Uint8Array([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, d >> 8, d & 0xff, d >> 8, d & 0xff, 0, 0]);
  const out = new Uint8Array(jpg.length + app0.length);
  out.set(jpg.subarray(0, 2), 0);
  out.set(app0, 2);
  out.set(jpg.subarray(2), 2 + app0.length);
  return out;
}

/** The resolution stated in a PNG (pHYs, metres) or JPEG (JFIF, inches), or
 *  null. For tests and checks. */
export function readDpi(bytes: Uint8Array): number | null {
  if (bytes[0] === 137 && bytes[1] === 80) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let p = 8;
    while (p + 12 <= bytes.length) {
      const len = view.getUint32(p);
      if (String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]) === "pHYs" && bytes[p + 16] === 1) return Math.round(view.getUint32(p + 8) * 0.0254);
      p += 12 + len;
    }
    return null;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[3] === 0xe0 && bytes[13] === 1) return (bytes[14] << 8) | bytes[15];
  return null;
}
