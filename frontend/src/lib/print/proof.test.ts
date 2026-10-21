import { describe, expect, it } from "vitest";
import { applyBlackOnly, defaultTacLimit, gamutMask, inkAt, plateImage, tacStats } from "./proof";

// Three pixels: paper, a rich black (C60 M50 Y50 K100 = 260 %), a 400 % solid.
const cmyk = new Uint8Array([0, 0, 0, 0, 153, 128, 128, 255, 255, 255, 255, 255]);

describe("proof arithmetic", () => {
  it("reads a pixel's ink per plate and in total", () => {
    expect(inkAt(cmyk, 1)).toEqual({ c: 60, m: 50, y: 50, k: 100, total: 260 });
  });

  it("measures total coverage against the limit, over the inked area", () => {
    const s = tacStats(cmyk, 300);
    expect(s.maxPct).toBe(400);
    expect(Array.from(s.over)).toEqual([0, 0, 1]);
    expect(s.overPct).toBe(50); // one of the two inked pixels
    expect(tacStats(cmyk, 400).overPct).toBe(0);
  });

  it("draws a plate as grey ink on paper white", () => {
    const k = plateImage(cmyk, "k", false);
    expect(Array.from(k.slice(0, 4))).toEqual([255, 255, 255, 255]);
    expect(Array.from(k.slice(4, 8))).toEqual([0, 0, 0, 255]);
    const c = plateImage(cmyk, "c", false);
    expect(c[4]).toBe(102); // 60 % cyan
  });

  it("puts pure black on the black plate alone, as the vector files do", () => {
    const rgba = new Uint8Array([0, 0, 0, 255, 10, 10, 10, 255]);
    const ink = new Uint8Array([190, 180, 170, 240, 180, 170, 160, 230]);
    applyBlackOnly(rgba, ink);
    expect(Array.from(ink.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(ink.slice(4, 8))).toEqual([180, 170, 160, 230]); // not pure black: unchanged
  });

  it("flags colours the press cannot reach, not ones it can", () => {
    const design = new Uint8Array([0, 255, 0, 255, 120, 120, 120, 255]);
    const proof = new Uint8ClampedArray([80, 170, 90, 255, 121, 120, 119, 255]);
    expect(Array.from(gamutMask(design, proof))).toEqual([1, 0]);
  });

  it("picks a TAC limit by paper", () => {
    expect(defaultTacLimit("PSO Uncoated ISO12647 (FOGRA47)")).toBe(300);
    expect(defaultTacLimit("PSO Coated v3")).toBe(330);
    expect(defaultTacLimit(undefined)).toBe(300);
  });
});
