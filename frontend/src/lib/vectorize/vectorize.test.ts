// Vectorize test matrix. Each case renders a synthetic image with known
// truth (anti-aliased like the upsampled raster the tracer really gets),
// traces it, rasterizes the vector result back (layers painted bottom to
// top, even-odd per layer) and requires the pixels to match the truth.

import { describe, expect, it } from "vitest";
import { traceImage, type TraceAnchor, type TraceLayer } from "./trace";
import { MAX_CANVAS_SIDE, PIXEL_BUDGET, planRaster } from "./plan";
import { upsampleBicubic } from "./resample";

type RGB = [number, number, number];
/** Colour index at a point, or -1 for transparent. */
type Scene = (x: number, y: number) => number;

/** Supersampled RGBA (coverage-weighted colour + alpha) and the truth labels. */
function render(w: number, h: number, palette: RGB[], scene: Scene, ss = 4) {
  const data = new Uint8ClampedArray(w * h * 4);
  const truth = new Int16Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = scene(x + (sx + 0.5) / ss, y + (sy + 0.5) / ss);
          if (c >= 0) { r += palette[c][0]; g += palette[c][1]; b += palette[c][2]; a++; }
        }
      }
      const i = (y * w + x) * 4;
      if (a) { data[i] = r / a; data[i + 1] = g / a; data[i + 2] = b / a; }
      data[i + 3] = (255 * a) / (ss * ss);
      truth[y * w + x] = scene(x + 0.5, y + 0.5);
    }
  }
  return { data, truth };
}

/** Flatten a closed Bézier contour to a polygon. */
function flatten(c: TraceAnchor[], steps = 10): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < c.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length];
    const p1 = a.cOut ?? a, p2 = b.cIn ?? b;
    for (let s = 0; s < steps; s++) {
      const t = s / steps, mt = 1 - t;
      out.push({
        x: mt * mt * mt * a.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * b.x,
        y: mt * mt * mt * a.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * b.y,
      });
    }
  }
  return out;
}

/** Paint the layers back: index into `layers` per pixel centre (-1 = none). */
function rasterize(layers: TraceLayer[], w: number, h: number): Int16Array {
  const out = new Int16Array(w * h).fill(-1);
  layers.forEach((layer, li) => {
    const polys = layer.contours.map((c) => flatten(c));
    for (let y = 0; y < h; y++) {
      const py = y + 0.5;
      // Even-odd scanline crossings for this row.
      const xs: number[] = [];
      for (const poly of polys) {
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const a = poly[i], b = poly[j];
          if ((a.y > py) !== (b.y > py)) xs.push(a.x + ((py - a.y) * (b.x - a.x)) / (b.y - a.y));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const x0 = Math.max(0, Math.ceil(xs[k] - 0.5)), x1 = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = x0; x <= x1; x++) out[y * w + x] = li;
      }
    }
  });
  return out;
}

/** Share of pixels (where truth or result paints) whose colour matches. */
function agreement(truth: Int16Array, painted: Int16Array, layers: TraceLayer[], palette: RGB[]): number {
  const near = (c: RGB, d: RGB) => Math.abs(c[0] - d[0]) + Math.abs(c[1] - d[1]) + Math.abs(c[2] - d[2]) < 60;
  let total = 0, ok = 0;
  for (let i = 0; i < truth.length; i++) {
    const t = truth[i], p = painted[i];
    if (t < 0 && p < 0) continue;
    total++;
    if (t >= 0 && p >= 0 && near(palette[t], layers[p].color)) ok++;
  }
  return total ? ok / total : 1;
}

async function check(w: number, h: number, palette: RGB[], scene: Scene, scale: number, opts: Partial<{ colors: number | "auto"; removeBackground: boolean; detail: number }> = {}) {
  const { data, truth } = render(w, h, palette, scene);
  const res = await traceImage(data, w, h, { colors: "auto", detail: 0.6, scale, removeBackground: false, ...opts });
  const painted = rasterize(res.layers, w, h);
  // No spikes: every anchor and handle stays near the image.
  const m = 3 * scale + 2;
  for (const l of res.layers) for (const c of l.contours) for (const a of c) {
    for (const q of [a, a.cIn, a.cOut]) {
      if (!q) continue;
      expect(Number.isFinite(q.x) && Number.isFinite(q.y)).toBe(true);
      expect(q.x).toBeGreaterThanOrEqual(-m);
      expect(q.y).toBeGreaterThanOrEqual(-m);
      expect(q.x).toBeLessThanOrEqual(w + m);
      expect(q.y).toBeLessThanOrEqual(h + m);
    }
  }
  return { res, score: agreement(truth, painted, res.layers, palette) };
}

const BLUE: RGB = [32, 96, 160], WHITE: RGB = [255, 255, 255], RED: RGB = [200, 30, 40], GREEN: RGB = [32, 96, 61];
const circle = (cx: number, cy: number, r: number) => (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

describe("vectorize trace matrix", () => {
  it("single filled circle on transparency", async () => {
    const c = circle(100, 100, 60);
    const { res, score } = await check(200, 200, [BLUE], (x, y) => (c(x, y) ? 0 : -1), 4);
    expect(res.layers).toHaveLength(1);
    expect(res.layers[0].contours).toHaveLength(1);
    // A circle needs only a handful of smooth Bézier anchors, not a pixel walk.
    expect(res.layers[0].contours[0].length).toBeLessThanOrEqual(12);
    expect(score).toBeGreaterThan(0.97);
  });

  it("ring keeps its hole", async () => {
    const o = circle(100, 100, 70), i = circle(100, 100, 35);
    const { res, score } = await check(200, 200, [GREEN], (x, y) => (o(x, y) && !i(x, y) ? 0 : -1), 4);
    expect(res.layers[0].contours.length).toBe(2);
    expect(score).toBeGreaterThan(0.97);
  });

  it("two colours stack without seams", async () => {
    const inner = circle(100, 100, 45);
    const { res, score } = await check(200, 200, [BLUE, WHITE], (x, y) => (x >= 20 && x < 180 && y >= 20 && y < 180 ? (inner(x, y) ? 1 : 0) : -1), 4);
    expect(res.layers).toHaveLength(2);
    expect(score).toBeGreaterThan(0.97);
  });

  it("square keeps sharp corners", async () => {
    const { res, score } = await check(200, 200, [RED], (x, y) => (x >= 40 && x < 160 && y >= 40 && y < 160 ? 0 : -1), 4);
    const anchors = res.layers[0].contours[0];
    expect(anchors.filter((a) => a.corner).length).toBeGreaterThanOrEqual(4);
    expect(score).toBeGreaterThan(0.98);
  });

  it("curved loop with a single corner is not dropped", async () => {
    // Polar teardrop: one sharp tip at (140, 100), curved everywhere else, so
    // the whole edge is one run that starts and ends at the same corner.
    const drop = (x: number, y: number) => Math.hypot(x - 60, y - 100) <= 80 / (1 + 2 * Math.abs(Math.sin(Math.atan2(y - 100, x - 60) / 2)));
    for (const scale of [2, 4]) {
      const { res, score } = await check(200, 200, [RED], (x, y) => (drop(x, y) ? 0 : -1), scale);
      expect(res.layers[0].contours).toHaveLength(1);
      const tip = res.layers[0].contours[0].filter((a) => a.corner);
      expect(tip.some((a) => Math.hypot(a.x - 140, a.y - 100) < 2)).toBe(true);
      expect(score).toBeGreaterThan(0.97);
    }
  });

  it("acute triangle keeps its point", async () => {
    // Apex angle ~25 degrees.
    const tri = (x: number, y: number) => y >= 20 && y <= 180 && Math.abs(x - 100) <= (y - 20) * 0.22;
    const { res, score } = await check(200, 200, [RED], (x, y) => (tri(x, y) ? 0 : -1), 4);
    const apex = res.layers[0].contours[0].reduce((best, a) => (a.y < best.y ? a : best));
    expect(Math.abs(apex.x - 100)).toBeLessThan(2.5);
    expect(apex.y).toBeLessThan(26);
    expect(score).toBeGreaterThan(0.96);
  });

  it("letter-like A with hole and crossbar", async () => {
    // Outer triangle, inner counter, crossbar gap: acute apex, holes, short edges.
    const inTri = (x: number, y: number, top: number, bottom: number, k: number) => y >= top && y <= bottom && Math.abs(x - 100) <= (y - top) * k;
    const A = (x: number, y: number) => {
      if (!inTri(x, y, 20, 180, 0.42)) return false;
      if (inTri(x, y, 60, 180, 0.42) && !(y >= 110 && y <= 128)) return false;
      return true;
    };
    const { res, score } = await check(200, 200, [BLUE], (x, y) => (A(x, y) ? 0 : -1), 4);
    expect(res.layers).toHaveLength(1);
    expect(score).toBeGreaterThan(0.96);
  });

  it("keeps 1-pixel strokes (umbel spokes, fine stems)", async () => {
    // Spokes one source pixel wide, rendered at 4x: 4 px wide at the render.
    const spokes = (x: number, y: number) => {
      for (let k = 0; k < 7; k++) {
        const a = (-Math.PI / 2) + (k - 3) * 0.28;
        const dx = Math.cos(a), dy = Math.sin(a);
        const t = (x - 100) * dx + (y - 170) * dy;
        const d = Math.abs((x - 100) * dy - (y - 170) * dx);
        if (t > 0 && t < 140 && d < 2) return true;
      }
      return false;
    };
    const { res, score } = await check(200, 200, [WHITE], (x, y) => (spokes(x, y) ? 0 : -1), 4);
    expect(res.layers).toHaveLength(1);
    expect(score).toBeGreaterThan(0.85);
  });

  it("thin anti-aliased stalks stay continuous (source-res lines, upsampled like the editor)", async () => {
    // Stalks 1.2 source px wide at several angles, drawn anti-aliased at
    // SOURCE resolution (60x60), then upsampled 4x like the editor does: their pixels
    // never reach full coverage, which is what broke umbel spokes apart.
    const S = 60, K = 4;
    const stalk = (x: number, y: number) => {
      for (let k = 0; k < 6; k++) {
        const a = -Math.PI / 2 + (k - 2.5) * 0.35;
        const dx = Math.cos(a), dy = Math.sin(a);
        const t = (x - 30) * dx + (y - 54) * dy;
        const d = Math.abs((x - 30) * dy - (y - 54) * dx);
        if (t > 4 && t < 34 && d < 0.6) return true;
      }
      return false;
    };
    const small = render(S, S, [WHITE], (x, y) => (stalk(x, y) ? 0 : -1), 8);
    // Enlarged with the same bicubic filter the editor uses.
    const W = S * K;
    const data = upsampleBicubic(small.data, S, S, K).data;
    const res = await traceImage(data, W, W, { colors: "auto", detail: 0.6, scale: K, removeBackground: false });
    expect(res.layers).toHaveLength(1);
    // All six stalks meet at the base: one connected shape, not fragments.
    const big = res.layers[0].contours.filter((c) => c.length >= 4);
    expect(big.length).toBe(1);
    // Each stalk reaches its far end: sample along it, every point painted.
    const painted = rasterize(res.layers, W, W);
    for (let k = 0; k < 6; k++) {
      const a = -Math.PI / 2 + (k - 2.5) * 0.35;
      let hits = 0, n = 0;
      for (let t = 8; t < 32; t += 1) {
        const x = Math.round((30 + Math.cos(a) * t) * K - 0.5), y = Math.round((54 + Math.sin(a) * t) * K - 0.5);
        n++;
        if (painted[y * W + x] >= 0) hits++;
      }
      expect(hits / n).toBeGreaterThan(0.95);
    }
  });

  it("straight edges of source-res artwork come out straight and accurate", async () => {
    // Bars at 0, 7, 33 and 90 degrees drawn anti-aliased at SOURCE
    // resolution (as in a Canva PNG), enlarged like the editor does.
    const S = 80, K = 4;
    const bars = [
      { a: 0, cx: 40, cy: 14, len: 60, wid: 6 },
      { a: (7 * Math.PI) / 180, cx: 40, cy: 32, len: 60, wid: 6 },
      { a: (33 * Math.PI) / 180, cx: 40, cy: 55, len: 40, wid: 6 },
      { a: Math.PI / 2, cx: 76, cy: 61, len: 30, wid: 5 },
    ];
    const inBar = (x: number, y: number) => bars.some((b) => {
      const u = (x - b.cx) * Math.cos(b.a) + (y - b.cy) * Math.sin(b.a);
      const v = -(x - b.cx) * Math.sin(b.a) + (y - b.cy) * Math.cos(b.a);
      return Math.abs(u) <= b.len / 2 && Math.abs(v) <= b.wid / 2;
    });
    const small = render(S, S, [WHITE], (x, y) => (inBar(x, y) ? 0 : -1), 8);
    const big = upsampleBicubic(small.data, S, S, K);
    const res = await traceImage(big.data, big.width, big.height, { colors: "auto", detail: 0.6, scale: K, removeBackground: false });
    expect(res.layers).toHaveLength(1);
    // Every bar edge: sample points along the true long edges (render px)
    // and measure the distance to the traced outline.
    const polys = res.layers[0].contours.map((c) => flatten(c, 24));
    const distToOutline = (px: number, py: number) => {
      let best = Infinity;
      for (const poly of polys) for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const ax = poly[j].x, ay = poly[j].y, bx = poly[i].x, by = poly[i].y;
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
        best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy));
      }
      return best;
    };
    let worst = 0;
    for (const b of bars) {
      for (const side of [-1, 1]) {
        for (let f = -0.4; f <= 0.4; f += 0.05) {
          const u = f * b.len, v = (side * b.wid) / 2;
          const x = (b.cx + u * Math.cos(b.a) - v * Math.sin(b.a)) * K;
          const y = (b.cy + u * Math.sin(b.a) + v * Math.cos(b.a)) * K;
          const dd = distToOutline(x, y);
          worst = Math.max(worst, dd);
        }
      }
    }
    // Within a fifth of a source pixel along every long edge.
    expect(worst / K).toBeLessThan(0.2);
    // And the long edges are emitted as straight lines: a horizontal bar's
    // top edge lies within 0.05 source px of a straight line.
    const top = polys.flat().filter((p) => p.y / K > 9 && p.y / K < 13 && p.x / K > 16 && p.x / K < 64);
    const ys = top.map((p) => p.y / K);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.1);
  });

  it("thin diagonal bar", async () => {
    const { score } = await check(240, 240, [BLUE], (x, y) => (Math.abs(x - y) < 6 && x > 20 && x < 220 ? 0 : -1), 2);
    expect(score).toBeGreaterThan(0.93);
  });

  it("tiny icon (16 px source shown at 4x)", async () => {
    // A plus sign drawn on a 16 px grid, rendered at 64 px.
    const plus = (x: number, y: number) => ((x >= 24 && x < 40 && y >= 8 && y < 56) || (y >= 24 && y < 40 && x >= 8 && x < 56) ? 0 : -1);
    const { res, score } = await check(64, 64, [GREEN], plus, 4);
    expect(res.layers).toHaveLength(1);
    // 8 outer + 4 inner corners, all sharp.
    expect(res.layers[0].contours[0].filter((a) => a.corner).length).toBe(12);
    expect(score).toBeGreaterThan(0.95);
  });

  it("long thin banner", async () => {
    const bars = (x: number, y: number) => (y >= 10 && y < 30 && Math.floor(x / 40) % 2 === 0 ? 0 : -1);
    const { res, score } = await check(1600, 40, [BLUE], bars, 2);
    expect(res.layers[0].contours.length).toBe(20);
    expect(score).toBeGreaterThan(0.97);
  });

  it("opaque background can be removed", async () => {
    const star = (x: number, y: number) => {
      const a = Math.atan2(y - 100, x - 100), r = Math.hypot(x - 100, y - 100);
      return r < 45 + 30 * Math.cos(5 * a);
    };
    const scene: Scene = (x, y) => (star(x, y) ? 1 : 0);
    const kept = await check(200, 200, [WHITE, RED], scene, 4);
    expect(kept.res.layers).toHaveLength(2);
    expect(kept.score).toBeGreaterThan(0.97);
    const removed = await check(200, 200, [WHITE, RED], scene, 4, { removeBackground: true });
    expect(removed.res.layers).toHaveLength(1);
    expect(removed.res.layers[0].color[0]).toBeGreaterThan(150);
  });

  it("flags photographic images", async () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const w = 120, h = 120;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      // Smooth gradient plus noise: no flat colour regions.
      data[i * 4] = (i % w) * 2 + rnd() * 40;
      data[i * 4 + 1] = Math.floor(i / w) * 2 + rnd() * 40;
      data[i * 4 + 2] = 128 + rnd() * 80;
      data[i * 4 + 3] = 255;
    }
    const res = await traceImage(data, w, h, { colors: "auto", detail: 0.6, scale: 1, removeBackground: false });
    expect(res.meanError).toBeGreaterThan(9);
  });

  it("flat artwork is not flagged", async () => {
    const c = circle(100, 100, 60);
    const { res } = await check(200, 200, [BLUE, WHITE], (x, y) => (c(x, y) ? 0 : 1), 4);
    expect(res.meanError).toBeLessThan(9);
  });
});

describe("raster plan", () => {
  it("upsamples small and normal images up to 4x", () => {
    const tiny = planRaster(300, 300, 16, 16);
    expect(tiny.upsample).toBeCloseTo(4);
    expect(tiny.width).toBe(64);
    const logo = planRaster(40, 50, 345, 472);
    expect(logo.upsample).toBeCloseTo(4);
    expect(logo.width).toBeGreaterThanOrEqual(345 * 4 - 2);
  });

  it("stays within the pixel budget for huge images", () => {
    const huge = planRaster(500, 500, 8000, 8000);
    expect(huge.width * huge.height).toBeLessThanOrEqual(PIXEL_BUDGET * 1.01);
    expect(huge.upsample).toBeLessThan(1);
  });

  it("respects the canvas side limit for extreme aspect ratios", () => {
    const thin = planRaster(2000, 10, 10000, 50);
    expect(thin.width).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
    expect(thin.height).toBeGreaterThanOrEqual(1);
    // Still at or above source resolution where the budget allows.
    expect(thin.width).toBeGreaterThanOrEqual(10000);
  });
});
