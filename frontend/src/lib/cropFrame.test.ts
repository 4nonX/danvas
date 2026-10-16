import { describe, expect, it } from "vitest";
import { fromTransform } from "@hc/engine";
import { conformal, frameCorners, framePoint, frameRotatable, rebaseInFrame, transformOf, turnSign } from "./cropFrame";

const T = (extra = {}) => ({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, ...extra });

describe("crop frame", () => {
  it("turns about the frame's centre", () => {
    const f = { x: 0, y: 0, w: 20, h: 10 };
    const [tl, tr, br, bl] = frameCorners(f, 90);
    expect(tl.x).toBeCloseTo(15); expect(tl.y).toBeCloseTo(-5);
    expect(tr.x).toBeCloseTo(15); expect(tr.y).toBeCloseTo(15);
    expect(br.x).toBeCloseTo(5); expect(br.y).toBeCloseTo(15);
    expect(bl.x).toBeCloseTo(5); expect(bl.y).toBeCloseTo(-5);
    const c = framePoint(f, 37, 0.5, 0.5);
    expect(c.x).toBeCloseTo(10); expect(c.y).toBeCloseTo(5);
  });

  it("turns only on evenly scaled, unskewed elements", () => {
    expect(frameRotatable(T({ scaleX: 1.488, scaleY: 1.488 }))).toBe(true);
    expect(frameRotatable(T({ scaleX: -2, scaleY: 2 }))).toBe(true);
    expect(frameRotatable(T({ scaleX: 1.5, scaleY: 0.8 }))).toBe(false);
    expect(frameRotatable(T({ skewX: 10 }))).toBe(false);
    expect(turnSign(T({ scaleX: -1 }))).toBe(-1);
  });

  it("places the content relative to the turned frame", () => {
    const f = { x: 10, y: 10, w: 20, h: 20 };
    const t = rebaseInFrame(T({ x: 20, y: 20, rotation: 5 }), f, 90);
    // The frame's centre (20, 20) is its middle in its own axes too.
    expect(t.x).toBeCloseTo(10); expect(t.y).toBeCloseTo(10);
    expect(t.rotation).toBeCloseTo(-85);
  });

  it("turns any matrix back into a transform, exactly", () => {
    for (const t of [
      T({ x: 3, y: 4, rotation: 33, scaleX: 1.5, scaleY: 0.4 }),
      T({ rotation: -120, scaleX: -2, scaleY: 0.7, skewX: 25 }),
      T({ rotation: 200, scaleX: 0.3, scaleY: -1.2 }),
    ]) {
      const m = fromTransform(t);
      const back = fromTransform(transformOf(m));
      for (const k of ["a", "b", "c", "d", "e", "f"] as const) expect(back[k]).toBeCloseTo(m[k], 9);
    }
    expect(conformal(fromTransform(T({ rotation: 40, scaleX: 2, scaleY: 2 })))).toBe(true);
    expect(conformal(fromTransform(T({ rotation: 40, scaleX: 2, scaleY: 1 })))).toBe(false);
  });
});
