// A die line (cut contour) around any elements: their silhouette, offset by
// a set distance outwards (or inwards), with or without the cut-outs inside
// it. The elements are drawn by the editor's own engine at a fine grid, so
// whatever they are (shapes, text, pictures with transparency, groups) the
// contour follows what prints. The offset comes from an exact Euclidean
// distance field of the silhouette, and the contour is traced through it
// with sub-pixel interpolation and fitted with curves; it is accurate to
// the grid size the result reports.

import type { DesignFile, Node, Page } from "@hc/schema";
import { createScene, renderScene, type CanvasLike } from "@hc/engine";
import { worldAABB } from "@hc/editor";
import { imageAssets } from "@/lib/assetProvider";
import { marchingSquares, traceField, type TraceAnchor } from "@/lib/vectorize/trace";
import { isDieLine, PRINT_ROLE_KEY } from "./nodePrint";

/** The finest grid, mm per pixel. */
export const DIE_GRID_MM = 0.025;
/** The most pixels one contour is computed on. */
const MAX_PIXELS = 16e6;

const INF = 1e20;

/** Squared distance transform of one line (Felzenszwalb and Huttenlocher):
 *  f holds 0 at the targets and INF elsewhere; `arg` gets the nearest. */
function dt1d(f: Float64Array, n: number, d: Float64Array, arg: Int32Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    arg[q] = v[k];
  }
}

/** The nearest target pixel of every pixel (its index; -1 without any):
 *  the exact Euclidean feature transform, in two passes. */
export function nearestTarget(target: Uint8Array, w: number, h: number): Int32Array {
  const g = new Float64Array(w * h);
  const row = new Int32Array(w * h);
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n), arg = new Int32Array(n);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = target[y * w + x] ? 0 : INF;
    dt1d(f, h, d, arg, v, z);
    for (let y = 0; y < h; y++) { g[y * w + x] = d[y]; row[y * w + x] = arg[y]; }
  }
  const out = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    dt1d(f, w, d, arg, v, z);
    for (let x = 0; x < w; x++) {
      const col = arg[x];
      out[y * w + x] = d[x] >= INF / 2 ? -1 : row[y * w + col] * w + col;
    }
  }
  return out;
}

/** Euclidean distance (pixels) of every pixel to the nearest target pixel. */
export function distanceTo(target: Uint8Array, w: number, h: number): Float32Array {
  const near = nearestTarget(target, w, h);
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const s = near[i];
    out[i] = s < 0 ? Infinity : Math.hypot((i % w) - (s % w), Math.floor(i / w) - Math.floor(s / w));
  }
  return out;
}

/** The pixels the outside reaches from the border without crossing the
 *  silhouette. */
function reachedOutside(inside: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (i: number) => { if (!inside[i] && !outside[i]) { outside[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w, y = (i - x) / w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  return outside;
}

/**
 * The contour at `offsetPx` from the edge of a coverage mask (alpha
 * 0..255, the edge at half coverage), in mask pixels: positive grows
 * outwards, negative shrinks inwards. Without `holes` the cut-outs inside
 * the silhouette are filled first. The mask must leave room around the
 * silhouette for the offset (the caller pads it).
 *
 * The edge itself is traced first, through the coverage with sub-pixel
 * interpolation. Every pixel then takes its exact distance to that edge:
 * the nearest pixel the edge passes comes from a feature transform, and
 * the distance from the edge's segments around it. So the offset is
 * measured from the artwork's real edge, not from the pixel staircase.
 */
export function dieContourOf(alpha: Uint8Array | Uint8ClampedArray, w: number, h: number, offsetPx: number, holes: boolean): TraceAnchor[][] {
  const n = w * h;
  const cover = new Float32Array(n);
  for (let i = 0; i < n; i++) cover[i] = alpha[i] / 255;
  const inside = new Uint8Array(n);
  for (let i = 0; i < n; i++) inside[i] = cover[i] >= 0.5 ? 1 : 0;
  if (!holes) {
    // Cut-outs become solid; only the outer edge keeps its coverage.
    const out = reachedOutside(inside, w, h);
    for (let i = 0; i < n; i++) {
      if (out[i]) continue;
      const x = i % w;
      const nearOut = (x > 0 && out[i - 1]) || (x < w - 1 && out[i + 1]) || (i >= w && out[i - w]) || (i + w < n && out[i + w]);
      inside[i] = 1;
      if (!nearOut) cover[i] = 1;
    }
  }
  // The edge as segments, in pixel-centre coordinates (pixel i at i).
  const segs: number[] = [];
  for (const loop of marchingSquares(cover, w, h)) {
    for (let k = 0; k < loop.length; k++) {
      const p = loop[k], q = loop[(k + 1) % loop.length];
      segs.push(p.x - 0.5, p.y - 0.5, q.x - 0.5, q.y - 0.5);
    }
  }
  const count = segs.length / 4;
  if (!count) return [];
  // Segments by the pixel their middle lies in.
  const cell = (x: number, y: number) => Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)));
  const start = new Int32Array(n + 1);
  const owner = new Int32Array(count);
  for (let s = 0; s < count; s++) {
    owner[s] = cell((segs[4 * s] + segs[4 * s + 2]) / 2, (segs[4 * s + 1] + segs[4 * s + 3]) / 2);
    start[owner[s] + 1]++;
  }
  for (let i = 0; i < n; i++) start[i + 1] += start[i];
  const fill = start.slice(0, n);
  const list = new Int32Array(count);
  for (let s = 0; s < count; s++) list[fill[owner[s]]++] = s;
  const seed = new Uint8Array(n);
  for (let s = 0; s < count; s++) seed[owner[s]] = 1;
  const segDist = (x: number, y: number, s: number) => {
    const ax = segs[4 * s], ay = segs[4 * s + 1], bx = segs[4 * s + 2], by = segs[4 * s + 3];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
  };
  const near = nearestTarget(seed, w, h);
  const R = 2;
  const field = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = near[i];
    const x = i % w, y = (i - x) / w;
    let dist = Infinity;
    if (s >= 0) {
      // The nearest segment is among those around the nearest edge pixel.
      const sx = s % w, sy = (s - sx) / w;
      for (let yy = Math.max(0, sy - R); yy <= Math.min(h - 1, sy + R); yy++) {
        for (let xx = Math.max(0, sx - R); xx <= Math.min(w - 1, sx + R); xx++) {
          const j = yy * w + xx;
          for (let k = start[j]; k < start[j + 1]; k++) dist = Math.min(dist, segDist(x, y, list[k]));
        }
      }
    }
    const sd = inside[i] ? -dist : dist;
    // Linear in the distance a few pixels either side of the contour, so
    // the crossing between two pixels is where the distance says (clamped
    // to 0..1 it would bend next to a clamped pixel).
    field[i] = Math.min(4, Math.max(-4, 0.5 + offsetPx - sd));
  }
  // Curves within a tenth of a pixel of the traced contour.
  return traceField(field, w, h, { unit: 1, detail: 1, minArea: 4, maxError: 0.1 });
}

const kids = (n: Node) => (n as unknown as { children?: Node[] }).children;

/** The page with only these elements (and the containers they are in). */
function only(page: Page, ids: Set<string>): Page {
  const walk = (nodes: Node[]): Node[] => {
    const out: Node[] = [];
    for (const n of nodes) {
      if (n.hidden || isDieLine(n)) continue;
      if (ids.has(n.id)) { out.push(n); continue; }
      const c = kids(n);
      if (!Array.isArray(c)) continue;
      const inner = walk(c);
      if (inner.length) out.push({ ...n, children: inner } as Node);
    }
    return out;
  };
  const { background: _b, ...rest } = page;
  void _b;
  return { ...rest, children: walk(page.children) } as Page;
}

export interface DieContourResult {
  /** The die line element, in page coordinates, at the top of the page. */
  node: Node;
  /** The grid the contour was computed on, mm per pixel. */
  gridMm: number;
}

/**
 * A die line element around the elements `ids` of page `pageIndex`, at
 * `offsetMm` from their silhouette. Null when they draw nothing.
 */
export function buildDieContour(doc: DesignFile, pageIndex: number, ids: string[], o: { offsetMm: number; holes: boolean; name: string; makeId: () => string }): DieContourResult | null {
  const page = doc.pages[pageIndex];
  if (!page || !ids.length) return null;
  const dpi = doc.dpi ?? 96;
  const pxPerMm = dpi / 25.4;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids) {
    const b = worldAABB(doc, id);
    if (!b) continue;
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
  }
  if (!Number.isFinite(x0)) return null;
  // Room for the offset, effects reaching past the box, and the edge.
  const pad = Math.max(0, o.offsetMm) * pxPerMm + 2 * pxPerMm;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const area = (x1 - x0) * (y1 - y0);
  const zoom = Math.min(1 / (DIE_GRID_MM * pxPerMm), Math.sqrt(MAX_PIXELS / Math.max(1, area)));
  const w = Math.max(4, Math.ceil((x1 - x0) * zoom));
  const h = Math.max(4, Math.ceil((y1 - y0) * zoom));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const solo = { ...doc, pages: doc.pages.map((p, i) => (i === pageIndex ? only(p, new Set(ids)) : p)) } as DesignFile;
  renderScene(createScene(solo, pageIndex), ctx as unknown as CanvasLike, { zoom, panX: x0, panY: y0, dpr: 1, width: w, height: h }, { assets: imageAssets, clear: false, skipBackground: true } as Parameters<typeof renderScene>[3]);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = rgba[i * 4 + 3];
  const contours = dieContourOf(alpha, w, h, o.offsetMm * pxPerMm * zoom, o.holes);
  if (!contours.length) return null;
  // Mask pixels (pixel i spans i..i+1) to page px.
  const at = (p: { x: number; y: number }) => ({ x: x0 + p.x / zoom, y: y0 + p.y / zoom });
  let mx = Infinity, my = Infinity, Mx = -Infinity, My = -Infinity;
  const pageContours = contours.map((c) => c.map((a) => {
    const p = at(a);
    mx = Math.min(mx, p.x); my = Math.min(my, p.y); Mx = Math.max(Mx, p.x); My = Math.max(My, p.y);
    return { ...p, ...(a.cIn ? { cIn: at(a.cIn) } : {}), ...(a.cOut ? { cOut: at(a.cOut) } : {}), ...(a.corner ? { corner: true } : {}) };
  }));
  const local = (p: { x: number; y: number }) => ({ x: p.x - mx, y: p.y - my });
  const segs = pageContours.map((c) => c.map((a) => ({ ...local(a), ...(a.cIn ? { cIn: local(a.cIn) } : {}), ...(a.cOut ? { cOut: local(a.cOut) } : {}), ...(a.corner ? { corner: true } : {}) })));
  const node = {
    id: o.makeId(),
    type: "path",
    name: o.name,
    transform: { x: mx, y: my, scaleX: 1, scaleY: 1, rotation: 0 },
    size: { width: Math.max(1, Mx - mx), height: Math.max(1, My - my) },
    opacity: 1,
    blendMode: "normal",
    closed: true,
    segments: segs[0],
    ...(segs.length > 1 ? { contours: segs.slice(1).map((s) => ({ segments: s, closed: true })) } : {}),
    fills: [],
    stroke: { fill: { type: "solid", color: { srgb: { r: 1, g: 0, b: 1, a: 1 } } }, width: 0.25 * (dpi / 72), align: "center", cap: "round", join: "round" },
    data: { [PRINT_ROLE_KEY]: { dieLine: true } },
  } as unknown as Node;
  return { node, gridMm: 1 / (zoom * pxPerMm) };
}
