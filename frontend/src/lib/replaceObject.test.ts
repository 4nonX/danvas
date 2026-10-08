import { describe, expect, it } from "vitest";
import type { Transform } from "@hc/schema";
import { autoMode, placementFor, scaleFor, type Box } from "./replaceObject";

const T = (x: number, y: number, s = 1, rotation = 0): Transform => ({ x, y, scaleX: s, scaleY: s, rotation });
const page = { width: 1000, height: 600 };

/** The parent-space rectangle the new visible content covers (no rotation). */
function covered(t: Transform, v: Box) {
  return { x: t.x + v.x * t.scaleX, y: t.y + v.y * t.scaleY, w: v.w * t.scaleX, h: v.h * t.scaleY };
}

describe("replace object sizing", () => {
  it("fills the frame for photo by photo, otherwise sizes optically", () => {
    expect(autoMode(true, true)).toBe("cover");
    expect(autoMode(true, false)).toBe("optical");
    expect(autoMode(false, true)).toBe("optical");
  });

  it("matches a logo of the same proportions exactly, whatever its margins", () => {
    // Old: 200x100 visible. New file 1000x1000 with a 500x250 logo in the middle.
    const s = scaleFor("optical", 200, 100, 500, 250);
    expect(s).toBeCloseTo(0.4, 6);
  });

  it("gives a wide wordmark the visual weight of a square mark, capped at 1.5x", () => {
    // Old: 100x100. New: 400x100 (4:1). Equal area would be 200x50; the cap
    // (1.5x the old width = 150) wins: 150x37.5.
    const s = scaleFor("optical", 100, 100, 400, 100);
    expect(400 * s).toBeCloseTo(150, 6);
    // A 2:1 one stays at equal area: 141x71 (within the caps).
    const s2 = scaleFor("optical", 100, 100, 200, 100);
    expect(200 * s2 * 100 * s2).toBeCloseTo(100 * 100, 4);
  });

  it("contains inside and covers the old visible box on request", () => {
    expect(400 * scaleFor("contain", 100, 100, 400, 100)).toBeCloseTo(100, 6);
    expect(100 * scaleFor("cover", 100, 100, 400, 100)).toBeCloseTo(100, 6);
  });

  it("centres on the old content when it is not near an edge", () => {
    const old = { transform: T(300, 200), size: { width: 200, height: 100 }, visible: { x: 0, y: 0, w: 200, h: 100 }, parent: page };
    const nv = { x: 50, y: 20, w: 100, h: 100 };
    const t = placementFor(old, nv, 1);
    const c = covered(t, nv);
    expect(c.x + c.w / 2).toBeCloseTo(400, 6);
    expect(c.y + c.h / 2).toBeCloseTo(250, 6);
  });

  it("stays flush with the page edge the old content touched", () => {
    // Old logo flush left (visible starts at page x = 0) and flush bottom.
    const old = { transform: T(-10, 480, 2), size: { width: 100, height: 60 }, visible: { x: 5, y: 0, w: 80, h: 60 }, parent: page };
    const nv = { x: 30, y: 30, w: 300, h: 60 };
    const t = placementFor(old, nv, 0.5);
    const c = covered(t, nv);
    expect(c.x).toBeCloseTo(0, 6); // left edge kept
    expect(c.y + c.h).toBeCloseTo(600, 6); // bottom edge kept
  });

  it("keeps rotation and flips, centred on the old content", () => {
    const old = { transform: { x: 500, y: 300, scaleX: -1, scaleY: 1, rotation: 30 } as Transform, size: { width: 100, height: 50 }, visible: { x: 0, y: 0, w: 100, h: 50 }, parent: page };
    const nv = { x: 0, y: 0, w: 40, h: 20 };
    const t = placementFor(old, nv, 2.5);
    expect(t.rotation).toBe(30);
    expect(t.scaleX).toBeCloseTo(-2.5, 6);
    expect(t.scaleY).toBeCloseTo(2.5, 6);
    // Both centres map to the same parent point.
    const centre = (tr: Transform, b: Box) => {
      const r = (tr.rotation * Math.PI) / 180;
      const lx = (b.x + b.w / 2) * tr.scaleX;
      const ly = (b.y + b.h / 2) * tr.scaleY;
      return { x: tr.x + lx * Math.cos(r) - ly * Math.sin(r), y: tr.y + lx * Math.sin(r) + ly * Math.cos(r) };
    };
    const a = centre(old.transform, old.visible);
    const b = centre(t, nv);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.y).toBeCloseTo(a.y, 6);
  });
});
