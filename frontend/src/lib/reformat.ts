// Change the format of whole designs, for one or many at once (the
// dashboard's "Change format" action): a new page size, how the content
// follows (laid out anew by Magic Resize, scaled to fit, or left as it is)
// and, for labels that run sideways on a roll, the content turned by 90
// degrees onto a page of the turned size. A 90 x 40 mm label becomes a
// 50 x 100 mm upright one by laying it out at 100 x 50 mm and turning it
// a quarter turn left.

import type { DesignFile, Page } from "@hc/schema";
import { resizePage } from "@hc/editor";

export type ReformatFit = "relayout" | "scale" | "none";
/** Quarter turn of the content: -90 left (counter-clockwise), 90 right. */
export type ReformatTurn = 0 | -90 | 90;

export interface ReformatOptions {
  /** The new page size in design px (exact), as the page ends up. */
  width: number;
  height: number;
  fit: ReformatFit;
  turn: ReformatTurn;
  /** The unit the design shows lengths in afterwards (e.g. "mm"). */
  measureUnit?: string;
}

/** The design with every page in the new format (a copy). */
export function reformatDesign(doc: DesignFile, o: ReformatOptions): DesignFile {
  const out = structuredClone(doc);
  out.pages = out.pages.map((p) => reformatPage(p, o));
  if (o.measureUnit && o.measureUnit !== "px") out.measureUnit = o.measureUnit;
  return out;
}

export function reformatPage(page: Page, o: ReformatOptions): Page {
  // Lay out at the size before the turn: a quarter turn swaps the sides.
  const quarter = o.turn !== 0;
  const lw = quarter ? o.height : o.width;
  const lh = quarter ? o.width : o.height;
  let p: Page;
  if (o.fit === "relayout") {
    p = { ...(resizePage(page, { width: lw, height: lh }) as Page), id: page.id, name: page.name };
  } else if (o.fit === "scale") {
    p = scalePage(page, lw, lh);
  } else {
    p = { ...structuredClone(page), width: lw, height: lh };
  }
  // Keep what the relayout does not carry (print settings, notes, ...).
  for (const k of ["bleed", "printMarks", "background", "notes", "guides"] as const) {
    if (page[k] !== undefined && p[k] === undefined) (p as unknown as Record<string, unknown>)[k] = structuredClone(page[k]);
  }
  return quarter ? turnPage(p, o.turn as -90 | 90) : p;
}

/**
 * Every element scaled by one factor (the one that fits the narrower side),
 * so text keeps its line breaks and nothing is distorted; the room left on
 * the other side is shared out by where an element sits: near the start it
 * stays, near the end it moves the whole way, in between it moves halfway.
 * A plain filled area that starts at an edge and covers most of that side
 * (a colour panel) grows with the room instead.
 */
function scalePage(page: Page, w: number, h: number): Page {
  const s = Math.min(w / page.width, h / page.height);
  const extraX = w - page.width * s, extraY = h - page.height * s;
  const p = structuredClone(page);
  p.width = w;
  p.height = h;
  p.children = p.children.map((n) => {
    const t = n.transform;
    const nw = (n.size?.width ?? 0) * Math.abs(t.scaleX), nh = (n.size?.height ?? 0) * Math.abs(t.scaleY);
    const straight = (t.rotation ?? 0) % 360 === 0;
    const place = (pos: number, len: number, total: number, extra: number) => {
      if (extra <= 0) return { move: 0, grow: 1 };
      const start = pos, end = pos + len;
      // A plain area from an edge over most of the side grows with the room.
      if (straight && plainArea(n) && len >= total * 0.6 && (start <= total * 0.01 || end >= total * 0.99)) {
        const grow = (len * s + extra) / (len * s);
        return { move: start <= total * 0.01 ? 0 : extra - (grow - 1) * len * s, grow };
      }
      const mid = (start + end) / 2 / total;
      return { move: mid < 1 / 3 ? 0 : mid > 2 / 3 ? extra : extra / 2, grow: 1 };
    };
    const px = place(t.x, nw, page.width, extraX), py = place(t.y, nh, page.height, extraY);
    return {
      ...n,
      transform: { ...t, x: t.x * s + px.move, y: t.y * s + py.move, scaleX: t.scaleX * s * px.grow, scaleY: t.scaleY * s * py.grow },
    };
  }) as Page["children"];
  return p;
}

/** A filled rectangle, or a group holding only filled rectangles: it can be
 *  stretched on one side without anything looking distorted. */
function plainArea(n: Page["children"][number]): boolean {
  const rect = (x: { type: string; shape?: string }) => x.type === "shape" && (x.shape === undefined || x.shape === "rect");
  if (rect(n as never)) return true;
  const kids = (n as { children?: { type: string; shape?: string }[] }).children;
  return n.type === "group" && !!kids?.length && kids.every(rect);
}

/**
 * The page turned a quarter turn with its content: a rigid turn of every
 * element about the page, so the result looks exactly like the page rotated.
 * Rotation in the design is clockwise in degrees about an element's origin,
 * so an element's origin is mapped and its rotation adds the turn:
 *   left  (-90): (x, y) -> (y, W - x)
 *   right (+90): (x, y) -> (H - y, x)
 * where W x H is the page before the turn; the page becomes H x W.
 */
export function turnPage(page: Page, turn: -90 | 90): Page {
  const W = page.width, H = page.height;
  const p = structuredClone(page);
  p.width = H;
  p.height = W;
  p.children = p.children.map((n) => {
    const { x, y } = n.transform;
    const at = turn === -90 ? { x: y, y: W - x } : { x: H - y, y: x };
    return { ...n, transform: { ...n.transform, ...at, rotation: normDeg((n.transform.rotation ?? 0) + turn) } };
  }) as Page["children"];
  // Guides follow the content: a vertical guide at x becomes a horizontal
  // one, and the other way round.
  if (p.guides) {
    p.guides = p.guides.map((g) => (g.axis === "x"
      ? { axis: "y" as const, position: turn === -90 ? W - g.position : g.position }
      : { axis: "x" as const, position: turn === -90 ? g.position : H - g.position }));
  }
  return p;
}

const normDeg = (d: number) => {
  const r = ((d % 360) + 360) % 360;
  return r > 180 ? r - 360 : r;
};
