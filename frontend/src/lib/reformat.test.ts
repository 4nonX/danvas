// Changing a design's format: a 90 x 40 mm label becomes a 50 x 100 mm
// upright one (laid out at 100 x 50 mm, turned a quarter left), and the
// artwork of the turned label still extends into the bleed.
import { describe, expect, it } from "vitest";
import type { DesignFile, Page } from "@hc/schema";
import { createScene } from "@hc/engine";
import { reformatDesign, turnPage } from "./reformat";
import { prepressDoc } from "./print/prepressDoc";
import { fromUnit, toUnit } from "./units";

const MM = (v: number) => fromUnit(v, "mm", 96);
const mm = (px: number) => Math.round(toUnit(px, "mm", 96) * 100) / 100;
const T = (x: number, y: number, rotation = 0) => ({ x, y, scaleX: 1, scaleY: 1, rotation });
const fill = [{ type: "solid", color: { srgb: { r: 0.2, g: 0.5, b: 0.8, a: 1 } } }];
const rect = (id: string, x: number, y: number, w: number, h: number) =>
  ({ id, name: id, type: "shape", shape: "rect", transform: T(x, y), size: { width: w, height: h }, opacity: 1, blendMode: "normal", fills: fill });

function label(): DesignFile {
  // 90 x 40 mm as stored before exact sizes: text left, a full-height panel
  // in the middle, text right.
  return {
    format: "hycanvas.design", schemaVersion: 29, id: "d", title: "L", unit: "px", dpi: 96, assets: [], fonts: [], meta: {},
    pages: [{ id: "p", width: 340, height: 151, bleed: MM(1.5), children: [rect("left", 10, 10, 100, 60), rect("panel", 120, 0, 100, 151), rect("right", 230, 10, 100, 60)] }],
  } as unknown as DesignFile;
}

/** An element's box on the page, in mm. */
function boxMm(doc: DesignFile, id: string) {
  const scene = createScene(doc, 0);
  let found: { worldBounds: { x: number; y: number; width: number; height: number } } | null = null;
  const walk = (sn: { node: { id: string }; children?: unknown[] }) => {
    if (sn.node.id === id) found = sn as never;
    for (const c of (sn.children ?? []) as never[]) walk(c);
  };
  walk(scene.root as never);
  const b = found!.worldBounds;
  return { x0: mm(b.x), y0: mm(b.y), x1: mm(b.x + b.width), y1: mm(b.y + b.height) };
}

describe("turning a page", () => {
  it("turns the content a quarter left exactly like the page turned", () => {
    const p = { id: "p", width: 400, height: 200, children: [rect("a", 10, 20, 100, 50)] } as unknown as Page;
    const t = turnPage(p, -90);
    expect([t.width, t.height]).toEqual([200, 400]);
    const doc = { format: "hycanvas.design", schemaVersion: 29, id: "d", title: "t", unit: "px", dpi: 96, assets: [], fonts: [], meta: {}, pages: [t] } as unknown as DesignFile;
    // The box (10..110, 20..70) of a 400 x 200 page turned left lies at
    // x 20..70, y 400-110..400-10 = 290..390.
    const s = createScene(doc, 0);
    const b = (s.root.children ?? [])[0].worldBounds;
    expect([b.x, b.y, b.x + b.width, b.y + b.height].map((v) => Math.round(v * 1000) / 1000)).toEqual([20, 290, 70, 390]);
  });

  it("turns right too, and back again", () => {
    const p = { id: "p", width: 400, height: 200, children: [rect("a", 10, 20, 100, 50)] } as unknown as Page;
    const back = turnPage(turnPage(p, 90), -90);
    expect([back.width, back.height]).toEqual([400, 200]);
    const n = back.children[0] as unknown as { transform: { x: number; y: number; rotation: number } };
    expect([Math.round(n.transform.x), Math.round(n.transform.y), n.transform.rotation]).toEqual([10, 20, 0]);
  });
});

describe("a 90 x 40 mm label to 50 x 100 mm upright", () => {
  const upright = () => reformatDesign(label(), { width: MM(50), height: MM(100), fit: "relayout", turn: -90, measureUnit: "mm" });

  it("is exactly 50 x 100 mm, in mm, with its bleed", () => {
    const d = upright();
    expect([mm(d.pages[0].width), mm(d.pages[0].height)]).toEqual([50, 100]);
    expect(d.measureUnit).toBe("mm");
    expect(mm(d.pages[0].bleed ?? 0)).toBe(1.5);
  });

  it("keeps the order across: the right column is at the top after a left turn", () => {
    const d = upright();
    const left = boxMm(d, "left"), right = boxMm(d, "right"), panel = boxMm(d, "panel");
    expect(right.y1).toBeLessThan(panel.y0 + 0.01);
    expect(left.y0).toBeGreaterThan(panel.y1 - 0.01);
    // The full-height panel runs across the whole width of the upright page.
    expect([panel.x0, panel.x1]).toEqual([0, 50]);
  });

  it("scaled instead of laid out anew: one factor for all, the panel stretches", () => {
    const d = reformatDesign(label(), { width: MM(50), height: MM(100), fit: "scale", turn: -90, measureUnit: "mm" });
    expect([mm(d.pages[0].width), mm(d.pages[0].height)]).toEqual([50, 100]);
    const left = boxMm(d, "left"), right = boxMm(d, "right"), panel = boxMm(d, "panel");
    // 340 x 151 px into 100 x 50 mm: the width sets the factor, the extra
    // height goes to the full-height panel, which then spans the turned width.
    expect([panel.x0, panel.x1]).toEqual([0, 50]);
    expect(right.y1).toBeLessThan(panel.y0 + 0.01);
    expect(left.y0).toBeGreaterThan(panel.y1 - 0.01);
    // The text columns keep their proportions (no stretch).
    expect(Math.round((left.x1 - left.x0) / (left.y1 - left.y0) * 100) / 100).toBe(0.6);
  });

  it("lets a pattern on the panel grow with it, so it still reaches the panel's ends", () => {
    const doc = label();
    const pattern = { id: "pattern", name: "pattern", type: "group", transform: T(122, -0.4), size: { width: 40, height: 151.4 }, opacity: 1, blendMode: "normal",
      children: [{ id: "leaves", name: "leaves", type: "path", transform: T(0, 0), size: { width: 40, height: 151.4 }, opacity: 1, blendMode: "normal", contours: [], fills: fill }] };
    const text = { id: "word", name: "word", type: "text", transform: T(130, 20), size: { width: 80, height: 110 }, opacity: 1, blendMode: "normal" };
    doc.pages[0].children.push(pattern as never, text as never);
    const d = reformatDesign(doc, { width: MM(50), height: MM(100), fit: "scale", turn: -90, measureUnit: "mm" });
    const panel = boxMm(d, "panel"), leaves = boxMm(d, "leaves");
    // Turned left, the panel's height runs across the page: the pattern spans it.
    expect(Math.abs(leaves.x0 - panel.x0)).toBeLessThan(0.15);
    expect(Math.abs(leaves.x1 - panel.x1)).toBeLessThan(0.15);
    // Its position on the panel is unchanged along the other side.
    expect(leaves.y0).toBeGreaterThanOrEqual(panel.y0 - 0.01);
    // Text on the panel keeps its proportions.
    const word = d.pages[0].children.find((n) => n.id === "word")!;
    expect(word.transform.scaleX).toBeCloseTo(word.transform.scaleY, 6);
  });

  it("still extends the turned panel into the bleed", () => {
    const { doc, notExtended } = prepressDoc(upright(), null, { extendIntoBleed: true });
    const panel = boxMm(doc, "panel");
    expect([panel.x0, panel.x1]).toEqual([-1.5, 51.5]);
    expect(notExtended).toEqual([]);
  });
});
