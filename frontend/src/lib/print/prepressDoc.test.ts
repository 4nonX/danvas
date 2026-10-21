// The prepress steps of a print export: the finished size rounded to whole
// millimetres and artwork at the edge extended into the bleed, for any format,
// on a copy of the design.
import { describe, expect, it } from "vitest";
import type { DesignFile } from "@hc/schema";
import { prepressDoc } from "./prepressDoc";
import { fromUnit, toUnit } from "@/lib/units";

const MM = (v: number) => fromUnit(v, "mm", 96);
const T = (x: number, y: number, s = 1, rotation = 0) => ({ x, y, scaleX: s, scaleY: s, rotation });
const fill = [{ type: "solid", color: { srgb: { r: 1, g: 0.5, b: 0, a: 1 } } }];
const rect = (id: string, x: number, y: number, w: number, h: number, extra: Record<string, unknown> = {}) =>
  ({ id, name: id, type: "shape", shape: "rect", transform: T(x, y), size: { width: w, height: h }, opacity: 1, blendMode: "normal", fills: fill, ...extra });

// The Propolis case: a 90 x 40 mm label stored as 340 x 151 px, 1.5 mm bleed,
// an orange panel from the top edge down, text inside.
function label(children: unknown[]): DesignFile {
  return {
    format: "hycanvas.design", schemaVersion: 29, id: "d", title: "L", unit: "px", dpi: 96, assets: [], fonts: [], meta: {},
    pages: [{ id: "p", width: 340, height: 151, bleed: MM(1.5), children }],
  } as unknown as DesignFile;
}

const node = (d: DesignFile, id: string): { transform: { x: number; y: number }; size: { width: number; height: number } } => {
  const find = (list: unknown[]): unknown => {
    for (const n of list as { id: string; children?: unknown[] }[]) {
      if (n.id === id) return n;
      const c = n.children && find(n.children);
      if (c) return c;
    }
    return null;
  };
  return find(d.pages[0].children) as never;
};
const mm = (px: number) => Math.round(toUnit(px, "mm", 96) * 100) / 100;

describe("finished size in whole millimetres", () => {
  it("rounds each page to its nearest whole mm, whatever its format", () => {
    const { doc } = prepressDoc(label([]), null, { roundToMm: true });
    expect(mm(doc.pages[0].width)).toBe(90);
    expect(mm(doc.pages[0].height)).toBe(40);
    expect(doc.pages[0].width).toBeCloseTo(MM(90), 9);
  });

  it("leaves the design itself unchanged", () => {
    const d = label([]);
    prepressDoc(d, null, { roundToMm: true, extendIntoBleed: true });
    expect(d.pages[0].width).toBe(340);
  });
});

describe("artwork into the bleed", () => {
  it("extends a panel at the top edge by exactly the bleed, after rounding", () => {
    const d = label([rect("panel", 120, 0, 100, 151), rect("inside", 10, 10, 50, 50)]);
    const { doc, notExtended } = prepressDoc(d, null, { roundToMm: true, extendIntoBleed: true });
    const p = node(doc, "panel");
    expect(mm(p.transform.y)).toBe(-1.5);
    // It reached the old bottom edge (39.95 mm, 0.05 short of the new 40):
    // it now runs to 40 + 1.5 mm.
    expect(mm(p.transform.y + p.size.height)).toBe(41.5);
    expect(p.transform.x).toBe(120);
    expect(node(doc, "inside").size).toEqual({ width: 50, height: 50 });
    expect(notExtended).toEqual([]);
  });

  it("follows scaled groups and extends clipping containers with their content", () => {
    const d = label([{
      id: "g", name: "g", type: "group", clip: true, transform: T(170, 0, 0.5), size: { width: 340, height: 302 }, opacity: 1, blendMode: "normal",
      children: [rect("bg", 0, 0, 340, 302)],
    }]);
    const { doc } = prepressDoc(d, null, { extendIntoBleed: true });
    const g = node(doc, "g"), bg = node(doc, "bg");
    // The group meets the top, right and bottom edges; in its own units (half
    // scale) the bleed is twice as long.
    expect(mm(g.transform.y)).toBe(-1.5);
    expect(mm(g.transform.x + g.size.width * 0.5)).toBe(mm(340) + 1.5);
    expect(mm(bg.transform.y * 0.5 + g.transform.y)).toBe(-1.5);
    expect(mm(170 + (bg.transform.x + bg.size.width) * 0.5)).toBe(mm(340) + 1.5);
  });

  it("names what it cannot extend, and leaves text and art already in the bleed alone", () => {
    const d = label([
      { ...rect("oval", 0, 50, 40, 40), shape: "ellipse" },
      // Turned about its top left corner, so it runs past the right edge.
      rect("turned", 302, 50, 40, 40, { transform: T(302, 50, 1, 10) }),
      { id: "t", type: "text", transform: T(0, 100), size: { width: 50, height: 20 }, content: [] },
      rect("full", -MM(1.5), 120, 30, 10),
    ]);
    const { doc, notExtended } = prepressDoc(d, null, { extendIntoBleed: true });
    expect(notExtended.map((x) => x.element).sort()).toEqual(["oval", "turned"]);
    expect(node(doc, "full").size.width).toBe(30);
  });

  it("does nothing without a bleed", () => {
    const d = label([rect("panel", 120, 0, 100, 151)]);
    delete (d.pages[0] as { bleed?: number }).bleed;
    expect(node(prepressDoc(d, null, { extendIntoBleed: true }).doc, "panel").transform.y).toBe(0);
  });
});
