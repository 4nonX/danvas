// @vitest-environment jsdom
// The die line around a silhouette: the distance field, the offset contour
// (outwards and inwards), cut-outs, and how exactly it lies.
import { describe, expect, it } from "vitest";
import { dieContourOf, distanceTo } from "./dieContour";
import type { TraceAnchor } from "@/lib/vectorize/trace";

/** A coverage mask from an inside test on pixel centres, with the edge
 *  anti-aliased by 4 x 4 supersampling (as a render gives it). */
function mask(w: number, h: number, inside: (x: number, y: number) => boolean): Uint8Array {
  const a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) n++;
      a[y * w + x] = Math.round((n / 16) * 255);
    }
  }
  return a;
}

/** Points along a fitted contour (curves sampled). */
function sample(c: TraceAnchor[], steps = 16): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < c.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length];
    const p1 = a.cOut ?? a, p2 = b.cIn ?? b;
    for (let s = 0; s < steps; s++) {
      const t = s / steps, u = 1 - t;
      out.push({
        x: u * u * u * a.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * b.x,
        y: u * u * u * a.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * b.y,
      });
    }
  }
  return out;
}

const area = (pts: { x: number; y: number }[]) => {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  return Math.abs(s / 2);
};

describe("distance field", () => {
  it("is the exact Euclidean distance to the nearest target pixel", () => {
    const w = 23, h = 17;
    const target = new Uint8Array(w * h);
    const pts = [[3, 4], [19, 2], [11, 14], [0, 16]];
    for (const [x, y] of pts) target[y * w + x] = 1;
    const d = distanceTo(target, w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const want = Math.min(...pts.map(([px, py]) => Math.hypot(x - px, y - py)));
        expect(d[y * w + x]).toBeCloseTo(want, 5);
      }
    }
  });
});

describe("die line contour", () => {
  // A disc of radius 40 px in the middle of a 160 px mask.
  const W = 160, C = 80, R = 40;
  const disc = mask(W, W, (x, y) => Math.hypot(x - C, y - C) <= R);

  for (const offset of [0, 6, 15, -8]) {
    it(`runs at ${offset} px from a disc's edge, within less than half a pixel`, () => {
      const contours = dieContourOf(disc, W, W, offset, false);
      expect(contours).toHaveLength(1);
      const pts = sample(contours[0]);
      const errs = pts.map((p) => Math.hypot(p.x - C, p.y - C) - (R + offset));
      // No bias, and no point off by more than 0.4 of the grid.
      expect(Math.abs(errs.reduce((a, b) => a + b, 0) / errs.length)).toBeLessThan(0.1);
      expect(Math.max(...errs.map(Math.abs))).toBeLessThan(0.4);
      // And it is the round contour, not a polygon of it.
      expect(area(pts) / (Math.PI * (R + offset) ** 2)).toBeCloseTo(1, 2);
    });
  }

  it("keeps a square's corners square at no offset and rounds them by the offset outside", () => {
    const sq = mask(120, 120, (x, y) => x >= 30 && x <= 90 && y >= 30 && y <= 90);
    const tight = sample(dieContourOf(sq, 120, 120, 0, false)[0]);
    expect(area(tight)).toBeCloseTo(60 * 60, -1);
    const d = 10;
    const grown = sample(dieContourOf(sq, 120, 120, d, false)[0]);
    // The square grown by d with quarter circles at the corners.
    expect(area(grown) / (60 * 60 + 4 * 60 * d + Math.PI * d * d)).toBeCloseTo(1, 2);
  });

  it("cuts out the holes only when asked", () => {
    // A ring: radius 40 outside, 20 inside.
    const ring = mask(W, W, (x, y) => { const r = Math.hypot(x - C, y - C); return r <= 40 && r >= 20; });
    expect(dieContourOf(ring, W, W, 2, false)).toHaveLength(1);
    const both = dieContourOf(ring, W, W, 2, true);
    expect(both).toHaveLength(2);
    // The hole shrinks by the offset: radius 18.
    const inner = both.map((c) => sample(c)).sort((a, b) => area(a) - area(b))[0];
    const worst = Math.max(...inner.map((p) => Math.abs(Math.hypot(p.x - C, p.y - C) - 18)));
    expect(worst).toBeLessThan(0.4);
    // An offset larger than half the hole closes it.
    expect(dieContourOf(ring, W, W, 22, true)).toHaveLength(1);
  });

  it("joins shapes closer together than twice the offset", () => {
    const two = mask(200, 100, (x, y) => (Math.hypot(x - 60, y - 50) <= 25) || (Math.hypot(x - 140, y - 50) <= 25));
    expect(dieContourOf(two, 200, 100, 5, false)).toHaveLength(2);
    expect(dieContourOf(two, 200, 100, 16, false)).toHaveLength(1);
  });

  it("finds nothing in an empty mask", () => {
    expect(dieContourOf(new Uint8Array(50 * 50), 50, 50, 5, false)).toEqual([]);
  });
});
