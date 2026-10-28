import { describe, expect, it } from "vitest";
import type { Node, ShapeNode, TextNode } from "@hc/schema";
import {
  bakeShapeTextScale,
  layoutShapeText,
  restoreShapeTextGeometry,
  SHAPE_TEXT_KEY,
  shapeTextColor,
  shapeTextGeometry,
  shapeTextOf,
  textArea,
  type ShapeTextOverflow,
} from "./shapeText";

const T = (x = 0, y = 0) => ({ x, y, scaleX: 1, scaleY: 1, rotation: 0 });

function make(kind: ShapeNode["shape"], w: number, h: number, overflow: ShapeTextOverflow = "grow") {
  const shape = { id: "s", type: "shape", shape: kind, transform: T(), size: { width: w, height: h }, fills: [] } as unknown as ShapeNode;
  const text = {
    id: "t", type: "text", transform: T(), size: { width: 1, height: 1 },
    box: { mode: "fixed", width: 1, height: 1, padding: { t: 8, r: 8, b: 8, l: 8 }, verticalAlign: "middle" },
    content: [],
  } as unknown as TextNode;
  const group = { id: "g", type: "group", transform: T(50, 60), size: { width: w, height: h }, children: [shape, text], data: { [SHAPE_TEXT_KEY]: { overflow } } } as unknown as Node;
  return { group, shape, text };
}

// Text needing a fixed height, whatever the width.
const needs = (h: number) => () => h;

describe("shapeTextOf", () => {
  it("reads a marked group of a shape and a text frame", () => {
    const st = shapeTextOf(make("rect", 100, 50).group);
    expect(st?.shape.id).toBe("s");
    expect(st?.text.id).toBe("t");
    expect(st?.spec.overflow).toBe("grow");
  });

  it("is null for anything else, and an unknown setting reads as grow", () => {
    const { group, shape } = make("rect", 100, 50);
    expect(shapeTextOf(shape as unknown as Node)).toBeNull();
    expect(shapeTextOf({ ...group, data: {} } as Node)).toBeNull();
    expect(shapeTextOf({ ...group, children: [shape] } as unknown as Node)).toBeNull();
    const odd = { ...group, data: { [SHAPE_TEXT_KEY]: { overflow: "explode" } } } as unknown as Node;
    expect(shapeTextOf(odd)?.spec.overflow).toBe("grow");
  });
});

describe("textArea", () => {
  it("is the whole box of a rectangle", () => {
    expect(textArea({ shape: "rect" }, { width: 200, height: 100 })).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  it("is the largest rectangle inside an ellipse", () => {
    const a = textArea({ shape: "ellipse" }, { width: 200, height: 100 });
    expect(a.width).toBeCloseTo(200 * Math.SQRT1_2);
    expect(a.height).toBeCloseTo(100 * Math.SQRT1_2);
    expect(a.x + a.width / 2).toBeCloseTo(100);
    expect(a.y + a.height / 2).toBeCloseTo(50);
    // Its corners lie on the ellipse.
    const cx = (a.x - 100) / 100;
    const cy = (a.y - 50) / 50;
    expect(cx * cx + cy * cy).toBeCloseTo(1);
  });

  it("sits on the base of a triangle", () => {
    expect(textArea({ shape: "triangle" }, { width: 200, height: 100 })).toEqual({ x: 50, y: 50, width: 100, height: 50 });
  });
});

describe("layoutShapeText", () => {
  it("puts the frame on the text area and fits the group to the shape", () => {
    const { group, shape, text } = make("ellipse", 200, 100);
    layoutShapeText(shapeTextOf(group)!, needs(20));
    expect(text.transform.x).toBeCloseTo(100 - 100 * Math.SQRT1_2);
    expect(text.box.width).toBeCloseTo(200 * Math.SQRT1_2);
    expect(text.box.mode).toBe("fixed");
    expect(shape.size).toEqual({ width: 200, height: 100 });
    expect(group.size).toEqual({ width: 200, height: 100 });
  });

  it("grows the shape until the text fits, and never shrinks it", () => {
    const { group, shape, text } = make("rect", 200, 100);
    layoutShapeText(shapeTextOf(group)!, needs(180));
    expect(shape.size.height).toBeCloseTo(180);
    expect(text.box.height).toBeCloseTo(180);
    expect(group.size.height).toBeCloseTo(180);
    layoutShapeText(shapeTextOf(group)!, needs(40));
    expect(shape.size.height).toBeCloseTo(180);
  });

  it("grows an ellipse so its inner rectangle holds the text", () => {
    const { group, shape, text } = make("ellipse", 200, 100);
    layoutShapeText(shapeTextOf(group)!, needs(150));
    expect(text.box.height).toBeCloseTo(150);
    expect(shape.size.height).toBeCloseTo(150 / Math.SQRT1_2);
  });

  it("shrinks the text instead when set to, and lets it run over when set to", () => {
    const shrink = make("rect", 200, 100, "shrink");
    layoutShapeText(shapeTextOf(shrink.group)!, needs(500));
    expect(shrink.shape.size.height).toBe(100);
    expect(shrink.text.box.autoFit?.enabled).toBe(true);

    const over = make("rect", 200, 100, "overflow");
    layoutShapeText(shapeTextOf(over.group)!, needs(500));
    expect(over.shape.size.height).toBe(100);
    expect(over.text.box.autoFit?.enabled).toBe(false);
  });
});

describe("bakeShapeTextScale", () => {
  it("turns a resize into the shape's size, keeping the text unscaled", () => {
    const { group, shape, text } = make("rect", 200, 100);
    group.transform = { ...group.transform, scaleX: 1.5, scaleY: 2 };
    bakeShapeTextScale(shapeTextOf(group)!, needs(20));
    expect(group.transform.scaleX).toBe(1);
    expect(group.transform.scaleY).toBe(1);
    expect(group.transform.x).toBe(50);
    expect(shape.size).toEqual({ width: 300, height: 200 });
    expect(text.transform.scaleX).toBe(1);
    expect(text.box.width).toBe(300);
  });
});

describe("geometry snapshot", () => {
  it("restores what a layout changed", () => {
    const { group, shape } = make("rect", 200, 100);
    const st = shapeTextOf(group)!;
    const before = shapeTextGeometry(st);
    layoutShapeText(st, needs(300));
    expect(shape.size.height).toBeCloseTo(300);
    restoreShapeTextGeometry(st, before);
    expect(shape.size.height).toBe(100);
    expect(group.size.height).toBe(100);
  });
});

describe("shapeTextColor", () => {
  it("is white on a dark fill and dark on a light or missing one", () => {
    const fill = (r: number, g: number, b: number) => ({ fills: [{ type: "solid", color: { srgb: { r, g, b, a: 1 } } }] }) as unknown as ShapeNode;
    expect(shapeTextColor(fill(0.38, 0.22, 0.86)).r).toBe(1);
    expect(shapeTextColor(fill(0.95, 0.95, 0.9)).r).toBeLessThan(0.5);
    expect(shapeTextColor({ fills: [] } as unknown as ShapeNode).r).toBeLessThan(0.5);
  });
});
