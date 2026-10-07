import { describe, expect, it } from "vitest";
import { svgImageNodes } from "./svgImage";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><rect x="0" y="0" width="50" height="50" fill="#20603d"/></svg>';
const img = (fit: "contain" | "cover" | "stretch" | "none", crop?: { x: number; y: number; width: number; height: number }) =>
  ({ source: { assetId: "a" }, size: { width: 200, height: 100 }, fit, crop });
const art = (r: ReturnType<typeof svgImageNodes>) => r!.children[0] as unknown as { transform: { x: number; y: number; scaleX: number; scaleY: number }; size: { width: number; height: number } };

describe("svgImageNodes", () => {
  it("places the artwork where a contained image draws it, unclipped", () => {
    const r = svgImageNodes(img("contain"), SVG);
    expect(r!.clip).toBe(false);
    expect(art(r).size).toEqual({ width: 50, height: 50 });
    expect(art(r).transform).toMatchObject({ x: 50, y: 0, scaleX: 2, scaleY: 2 });
  });

  it("stretches like a stretched image", () => {
    const t = art(svgImageNodes(img("stretch"), SVG)).transform;
    expect(t).toMatchObject({ x: 0, y: 0, scaleX: 4, scaleY: 2 });
  });

  it("clips when cover or a crop hides part of the artwork", () => {
    const cover = svgImageNodes(img("cover"), SVG);
    expect(cover!.clip).toBe(true);
    expect(art(cover).transform).toMatchObject({ x: 0, y: -50, scaleX: 4, scaleY: 4 });
    const cropped = svgImageNodes(img("stretch", { x: 0.5, y: 0, width: 0.5, height: 1 }), SVG);
    expect(cropped!.clip).toBe(true);
    // The right half fills the box: source x 25..50 maps to 0..200.
    expect(art(cropped).transform).toMatchObject({ x: -200, y: 0, scaleX: 8, scaleY: 2 });
  });

  it("keeps the shapes' own colors", () => {
    const g = svgImageNodes(img("contain"), SVG)!.children[0] as unknown as { children: { fills?: { color: { srgb: { r: number } } }[] }[] };
    expect(g.children.length).toBeGreaterThan(0);
    expect(g.children[0].fills?.[0].color.srgb.r).toBeCloseTo(0x20 / 255, 2);
  });
});
