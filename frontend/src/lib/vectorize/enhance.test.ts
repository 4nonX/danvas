import { describe, expect, it } from "vitest";
import { enhanceWith, fillTransparentColor, hasTransparency, type TileRunner } from "./enhance";

// Stand-in for the model: 4x nearest-neighbour, so every output pixel is
// predictable and tile seams or offsets show up as mismatches.
const nearest4: TileRunner = async (input, size) => {
  const S = size * 4;
  const out = new Float32Array(3 * S * S);
  for (let c = 0; c < 3; c++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    out[c * S * S + y * S + x] = input[c * size * size + (y >> 2) * size + (x >> 2)];
  }
  return out;
};

function pattern(w: number, h: number, transparent: boolean) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    d[o] = (x * 7) & 255; d[o + 1] = (y * 5) & 255; d[o + 2] = (x * y) & 255;
    d[o + 3] = transparent ? ((x + y) % 3 === 0 ? 0 : 255) : 255;
  }
  return d;
}

describe("enhance", () => {
  it("tiles an opaque image without seams or offsets", async () => {
    // Not a multiple of the tile size, spanning several tiles.
    const w = 230, h = 197;
    const src = pattern(w, h, false);
    const out = await enhanceWith(nearest4, src, w, h);
    expect(out.width).toBe(w * 4);
    expect(out.height).toBe(h * 4);
    let bad = 0;
    for (let Y = 0; Y < out.height; Y++) for (let X = 0; X < out.width; X++) {
      const o = (Y * out.width + X) * 4, s = ((Y >> 2) * w + (X >> 2)) * 4;
      for (let c = 0; c < 3; c++) if (Math.abs(out.data[o + c] - src[s + c]) > 1) bad++;
      if (out.data[o + 3] !== 255) bad++;
    }
    expect(bad).toBe(0);
  });

  it("takes the shape from the model's alpha and the colour from the image", async () => {
    const w = 120, h = 110;
    const src = pattern(w, h, true);
    expect(hasTransparency(src, w, h)).toBe(true);
    const out = await enhanceWith(nearest4, src, w, h);
    let bad = 0;
    for (let Y = 0; Y < out.height; Y++) for (let X = 0; X < out.width; X++) {
      if (out.data[(Y * out.width + X) * 4 + 3] !== src[((Y >> 2) * w + (X >> 2)) * 4 + 3]) bad++;
    }
    expect(bad).toBe(0);
  });

  it("fills transparent pixels with the nearest opaque colour", () => {
    const w = 5, h = 1;
    const src = new Uint8ClampedArray(w * 4);
    src.set([200, 10, 20, 255], 0); // opaque red-ish at x=0
    src.set([0, 0, 0, 0], 4);
    src.set([0, 0, 0, 0], 8);
    src.set([0, 0, 0, 0], 12);
    src.set([10, 220, 30, 255], 16); // opaque green-ish at x=4
    const f = fillTransparentColor(src, w, h);
    expect([...f.subarray(4, 8)]).toEqual([200, 10, 20, 255]);
    expect([...f.subarray(12, 16)]).toEqual([10, 220, 30, 255]);
    expect(f[19]).toBe(255);
  });
});
