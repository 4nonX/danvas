import { describe, expect, it } from "vitest";
import { applyToPoint, fromTransform } from "@hc/engine";
import type { Transform } from "@hc/schema";
import { edgeCrop, edgeCropStart, isEdgeHandle } from "./imageEdgeCrop";

const T = (x: number, y: number, s = 1, rotation = 0, scaleY = s): Transform => ({ x, y, scaleX: s, scaleY, rotation });

// A 1000x500 photo shown whole in a 200x100 frame: 5 source px per frame unit.
const img = (over: Record<string, unknown> = {}) => ({
  transform: T(100, 50),
  size: { width: 200, height: 100 },
  source: { assetId: "a", naturalWidth: 1000, naturalHeight: 500 },
  fit: "cover" as const,
  ...over,
});

/** Page position of a source point (normalized) as the image draws it. */
function pagePointOf(n: { transform: Transform; size: { width: number; height: number }; crop: { x: number; y: number; width: number; height: number } }, sx: number, sy: number) {
  const lx = ((sx - n.crop.x) / n.crop.width) * n.size.width;
  const ly = ((sy - n.crop.y) / n.crop.height) * n.size.height;
  return applyToPoint(fromTransform(n.transform), { x: lx, y: ly });
}

describe("image edge crop", () => {
  it("knows its handles", () => {
    expect(["n", "s", "e", "w"].every(isEdgeHandle)).toBe(true);
    expect(isEdgeHandle("ne")).toBe(false);
  });

  it("is not offered for fits that leave empty space, or before the size is known", () => {
    expect(edgeCropStart(img({ fit: "contain" }))).toBeNull();
    expect(edgeCropStart(img({ fit: "none" }))).toBeNull();
    expect(edgeCropStart(img({ source: { assetId: "a", naturalWidth: 0, naturalHeight: 0 } }))).toBeNull();
  });

  it("moves only the dragged edge; the picture keeps its size and place", () => {
    const start = edgeCropStart(img())!;
    const before = { transform: start.transform, size: start.size, crop: start.visible };
    // Left edge in by 50 units: the frame is 150 wide, its left moves right.
    const r = edgeCrop(start, "w", 150);
    expect(r.size).toEqual({ width: 150, height: 100 });
    expect(r.transform.x).toBeCloseTo(150, 6);
    expect(r.crop.x).toBeCloseTo(0.25, 6);
    expect(r.crop.width).toBeCloseTo(0.75, 6);
    // A source point still visible lands on the same page spot as before.
    const after = { transform: r.transform, size: r.size, crop: r.crop };
    const a = pagePointOf(before, 0.6, 0.4);
    const b = pagePointOf(after, 0.6, 0.4);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.y).toBeCloseTo(a.y, 6);
  });

  it("keeps the frame's other edges for top and bottom too", () => {
    const start = edgeCropStart(img())!;
    const r = edgeCrop(start, "s", 60);
    expect(r.size).toEqual({ width: 200, height: 60 });
    expect(r.transform).toEqual(start.transform);
    expect(r.crop).toMatchObject({ x: 0, y: 0, width: 1 });
    expect(r.crop.height).toBeCloseTo(0.6, 6);
    const n = edgeCrop(start, "n", 60);
    expect(n.transform.y).toBeCloseTo(90, 6);
    expect(n.crop.y).toBeCloseTo(0.4, 6);
  });

  it("stops at the edge of the image file", () => {
    const start = edgeCropStart(img({ crop: { x: 0.2, y: 0, width: 0.6, height: 1 }, size: { width: 120, height: 100 } }))!;
    // Out to the right: only 0.2 of the file is left there (40 units).
    expect(edgeCrop(start, "e", 500).size.width).toBeCloseTo(160, 6);
    // Out to the left: likewise up to the file's left edge.
    const w = edgeCrop(start, "w", 500);
    expect(w.size.width).toBeCloseTo(160, 6);
    expect(w.crop.x).toBeCloseTo(0, 6);
    expect(w.transform.x).toBeCloseTo(60, 6);
    // And never below the smallest side, nor flipped through.
    expect(edgeCrop(start, "e", -40).size.width).toBe(1);
  });

  it("works on a cover image whose file is wider than its frame", () => {
    // 1000x500 file in a 100x100 cover frame: the middle half shows.
    const start = edgeCropStart(img({ size: { width: 100, height: 100 } }))!;
    expect(start.visible.x).toBeCloseTo(0.25, 6);
    expect(start.visible.width).toBeCloseTo(0.5, 6);
    // Revealing to the right: up to the file's right edge (another 50 units).
    const r = edgeCrop(start, "e", 400);
    expect(r.size.width).toBeCloseTo(150, 6);
    expect(r.crop.x).toBeCloseTo(0.25, 6);
    expect(r.crop.width).toBeCloseTo(0.75, 6);
  });

  it("follows a rotated, scaled and mirrored frame", () => {
    const start = edgeCropStart(img({ transform: { ...T(300, 200, 2, 30), scaleX: -2 } }))!;
    const before = { transform: start.transform, size: start.size, crop: start.visible };
    const r = edgeCrop(start, "w", 120);
    const after = { transform: r.transform, size: r.size, crop: r.crop };
    for (const [sx, sy] of [[0.5, 0.5], [0.9, 0.1]]) {
      const a = pagePointOf(before, sx, sy);
      const b = pagePointOf(after, sx, sy);
      expect(b.x).toBeCloseTo(a.x, 6);
      expect(b.y).toBeCloseTo(a.y, 6);
    }
  });

  it("keeps a stretched picture's own scale per axis", () => {
    const start = edgeCropStart(img({ fit: "stretch", size: { width: 400, height: 100 } }))!;
    expect(start.kx).toBeCloseTo(0.4, 6);
    expect(start.ky).toBeCloseTo(0.2, 6);
    const r = edgeCrop(start, "e", 200);
    expect(r.crop.width).toBeCloseTo(0.5, 6);
  });
});
