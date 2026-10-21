// Prepress steps a print export applies to a copy of each design, whatever
// its format: the finished size rounded to whole millimetres (a label made as
// 89.96 x 39.95 mm goes out as 90 x 40 mm), and artwork that meets the edge
// of the page extended into the bleed by exactly the bleed set (a background
// panel that stops at the cut would leave a white sliver when the cut is a
// little off). The designs themselves are not changed.
//
// Extending works on what can grow without changing its look: rectangles,
// frames (and clipping groups), and pictures that fill their box. It follows
// the element's own geometry through scaled groups. Anything else touching the
// edge (a rotated element, an ellipse or free path, a cropped or letterboxed
// picture) is left as it is and reported, so the download menu can name it.

import type { DesignFile, Node } from "@hc/schema";
import { createScene, pageBleed, type SceneNode } from "@hc/engine";
import { fromUnit, toUnit } from "@/lib/units";

export interface PrepressOptions {
  /** Round each page's size to whole millimetres. */
  roundToMm?: boolean;
  /** Extend artwork at the page edge into the bleed (pages with a bleed). */
  extendIntoBleed?: boolean;
}

export interface PrepressResult {
  doc: DesignFile;
  /** Elements at the edge that could not be extended: page (1-based) and name. */
  notExtended: { page: number; element: string }[];
}

const labelOf = (n: Node) => ((n as { name?: string }).name?.trim() || n.type);

/** Prepares a copy of `doc` (only `pages`, 0-based, or all). */
export function prepressDoc(doc: DesignFile, pages: number[] | null, o: PrepressOptions): PrepressResult {
  const notExtended: PrepressResult["notExtended"] = [];
  if (!o.roundToMm && !o.extendIntoBleed) return { doc, notExtended };
  const out = structuredClone(doc);
  const dpi = out.dpi ?? 96;
  const mm = (v: number) => fromUnit(v, "mm", dpi);
  out.pages.forEach((page, i) => {
    if (pages && !pages.includes(i)) return;
    // How far each size moved: an element that met the old edge still counts
    // as meeting the new one.
    let dw = 0, dh = 0;
    if (o.roundToMm) {
      const w = mm(Math.max(1, Math.round(toUnit(page.width, "mm", dpi))));
      const h = mm(Math.max(1, Math.round(toUnit(page.height, "mm", dpi))));
      dw = w - page.width;
      dh = h - page.height;
      page.width = w;
      page.height = h;
    }
    const bleed = pageBleed(page);
    if (!o.extendIntoBleed || bleed <= 0) return;
    const tolX = mm(0.1) + Math.abs(dw), tolY = mm(0.1) + Math.abs(dh);
    const W = page.width, H = page.height;
    // Children first, on the geometry as it was; then their container. A
    // container that grows to the left or top moves its origin, and its direct
    // children are moved back by as much, so they stay where they are.
    const visit = (sn: SceneNode) => {
      const n = sn.node;
      if ((n as { hidden?: boolean }).hidden) return;
      const container = n.type === "group" || n.type === "frame" || n.type === "mask" || n.type === "boolean";
      const clipping = n.type === "frame" || (n.type === "group" && !!(n as { clip?: boolean }).clip);
      if (container) for (const c of sn.children ?? []) visit(c);
      // A plain group is its children: they are extended, not the group.
      if (container && !clipping) return;
      const moved = extendNode(sn, n, { W, H, bleed, tolX, tolY }, () => notExtended.push({ page: i + 1, element: labelOf(n) }));
      if (moved && container) {
        for (const c of (n as { children?: Node[] }).children ?? []) {
          c.transform = { ...c.transform, x: c.transform.x + moved.x, y: c.transform.y + moved.y };
        }
      }
    };
    for (const sn of createScene(out, i).root.children ?? []) visit(sn);
  });
  return { doc: out, notExtended };
}

type Edge = { W: number; H: number; bleed: number; tolX: number; tolY: number };

/** Extends one element; returns how far its local origin moved back along
 *  its own x and y axes (local units), or null when it was not changed.
 *  Works for any placement that keeps the axes: unturned, or turned by a
 *  multiple of 90 degrees (a label laid out sideways), mirrored or not. */
function extendNode(sn: SceneNode, n: Node, e: Edge, report: () => void): { x: number; y: number } | null {
  const m = sn.worldTransform;
  const w = n.size?.width ?? 0, h = n.size?.height ?? 0;
  if (!(w > 0 && h > 0)) return null;
  // Axis-keeping: local x runs along page x and local y along page y (a, d),
  // or swapped (b, c) after a quarter turn.
  const eps = 1e-6;
  const straight = Math.abs(m[1]) < eps && Math.abs(m[2]) < eps;
  const swapped = Math.abs(m[0]) < eps && Math.abs(m[3]) < eps;
  const keeps = straight || swapped;
  // The element's own box on the page (its geometry, not its effects).
  const xs = [m[4], m[4] + m[0] * w, m[4] + m[2] * h, m[4] + m[0] * w + m[2] * h];
  const ys = [m[5], m[5] + m[1] * w, m[5] + m[3] * h, m[5] + m[1] * w + m[3] * h];
  const bx0 = keeps ? Math.min(...xs) : sn.worldBounds.x, bx1 = keeps ? Math.max(...xs) : sn.worldBounds.x + sn.worldBounds.width;
  const by0 = keeps ? Math.min(...ys) : sn.worldBounds.y, by1 = keeps ? Math.max(...ys) : sn.worldBounds.y + sn.worldBounds.height;
  // Meeting an edge: reaching it (within the tolerance) from inside, not yet
  // filling the bleed beyond it.
  const left = bx0 <= e.tolX && bx0 > -e.bleed + 1e-6 && bx1 > e.tolX;
  const right = bx1 >= e.W - e.tolX && bx1 < e.W + e.bleed - 1e-6 && bx0 < e.W - e.tolX;
  const top = by0 <= e.tolY && by0 > -e.bleed + 1e-6 && by1 > e.tolY;
  const bottom = by1 >= e.H - e.tolY && by1 < e.H + e.bleed - 1e-6 && by0 < e.H - e.tolY;
  if (!left && !right && !top && !bottom) return null;
  if (!canExtend(n)) {
    if (reportable(n)) report();
    return null;
  }
  if (!keeps || n.transform.skewX || n.transform.skewY) { report(); return null; }
  // Which local side lies on a page side, and the page px per local unit
  // along it: page x is local x (straight, |a|) or local y (swapped, |c|).
  type Side = { axis: "x" | "y"; start: boolean; per: number };
  const sideX = (pageStart: boolean): Side => straight
    ? { axis: "x", start: (m[0] > 0) === pageStart, per: Math.abs(m[0]) }
    : { axis: "y", start: (m[2] > 0) === pageStart, per: Math.abs(m[2]) };
  const sideY = (pageStart: boolean): Side => straight
    ? { axis: "y", start: (m[3] > 0) === pageStart, per: Math.abs(m[3]) }
    : { axis: "x", start: (m[1] > 0) === pageStart, per: Math.abs(m[1]) };
  const grow: [Side, number][] = [];
  if (left) grow.push([sideX(true), bx0 + e.bleed]);
  if (right) grow.push([sideX(false), e.W + e.bleed - bx1]);
  if (top) grow.push([sideY(true), by0 + e.bleed]);
  if (bottom) grow.push([sideY(false), e.H + e.bleed - by1]);
  // The node's own local-to-parent matrix (rotation clockwise about its
  // origin, then scale), to move its origin in the parent's units.
  const r = ((n.transform.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  const sx = n.transform.scaleX, sy = n.transform.scaleY;
  const N = { a: cos * sx, b: sin * sx, c: -sin * sy, d: cos * sy };
  const t = { ...n.transform }, s = { ...n.size };
  const moved = { x: 0, y: 0 };
  for (const [side, d] of grow) {
    const L = d / side.per;
    if (side.axis === "x") {
      s.width += L;
      if (side.start) { t.x -= L * N.a; t.y -= L * N.b; moved.x += L; }
    } else {
      s.height += L;
      if (side.start) { t.x -= L * N.c; t.y -= L * N.d; moved.y += L; }
    }
  }
  n.transform = t;
  n.size = s;
  return moved;
}

/** What grows without changing its look. */
function canExtend(n: Node): boolean {
  if (n.type === "frame") return true;
  if (n.type === "group") return !!(n as { clip?: boolean }).clip;
  if (n.type === "shape") {
    const shape = (n as { shape?: string }).shape;
    return shape === undefined || shape === "rect";
  }
  if (n.type === "image") {
    // A picture that fills its box re-covers the larger box; a cropped or
    // letterboxed one would shift or show a gap.
    const img = n as { fit?: string; crop?: unknown };
    return (img.fit ?? "cover") === "cover" && !img.crop;
  }
  return false;
}

/** What is worth naming when it stays at the edge: visible areas, not text
 *  or lines (which seldom run to the cut on purpose). */
function reportable(n: Node): boolean {
  return !["text", "line", "connector", "group"].includes(n.type);
}
