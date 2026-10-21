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
        const m = sn.worldTransform;
        for (const c of (n as { children?: Node[] }).children ?? []) {
          c.transform = { ...c.transform, x: c.transform.x + moved.left / m[0], y: c.transform.y + moved.top / m[3] };
        }
      }
    };
    for (const sn of createScene(out, i).root.children ?? []) visit(sn);
  });
  return { doc: out, notExtended };
}

type Edge = { W: number; H: number; bleed: number; tolX: number; tolY: number };

/** Extends one element; returns how far (page px) its origin moved left and
 *  up, or null when it was not changed. */
function extendNode(sn: SceneNode, n: Node, e: Edge, report: () => void): { left: number; top: number } | null {
  const m = sn.worldTransform;
  const w = n.size?.width ?? 0, h = n.size?.height ?? 0;
  if (!(w > 0 && h > 0)) return null;
  // The element's own box on the page (its geometry, not its effects).
  const axisAligned = Math.abs(m[1]) < 1e-6 && Math.abs(m[2]) < 1e-6 && m[0] > 0 && m[3] > 0;
  const x0 = m[4], y0 = m[5];
  const x1 = axisAligned ? x0 + m[0] * w : sn.worldBounds.x + sn.worldBounds.width;
  const y1 = axisAligned ? y0 + m[3] * h : sn.worldBounds.y + sn.worldBounds.height;
  const bx0 = axisAligned ? x0 : sn.worldBounds.x, by0 = axisAligned ? y0 : sn.worldBounds.y;
  // Meeting an edge: reaching it (within the tolerance) from inside, not yet
  // filling the bleed beyond it.
  const left = bx0 <= e.tolX && bx0 > -e.bleed + 1e-6 && x1 > e.tolX;
  const right = x1 >= e.W - e.tolX && x1 < e.W + e.bleed - 1e-6 && bx0 < e.W - e.tolX;
  const top = by0 <= e.tolY && by0 > -e.bleed + 1e-6 && y1 > e.tolY;
  const bottom = y1 >= e.H - e.tolY && y1 < e.H + e.bleed - 1e-6 && by0 < e.H - e.tolY;
  if (!left && !right && !top && !bottom) return null;
  if (!canExtend(n)) {
    if (reportable(n)) report();
    return null;
  }
  if (!axisAligned || (n.transform?.rotation ?? 0) % 360 !== 0) { report(); return null; }
  // Page px per local unit (m[0], m[3]) and per parent unit (for x / y).
  const sx = n.transform.scaleX || 1, sy = n.transform.scaleY || 1;
  const psx = m[0] / sx, psy = m[3] / sy;
  const t = { ...n.transform }, s = { ...n.size };
  const moved = { left: 0, top: 0 };
  if (left) { const d = x0 + e.bleed; s.width += d / m[0]; t.x -= d / psx; moved.left = d; }
  if (right) { const d = e.W + e.bleed - (x0 + m[0] * w); s.width += d / m[0]; }
  if (top) { const d = y0 + e.bleed; s.height += d / m[3]; t.y -= d / psy; moved.top = d; }
  if (bottom) { const d = e.H + e.bleed - (y0 + m[3] * h); s.height += d / m[3]; }
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
