import { describe, expect, it } from "vitest";
import { refineMatte } from "./matteRefine";

// A photo with a hard edge at x = 32 (dark left, bright right) and a matte
// that the model delivered soft: a ramp from x = 22 to x = 42.
function scene(w = 64, h = 32) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  const alpha = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = x >= 32 ? 230 : 20;
      rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255;
      alpha[i] = Math.round(Math.min(1, Math.max(0, (x - 22) / 20)) * 255);
    }
  }
  return { rgba, alpha, w, h };
}

describe("refineMatte", () => {
  it("pulls a soft matte edge onto the photo's own edge", () => {
    const { rgba, alpha, w, h } = scene();
    const out = refineMatte(rgba, alpha, w, h);
    const at = (x: number) => out[16 * w + x];
    const before = (x: number) => alpha[16 * w + x];
    // Left of the photo's edge the matte drops, right of it it rises.
    expect(at(29)).toBeLessThan(before(29));
    expect(at(35)).toBeGreaterThan(before(35));
    // The transition is steeper than before.
    expect(at(34) - at(30)).toBeGreaterThan(before(34) - before(30));
  });

  it("keeps clear background and clear foreground as they are", () => {
    const { rgba, alpha, w, h } = scene();
    const out = refineMatte(rgba, alpha, w, h);
    expect(out[16 * w + 2]).toBeLessThan(8);
    expect(out[16 * w + 61]).toBeGreaterThan(247);
  });

  it("works on a reduced grid for a large picture and returns full size", () => {
    const w = 2100, h = 40;
    const rgba = new Uint8ClampedArray(w * h * 4).fill(128);
    const alpha = new Uint8ClampedArray(w * h).fill(255);
    const out = refineMatte(rgba, alpha, w, h);
    expect(out.length).toBe(w * h);
    expect(out[20 * w + 1000]).toBe(255);
  });
});
