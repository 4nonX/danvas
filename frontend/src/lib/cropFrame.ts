// The crop frame's own rotation: a crop frame may turn independently of the
// element it crops, while the element stays exactly where it is on the page.
//
// The frame is a rectangle in the element's own coordinates (x, y, w, h)
// turned by `angle` degrees about its centre. Cropping makes that frame the
// box of a clipping group: the group takes the element's transform plus the
// frame's turn, and what is inside is turned back by the same amount, so
// nothing moves on the page.
//
// Rotation follows the engine's convention (fromTransform): positive angles
// turn from +x towards +y.

import type { Transform } from "@hc/schema";

export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Pt = { x: number; y: number };

const RAD = Math.PI / 180;

export function rotatePt(p: Pt, deg: number): Pt {
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  return { x: c * p.x - s * p.y, y: s * p.x + c * p.y };
}

/** Whether a frame can turn on this element and stay a true rectangle on the
 *  page: only when the element is scaled the same in both directions and not
 *  skewed (otherwise a turned frame would be drawn as a parallelogram). */
export function frameRotatable(t: Transform): boolean {
  if (t.skewX || t.skewY) return false;
  const ax = Math.abs(t.scaleX);
  const ay = Math.abs(t.scaleY);
  return ax > 0 && Math.abs(ax - ay) <= 1e-6 * Math.max(ax, ay);
}

/** The frame's corners in element coordinates, clockwise from its top-left. */
export function frameCorners(f: FrameRect, angle: number): Pt[] {
  const c = { x: f.x + f.w / 2, y: f.y + f.h / 2 };
  return [
    [-f.w / 2, -f.h / 2],
    [f.w / 2, -f.h / 2],
    [f.w / 2, f.h / 2],
    [-f.w / 2, f.h / 2],
  ].map(([x, y]) => {
    const r = rotatePt({ x, y }, angle);
    return { x: c.x + r.x, y: c.y + r.y };
  });
}

/** A point given in frame axes (u along the frame's width, v along its
 *  height, both 0..1) in element coordinates. */
export function framePoint(f: FrameRect, angle: number, u: number, v: number): Pt {
  const r = rotatePt({ x: (u - 0.5) * f.w, y: (v - 0.5) * f.h }, angle);
  return { x: f.x + f.w / 2 + r.x, y: f.y + f.h / 2 + r.y };
}

/** The rotation the element's own transform adds to a turn in its
 *  coordinates: the same, or the opposite for a mirrored element. */
export function turnSign(t: Transform): 1 | -1 {
  return t.scaleX * t.scaleY < 0 ? -1 : 1;
}

/** The transform of something inside the element (a child of a clipping
 *  group, or the element itself when it gets wrapped) once the frame has
 *  become the group's box: turned back by the frame's angle and placed
 *  relative to the frame's top-left corner, so it stays put on the page. */
export function rebaseInFrame(child: Transform, f: FrameRect, angle: number): Transform {
  const tl = frameCorners(f, angle)[0];
  const p = rotatePt({ x: child.x - tl.x, y: child.y - tl.y }, -angle);
  return { ...child, x: p.x, y: p.y, rotation: child.rotation - angle };
}

/** A 2D affine matrix (engine layout: x' = a x + c y + e, y' = b x + d y + f). */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** Any affine matrix as a transform, exactly: rotation, a horizontal skew
 *  and two scales (a mirror shows as a negative scaleY). The inverse of the
 *  engine's fromTransform for every non-degenerate matrix, so content keeps
 *  its exact place on the page whatever turn, stretch or skew it ends up in. */
export function transformOf(m: Affine): Transform {
  const sx = Math.hypot(m.a, m.b);
  if (sx < 1e-12) return { x: m.e, y: m.f, scaleX: 1, scaleY: 1, rotation: 0 };
  const cos = m.a / sx;
  const sin = m.b / sx;
  const u12 = cos * m.c + sin * m.d;
  const u22 = -sin * m.c + cos * m.d || 1e-12;
  const t: Transform = { x: m.e, y: m.f, scaleX: sx, scaleY: u22, rotation: (Math.atan2(sin, cos) * 180) / Math.PI };
  const skew = (Math.atan(u12 / u22) * 180) / Math.PI;
  if (Math.abs(skew) > 1e-9) t.skewX = skew;
  return t;
}

/** Whether a matrix only turns, scales evenly and maybe mirrors (no stretch,
 *  no skew). */
export function conformal(m: Affine): boolean {
  const s1 = Math.hypot(m.a, m.b);
  const s2 = Math.hypot(m.c, m.d);
  return s1 > 0 && Math.abs(s1 - s2) <= 1e-6 * s1 && Math.abs(m.a * m.c + m.b * m.d) <= 1e-6 * s1 * s2;
}
