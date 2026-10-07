import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { encodeTiff } from "./tiff";
import { ascii85 } from "./eps";
import { createCmykConverter } from "./cms";

const PROFILE = resolve(__dirname, "../../../public/icc/PSO_Uncoated_ISO12647_eci.icc");

/** Minimal TIFF reader for the tags these tests check. */
function readTiff(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  expect(String.fromCharCode(b[0], b[1])).toBe("II");
  expect(v.getUint16(2, true)).toBe(42);
  const ifd = v.getUint32(4, true);
  const n = v.getUint16(ifd, true);
  const tags = new Map<number, { type: number; count: number; value: number }>();
  for (let i = 0; i < n; i++) {
    const o = ifd + 2 + i * 12;
    const type = v.getUint16(o + 2, true);
    tags.set(v.getUint16(o, true), { type, count: v.getUint32(o + 4, true), value: type === 3 ? v.getUint16(o + 8, true) : v.getUint32(o + 8, true) });
  }
  return { tags, v };
}

describe("TIFF writer", () => {
  it("writes CMYK with resolution, deflate+predictor and the embedded profile", async () => {
    const w = 37, h = 300; // odd width, several strips
    const data = new Uint8Array(w * h * 4);
    for (let i = 0; i < data.length; i++) data[i] = (i * 7) & 255;
    const icc = new Uint8Array([1, 2, 3, 4, 5]);
    const blob = await encodeTiff({ width: w, height: h, data, mode: "cmyk", dpi: 300, icc });
    const b = new Uint8Array(await blob.arrayBuffer());
    const { tags, v } = readTiff(b);
    expect(tags.get(256)!.value).toBe(w);
    expect(tags.get(257)!.value).toBe(h);
    expect(tags.get(259)!.value).toBe(8); // Adobe Deflate
    expect(tags.get(262)!.value).toBe(5); // separated (CMYK)
    expect(tags.get(277)!.value).toBe(4);
    expect(tags.get(317)!.value).toBe(2); // predictor
    const xres = tags.get(282)!.value;
    expect(v.getUint32(xres, true) / v.getUint32(xres + 4, true)).toBe(300);
    const iccTag = tags.get(34675)!;
    expect([...b.slice(iccTag.value, iccTag.value + iccTag.count)]).toEqual([...icc]);

    // Decode every strip back and undo the predictor: the pixels round-trip.
    const offsets = tags.get(273)!, counts = tags.get(279)!, rps = tags.get(278)!.value;
    const strips = offsets.count;
    const out: number[] = [];
    for (let s = 0; s < strips; s++) {
      const off = strips === 1 ? offsets.value : v.getUint32(offsets.value + s * 4, true);
      const len = strips === 1 ? counts.value : v.getUint32(counts.value + s * 4, true);
      const raw = new Uint8Array(await new Response(new Blob([b.slice(off, off + len)]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
      const rows = Math.min(rps, h - s * rps);
      for (let r = 0; r < rows; r++) {
        const row = raw.slice(r * w * 4, (r + 1) * w * 4);
        for (let i = 4; i < row.length; i++) row[i] = (row[i] + row[i - 4]) & 255;
        out.push(...row);
      }
    }
    expect(out.length).toBe(data.length);
    expect(out.every((x, i) => x === data[i])).toBe(true);
  });
});

describe("ASCII85", () => {
  it("encodes like the reference and ends with ~>", () => {
    // "Man " -> "9jqo^" (the classic Adobe example), zeros -> "z".
    expect(ascii85(new TextEncoder().encode("Man "))).toBe("9jqo^~>");
    expect(ascii85(new Uint8Array([0, 0, 0, 0]))).toBe("z~>");
    expect(ascii85(new Uint8Array([255]))).toBe("rr~>"); // matches Python base64.a85encode
  });
});

describe("CMYK conversion", () => {
  it("converts through an ICC output profile", async () => {
    const conv = await createCmykConverter(new Uint8Array(readFileSync(PROFILE)));
    try {
      expect(conv.description).toMatch(/PSO Uncoated/);
      expect(conv.cmyk(1, 1, 1)).toEqual([0, 0, 0, 0]); // paper white: no ink
      const black = conv.cmyk(0, 0, 0);
      expect(black[3]).toBeGreaterThan(0.85); // a rich black, heavy in K
      // Pixels composite on paper white: fully transparent prints nothing.
      const px = conv.pixels(new Uint8Array([0, 0, 0, 0, 255, 0, 0, 255]), 2);
      expect([...px.slice(0, 4)]).toEqual([0, 0, 0, 0]);
      expect(px[5]).toBeGreaterThan(200); // red: mostly magenta
    } finally {
      conv.dispose();
    }
  });

  it("rejects files that are not CMYK profiles", async () => {
    await expect(createCmykConverter(new TextEncoder().encode("not a profile"))).rejects.toThrow();
  });
});
