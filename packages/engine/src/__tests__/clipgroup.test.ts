// A clipping group (how the editor crops non-image elements) hides its
// children outside its box, so those parts must not be click targets either,
// and the editor's crop mode can draw it unclipped.

import { describe, expect, it } from "vitest";
import { createScene } from "../scene";
import { renderScene } from "../render2d";
import type { DesignFile, Node } from "@hc/schema";

const rect = (id: string, x: number, w: number): Node => ({
  id, type: "shape", shape: "rect",
  transform: { x, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  size: { width: w, height: 100 }, opacity: 1, blendMode: "normal",
  fills: [{ type: "solid", color: { srgb: { r: 1, g: 0, b: 0, a: 1 } } }],
} as unknown as Node);

// A 200 wide rect shown through a 50 wide clipping group at x=100: the rect
// starts 30 left of the group, so page x 70..100 is hidden.
const clipGroup = (clip: boolean): Node => ({
  id: "g", type: "group", clip,
  transform: { x: 100, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  size: { width: 50, height: 100 }, opacity: 1, blendMode: "normal",
  children: [rect("r", -30, 200)],
} as unknown as Node);

const fileWith = (node: Node): DesignFile => ({
  schemaVersion: 19, id: "d", title: "t", assets: [], fonts: [], meta: {},
  pages: [{ id: "p1", width: 400, height: 200, children: [node] }],
} as unknown as DesignFile);

function clipCalls(opts: { unclipIds?: ReadonlySet<string> } = {}) {
  let clips = 0;
  const noop = () => {};
  const ctx = new Proxy({ canvas: { width: 400, height: 200 }, measureText: () => ({ width: 0 }), createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }), createPattern: () => null } as Record<string, unknown>, {
    get: (t, k) => (k === "clip" ? () => { clips++; } : k in t ? t[k as string] : noop),
    set: (t, k, v) => { t[k as string] = v; return true; },
  });
  renderScene(createScene(fileWith(clipGroup(true)), 0), ctx as never, { zoom: 1, panX: 0, panY: 0, dpr: 1, width: 400, height: 200 }, opts as never);
  return clips;
}

describe("clipping group", () => {
  it("is clickable inside its box", () => {
    expect(createScene(fileWith(clipGroup(true)), 0).hitTest({ x: 120, y: 50 })?.id).toBe("r");
  });

  it("is not clickable where its content is clipped away", () => {
    expect(createScene(fileWith(clipGroup(true)), 0).hitTest({ x: 80, y: 50 })).toBeNull();
    // Without the clip the same point hits the rect.
    expect(createScene(fileWith(clipGroup(false)), 0).hitTest({ x: 80, y: 50 })?.id).toBe("r");
  });

  it("can be drawn unclipped for crop editing", () => {
    expect(clipCalls()).toBeGreaterThan(0);
    expect(clipCalls({ unclipIds: new Set(["g"]) })).toBeLessThan(clipCalls());
  });
});
