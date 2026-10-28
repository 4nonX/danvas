// Text in a shape: a group of the shape and a text frame, marked in the
// group's `data`, whose text frame follows the shape. The frame covers the
// part of the shape text belongs in (all of a rectangle, the largest
// rectangle inside an ellipse, a triangle, a star ...); its padding keeps the
// text off the shape's edge. When the text needs more room than that, the
// group's overflow setting decides: the shape grows taller, the text shrinks,
// or the text runs over.
//
// Being an ordinary group of a shape and a text frame is deliberate: every
// renderer and export already draws it, and a version that does not know the
// marker still shows it right (it only stops following the shape).

import type { Node, ShapeNode, TextNode } from "@hc/schema";

export type ShapeTextOverflow = "grow" | "shrink" | "overflow";
export const SHAPE_TEXT_OVERFLOWS: ShapeTextOverflow[] = ["grow", "shrink", "overflow"];

/** The group's `data` key that marks it as a shape with text. */
export const SHAPE_TEXT_KEY = "shapeText";
/** The padding a new shape text starts with, in px. */
export const SHAPE_TEXT_PADDING = 8;

export interface ShapeTextSpec { overflow: ShapeTextOverflow }

type Group = Node & { type: "group"; children: Node[]; data?: Record<string, unknown> };

export interface ShapeText {
  group: Group;
  shape: ShapeNode;
  text: TextNode;
  spec: ShapeTextSpec;
}

/** The parts of a shape with text, or null when `node` is not one: a group
 *  marked with SHAPE_TEXT_KEY holding exactly a shape and then a text frame. */
export function shapeTextOf(node: Node | null | undefined): ShapeText | null {
  if (!node || node.type !== "group") return null;
  const g = node as Group;
  const raw = g.data?.[SHAPE_TEXT_KEY] as { overflow?: unknown } | undefined;
  if (!raw || typeof raw !== "object") return null;
  const [shape, text] = g.children ?? [];
  if (g.children?.length !== 2 || shape?.type !== "shape" || text?.type !== "text") return null;
  const overflow = SHAPE_TEXT_OVERFLOWS.includes(raw.overflow as ShapeTextOverflow) ? (raw.overflow as ShapeTextOverflow) : "grow";
  return { group: g, shape: shape as ShapeNode, text: text as TextNode, spec: { overflow } };
}

export interface Rect { x: number; y: number; width: number; height: number }

/** Where text goes in a shape of the given size, in the shape's own space:
 *  the whole box for a rectangle or a free shape, the largest centred
 *  rectangle inside an ellipse or a regular polygon, the lower middle of a
 *  triangle, the inner circle of a star. Each scales with the shape, so a
 *  taller shape always gives taller room. */
export function textArea(shape: Pick<ShapeNode, "shape" | "innerRadius">, size: { width: number; height: number }): Rect {
  const { width: w, height: h } = size;
  const centred = (fw: number, fh: number): Rect => ({ x: (w * (1 - fw)) / 2, y: (h * (1 - fh)) / 2, width: w * fw, height: h * fh });
  switch (shape.shape) {
    case "ellipse":
    case "polygon":
      return centred(Math.SQRT1_2, Math.SQRT1_2);
    case "triangle":
      // Apex at the top: the widest rectangle sits on the base, half as wide
      // and half as tall as the triangle.
      return { x: w / 4, y: h / 2, width: w / 2, height: h / 2 };
    case "star": {
      const inner = Math.min(Math.max(shape.innerRadius ?? 0.5, 0.1), 1);
      return centred(inner * Math.SQRT1_2, inner * Math.SQRT1_2);
    }
    default:
      return { x: 0, y: 0, width: w, height: h };
  }
}

/** Measures the height text lays out to at a width, padding included. */
export type MeasureHeight = (text: TextNode, width: number) => number;

/**
 * Puts the text frame on the shape's text area and applies the overflow
 * setting, in place. "grow" makes the shape (and the group) taller until the
 * text fits; it never makes it smaller, so a shape keeps the size it was given
 * when text is removed. The shape sits at the group's origin.
 */
export function layoutShapeText(st: ShapeText, measure: MeasureHeight): void {
  const { group, shape, text, spec } = st;
  shape.transform = { ...shape.transform, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
  let area = textArea(shape, shape.size);
  if (spec.overflow === "grow") {
    const need = measure(text, area.width);
    if (need > area.height + 0.5 && area.height > 0) {
      shape.size = { ...shape.size, height: shape.size.height * (need / area.height) };
      area = textArea(shape, shape.size);
    }
  }
  text.transform = { ...text.transform, x: area.x, y: area.y, scaleX: 1, scaleY: 1, rotation: 0 };
  text.size = { width: area.width, height: area.height };
  const box = text.box;
  box.mode = "fixed";
  box.width = area.width;
  box.height = area.height;
  box.autoFit = { enabled: spec.overflow === "shrink", min: box.autoFit?.min ?? 8, max: box.autoFit?.max ?? 512 };
  group.size = { width: shape.size.width, height: shape.size.height };
}

/** Folds a resize of the group (its scale) into the shape's size, so the text
 *  reflows at its own size instead of being stretched; then lays it out. */
export function bakeShapeTextScale(st: ShapeText, measure: MeasureHeight): void {
  const t = st.group.transform;
  const sx = Math.abs(t.scaleX ?? 1);
  const sy = Math.abs(t.scaleY ?? 1);
  st.shape.size = { width: st.shape.size.width * sx, height: st.shape.size.height * sy };
  st.group.transform = { ...t, scaleX: 1, scaleY: 1 };
  layoutShapeText(st, measure);
}

/** The text colour that reads on the shape: white on a dark solid fill,
 *  near-black otherwise (no fill, light fill, gradient or picture). */
export function shapeTextColor(shape: ShapeNode): { r: number; g: number; b: number; a: number } {
  const fill = shape.fills?.[0] as { type?: string; color?: { srgb?: { r: number; g: number; b: number } } } | undefined;
  const c = fill?.type === "solid" ? fill.color?.srgb : undefined;
  if (!c) return { r: 0.1, g: 0.12, b: 0.16, a: 1 };
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  return lum < 0.4 ? { r: 1, g: 1, b: 1, a: 1 } : { r: 0.1, g: 0.12, b: 0.16, a: 1 };
}

/** A starting font size that suits the shape: a quarter of its text area's
 *  height, between 12 and 32 px. */
export function shapeTextFontSize(area: Rect): number {
  return Math.round(Math.min(32, Math.max(12, area.height / 4)));
}

/** What laying out a shape with text changes, for undo. */
export interface ShapeTextGeometry {
  group: Pick<Node, "transform" | "size">;
  shape: Pick<Node, "transform" | "size">;
  text: Pick<TextNode, "transform" | "size" | "box">;
}

export function shapeTextGeometry(st: ShapeText): ShapeTextGeometry {
  return structuredClone({
    group: { transform: st.group.transform, size: st.group.size },
    shape: { transform: st.shape.transform, size: st.shape.size },
    text: { transform: st.text.transform, size: st.text.size, box: st.text.box },
  });
}

export function restoreShapeTextGeometry(st: ShapeText, g: ShapeTextGeometry): void {
  const c = structuredClone(g);
  st.group.transform = c.group.transform;
  st.group.size = c.group.size;
  st.shape.transform = c.shape.transform;
  st.shape.size = c.shape.size;
  st.text.transform = c.text.transform;
  st.text.size = c.text.size;
  st.text.box = c.text.box;
}
