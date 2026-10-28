import { describe, expect, it } from "vitest";
import { enhanceWith, fillTransparentColor, hasAnyAlpha, hasTransparency, type TileRunner } from "./enhance";

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

  // An almost opaque image takes the opaque path (below the 1 % that makes
  // the model enhance the shape); its few transparent pixels must stay so.
  describe("sparse transparency", () => {
    const w = 120, h = 100, F = 4;
    const opaque = () => pattern(w, h, false);
    const alphaAt = (d: Uint8ClampedArray, x: number, y: number) => d[((y * F + 1) * w * F + x * F + 1) * 4 + 3];

    it("keeps a single transparent pixel transparent", async () => {
      const src = opaque();
      const o = (40 * w + 50) * 4;
      src[o] = 0; src[o + 1] = 0; src[o + 2] = 0; src[o + 3] = 0;
      expect(hasTransparency(src, w, h)).toBe(false);
      expect(hasAnyAlpha(src, w, h)).toBe(true);
      const out = await enhanceWith(nearest4, src, w, h);
      expect(alphaAt(out.data, 50, 40)).toBeLessThan(64);
      expect(alphaAt(out.data, 10, 10)).toBe(255);
      // The colour there comes from its neighbours, not the black stored in it.
      const c = ((40 * F + 1) * w * F + 50 * F + 1) * 4;
      expect(out.data[c] + out.data[c + 1] + out.data[c + 2]).toBeGreaterThan(0);
    });

    it("keeps a logo's free corners transparent", async () => {
      const src = opaque();
      for (const [x, y] of [[0, 0], [1, 0], [0, 1], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) src[(y * w + x) * 4 + 3] = 0;
      const out = await enhanceWith(nearest4, src, w, h);
      expect(alphaAt(out.data, 0, 0)).toBeLessThan(64);
      expect(alphaAt(out.data, w - 1, h - 1)).toBeLessThan(64);
      expect(alphaAt(out.data, w / 2, h / 2)).toBe(255);
    });

    it("keeps partly transparent edge pixels partly transparent", async () => {
      const src = opaque();
      for (let x = 30; x < 34; x++) src[(20 * w + x) * 4 + 3] = 128;
      const out = await enhanceWith(nearest4, src, w, h);
      const a = alphaAt(out.data, 31, 20);
      expect(a).toBeGreaterThan(90);
      expect(a).toBeLessThan(170);
    });

    it("leaves a fully opaque image fully opaque", async () => {
      const src = opaque();
      expect(hasAnyAlpha(src, w, h)).toBe(false);
      const out = await enhanceWith(nearest4, src, w, h);
      for (let i = 3; i < out.data.length; i += 4) if (out.data[i] !== 255) throw new Error("alpha below 255 at " + i);
    });
  });

  // Keeping the alpha is half of a clean edge: the colour under a partly
  // transparent edge pixel must be the artwork's, or the edge shows a dark
  // (or light) fringe once the logo sits on a background. The transparent
  // pixels here store black, as many files do.
  describe("edges without a fringe", () => {
    const red: [number, number, number] = [220, 30, 40];
    function logo(w: number, h: number, inside: (x: number, y: number) => number) {
      const d = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4, a = inside(x, y);
        if (a > 0) { d[o] = red[0]; d[o + 1] = red[1]; d[o + 2] = red[2]; }
        d[o + 3] = a;
      }
      return d;
    }
    /** Every partly transparent output pixel, composited on white and on
     *  black, against the artwork colour composited the same way. */
    function worstFringe(out: Uint8ClampedArray) {
      let worst = 0, edge = 0;
      for (let i = 0; i < out.length; i += 4) {
        const a = out[i + 3] / 255;
        if (a <= 0.05 || a >= 0.95) continue;
        edge++;
        for (const bg of [0, 255]) for (let c = 0; c < 3; c++) {
          const got = out[i + c] * a + bg * (1 - a), want = red[c] * a + bg * (1 - a);
          worst = Math.max(worst, Math.abs(got - want));
        }
      }
      return { worst, edge };
    }

    it("on an almost opaque logo with soft transparent corners", async () => {
      const w = 120, h = 100;
      const src = logo(w, h, (x, y) => {
        const d = Math.min(x + y, (w - 1 - x) + y, x + (h - 1 - y), (w - 1 - x) + (h - 1 - y));
        return d >= 3 ? 255 : d * 80;
      });
      expect(hasTransparency(src, w, h)).toBe(false);
      const { worst, edge } = worstFringe((await enhanceWith(nearest4, src, w, h)).data);
      expect(edge).toBeGreaterThan(0);
      expect(worst).toBeLessThan(8);
    });

    it("on a logo cut out of a transparent ground", async () => {
      const w = 96, h = 96;
      const src = logo(w, h, (x, y) => {
        const r = Math.hypot(x - 48, y - 48);
        return r < 30 ? 255 : r < 33 ? Math.round((33 - r) * 85) : 0;
      });
      expect(hasTransparency(src, w, h)).toBe(true);
      const { worst, edge } = worstFringe((await enhanceWith(nearest4, src, w, h)).data);
      expect(edge).toBeGreaterThan(0);
      expect(worst).toBeLessThan(8);
    });
  });
});
