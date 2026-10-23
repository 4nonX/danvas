// A placed graphic (data.hitBox: an icon, a brand graphic, a logo) is grabbed
// anywhere in its box: a thin silhouette over a panel would otherwise let
// every click between its strokes fall through to the panel.

import { describe, expect, it } from "vitest";
import { createScene } from "../scene";
import type { DesignFile, Node } from "@hc/schema";

const rect = (id: string, x: number, y: number, w: number, h: number): Node => ({
  id, type: "shape", shape: "rect",
  transform: { x, y, scaleX: 1, scaleY: 1, rotation: 0 },
  size: { width: w, height: h }, opacity: 1, blendMode: "normal",
  fills: [{ type: "solid", color: { srgb: { r: 0.2, g: 0.4, b: 0.7, a: 1 } } }],
} as unknown as Node);

// A 100 x 100 graphic at (100, 100) whose only stroke is a 4 px stem in the
// middle, over a panel covering the page.
const graphic = (hitBox: boolean): Node => ({
  id: "g", type: "group",
  transform: { x: 100, y: 100, scaleX: 1, scaleY: 1, rotation: 0 },
  size: { width: 100, height: 100 }, opacity: 1, blendMode: "normal",
  ...(hitBox ? { data: { hitBox: true } } : {}),
  children: [rect("stem", 48, 0, 4, 100)],
} as unknown as Node);

const page = (g: Node): DesignFile => ({
  schemaVersion: 29, id: "d", title: "t", assets: [], fonts: [], meta: {},
  pages: [{ id: "p1", width: 400, height: 400, children: [rect("panel", 0, 0, 400, 400), g] }],
} as unknown as DesignFile);

describe("placed graphics", () => {
  it("are grabbed between their strokes", () => {
    expect(createScene(page(graphic(true)), 0).hitTest({ x: 110, y: 110 })?.id).toBe("g");
    // On the stroke the stroke itself is hit, as in any group.
    expect(createScene(page(graphic(true)), 0).hitTest({ x: 150, y: 150 })?.id).toBe("stem");
    // Outside the box the panel is.
    expect(createScene(page(graphic(true)), 0).hitTest({ x: 250, y: 250 })?.id).toBe("panel");
  });

  it("leave other groups as they were: only their shapes are targets", () => {
    expect(createScene(page(graphic(false)), 0).hitTest({ x: 110, y: 110 })?.id).toBe("panel");
  });

  it("are not grabbed when locked", () => {
    const g = { ...graphic(true), locked: true } as Node;
    expect(createScene(page(g), 0).hitTest({ x: 110, y: 110 })?.id).toBe("panel");
  });
});
