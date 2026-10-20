// A path whose points lie outside its own size (paths from some SVG imports
// keep the drawing's coordinates and sit at a negative offset) must still be
// drawn where those points are visible: culling and bounds use its geometry,
// not just its size box. A logo's middle word went missing in the editor and
// in every export because of this.

import { describe, expect, it } from "vitest";
import { createScene } from "../scene";
import { renderScene } from "../render2d";
import type { DesignFile, Node } from "@hc/schema";

// Size box at y -570 .. -293 (above the page); the points at y 2745 .. 2880,
// i.e. 2175 .. 2310 once the transform's offset applies: on the page.
const path = (id: string): Node => ({
  id, type: "path", closed: true,
  transform: { x: -1027, y: -570, scaleX: 1, scaleY: 1, rotation: 0 },
  size: { width: 2004, height: 277 },
  opacity: 1, blendMode: "normal",
  fills: [{ type: "solid", color: { srgb: { r: 0.45, g: 0.62, b: 0.55, a: 1 } } }],
  segments: [{ x: 1162, y: 2760 }, { x: 1266, y: 2880 }, { x: 1162, y: 2880 }],
} as unknown as Node);

const file = (node: Node): DesignFile => ({
  schemaVersion: 28, id: "d", title: "t", assets: [], fonts: [], meta: {},
  pages: [{ id: "p", width: 3000, height: 3000, children: [node] }],
} as unknown as DesignFile);

function fills(doc: DesignFile, cull: boolean) {
  let n = 0;
  const noop = () => {};
  const ctx = new Proxy({ canvas: { width: 3000, height: 3000 }, measureText: () => ({ width: 0 }), createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }), createPattern: () => null } as Record<string, unknown>, {
    get: (t, k) => (k === "fill" ? () => { n++; } : k in t ? t[k as string] : noop),
    set: (t, k, v) => { t[k as string] = v; return true; },
  });
  renderScene(createScene(doc, 0), ctx as never, { zoom: 1, panX: 0, panY: 0, dpr: 1, width: 3000, height: 3000 }, { cull } as never);
  return n;
}

describe("a path drawn outside its own size", () => {
  it("is not culled where its points are visible", () => {
    expect(fills(file(path("a")), false)).toBe(1);
    expect(fills(file(path("a")), true)).toBe(1);
  });

  it("has bounds around its points", () => {
    const b = createScene(file(path("a")), 0).getBounds("a")!;
    expect(b.y).toBeLessThanOrEqual(2175);
    expect(b.y + b.height).toBeGreaterThanOrEqual(2310);
  });

  it("is still culled when its size box and its points are both off screen", () => {
    const off = path("b") as unknown as { transform: { y: number }; segments: { x: number; y: number }[] };
    off.transform.y = 20000;
    expect(fills(file(off as unknown as Node), true)).toBe(0);
  });

  it("keeps the box of an ordinary path, whose points lie within its size", () => {
    const plain = { ...(path("c") as unknown as Record<string, unknown>), transform: { x: 100, y: 100, scaleX: 1, scaleY: 1, rotation: 0 }, size: { width: 200, height: 100 }, segments: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 100, y: 100 }] };
    expect(createScene(file(plain as unknown as Node), 0).getBounds("c")).toEqual({ x: 100, y: 100, width: 200, height: 100 });
  });
});
