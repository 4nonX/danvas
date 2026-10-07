// Raster-to-vector tracing for flat artwork (logos, icons, illustrations):
// turns RGBA pixels into a few colour layers of smooth, editable Bézier paths.
//
// Pipeline:
//   1. Colour reduction: k-means in CIELAB on the opaque pixels, either a fixed
//      count or "auto" (8 clusters, then near-identical ones merged and specks
//      dropped). Anti-aliased edge pixels fall to their nearest colour.
//   2. Stacked layers: layers are ordered largest first and each layer's
//      region is the union of itself and every layer above it, so upper
//      layers always sit on solid underpaint and no seams can show between
//      neighbouring colours.
//   3. Sub-pixel contours: each layer's coverage (alpha-weighted) is softened
//      with a small Gaussian and traced with marching squares at the 50% level
//      with linear interpolation, so edges follow the artwork, not the pixel
//      grid. The input is expected to be rendered at a few times the source
//      resolution (see vectorizeImageNode), which gives the interpolation
//      real edge information to work with.
//   4. Curve fitting: contours are fitted with cubic Béziers (Schneider's
//      least-squares fitter with Newton reparameterization) split at real
//      corners, which stay sharp; everything else becomes smooth curves.
//
// Pure: no DOM, so it can run in a worker; all coordinates are in input pixels.

export interface TraceOptions {
  /** Number of colours, or "auto". */
  colors: number | "auto";
  /** 0 (smooth, fewer points) .. 1 (detailed). */
  detail: number;
  /** Input pixels per source-artwork pixel (the upsampling factor). */
  scale: number;
  /** Drop the colour that covers most of the image border (an opaque
   *  background behind a logo). */
  removeBackground: boolean;
}

export interface TraceAnchor {
  x: number;
  y: number;
  cIn?: { x: number; y: number };
  cOut?: { x: number; y: number };
  corner?: boolean;
}

export interface TraceLayer {
  /** sRGB 0..255. */
  color: [number, number, number];
  contours: TraceAnchor[][];
}

export interface TraceResult {
  layers: TraceLayer[];
  width: number;
  height: number;
  /** Mean CIELAB distance of the opaque pixels to their layer colour. Flat
   *  artwork stays low (anti-aliased edges only); photos and gradients run
   *  high, which the UI reports instead of producing blob noise. */
  meanError: number;
}

type Pt = { x: number; y: number };

// --- colour ------------------------------------------------------------------

function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const dist2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** Deterministic pseudo-random (so the same image traces the same way). */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function kmeans(samples: number[][], k: number, iterations = 14): number[][] {
  const rand = rng(1234567);
  const centers: number[][] = [samples[Math.floor(rand() * samples.length)]];
  // k-means++ seeding.
  const d = new Float64Array(samples.length).fill(Infinity);
  while (centers.length < k) {
    const c = centers[centers.length - 1];
    let total = 0;
    for (let i = 0; i < samples.length; i++) {
      d[i] = Math.min(d[i], dist2(samples[i], c));
      total += d[i];
    }
    if (total === 0) break;
    let pick = rand() * total;
    let idx = 0;
    for (; idx < samples.length - 1; idx++) {
      pick -= d[idx];
      if (pick <= 0) break;
    }
    centers.push(samples[idx]);
  }
  for (let it = 0; it < iterations; it++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const s of samples) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const dd = dist2(s, centers[c]);
        if (dd < bd) { bd = dd; best = c; }
      }
      const acc = sums[best];
      acc[0] += s[0]; acc[1] += s[1]; acc[2] += s[2]; acc[3]++;
    }
    for (let c = 0; c < centers.length; c++) {
      if (sums[c][3]) centers[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
    }
  }
  return centers;
}

/** Palette (Lab centers) + per-pixel label (-1 = transparent). */
function quantize(data: Uint8ClampedArray, n: number, opts: TraceOptions): { labels: Int16Array; palette: number[][]; rgb: [number, number, number][]; meanError: number } {
  const opaque: number[] = [];
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] >= 128) opaque.push(i);
  const labels = new Int16Array(n).fill(-1);
  if (!opaque.length) return { labels, palette: [], rgb: [], meanError: 0 };

  // Lab per 15-bit colour bucket, shared by sampling and assignment.
  const bucketLab = new Map<number, number[]>();
  const keyOf = (i: number) => ((data[i * 4] >> 3) << 10) | ((data[i * 4 + 1] >> 3) << 5) | (data[i * 4 + 2] >> 3);
  const labOf = (key: number) => {
    let v = bucketLab.get(key);
    if (!v) {
      v = srgbToLab(((key >> 10) & 31) * 8 + 4, ((key >> 5) & 31) * 8 + 4, (key & 31) * 8 + 4);
      bucketLab.set(key, v);
    }
    return v;
  };
  const rand = rng(42);
  const sampleCount = Math.min(40000, opaque.length);
  const samples: number[][] = [];
  for (let s = 0; s < sampleCount; s++) samples.push(labOf(keyOf(opaque[Math.floor(rand() * opaque.length)])));

  let centers = kmeans(samples, opts.colors === "auto" ? 8 : Math.max(1, Math.min(16, opts.colors)));

  const assignAll = (cs: number[][]) => {
    const cache = new Map<number, number>();
    const counts = new Array(cs.length).fill(0);
    for (const i of opaque) {
      const key = keyOf(i);
      let c = cache.get(key);
      if (c === undefined) {
        const lab = labOf(key);
        let bd = Infinity;
        c = 0;
        for (let j = 0; j < cs.length; j++) {
          const dd = dist2(lab, cs[j]);
          if (dd < bd) { bd = dd; c = j; }
        }
        cache.set(key, c);
      }
      labels[i] = c;
      counts[c]++;
    }
    return counts;
  };

  let counts = assignAll(centers);
  if (opts.colors === "auto") {
    // Merge near-identical colours (dE < 12), then drop specks (< 0.4%).
    for (;;) {
      let bi = -1, bj = -1, bd = 144;
      for (let i = 0; i < centers.length; i++)
        for (let j = i + 1; j < centers.length; j++) {
          const dd = dist2(centers[i], centers[j]);
          if (dd < bd) { bd = dd; bi = i; bj = j; }
        }
      if (bi < 0) break;
      const wi = counts[bi] || 1, wj = counts[bj] || 1;
      centers[bi] = centers[bi].map((v, k) => (v * wi + centers[bj][k] * wj) / (wi + wj));
      counts[bi] += counts[bj];
      centers.splice(bj, 1);
      counts.splice(bj, 1);
    }
    const minCount = opaque.length * 0.004;
    const kept = centers.filter((_, i) => counts[i] >= minCount);
    if (kept.length && kept.length < centers.length) centers = kept;
    counts = assignAll(centers);
  }

  // Each layer's display colour: the mean actual sRGB of its pixels.
  const sums = centers.map(() => [0, 0, 0, 0]);
  for (const i of opaque) {
    const s = sums[labels[i]];
    s[0] += data[i * 4]; s[1] += data[i * 4 + 1]; s[2] += data[i * 4 + 2]; s[3]++;
  }
  const rgb = sums.map((s) => (s[3] ? [Math.round(s[0] / s[3]), Math.round(s[1] / s[3]), Math.round(s[2] / s[3])] : [0, 0, 0]) as [number, number, number]);
  // Fit quality on a sample of opaque pixels.
  let errSum = 0;
  const errN = Math.min(20000, opaque.length);
  for (let s = 0; s < errN; s++) {
    const i = opaque[Math.floor(rand() * opaque.length)];
    errSum += Math.sqrt(dist2(labOf(keyOf(i)), centers[labels[i]]));
  }
  return { labels, palette: centers, rgb, meanError: errSum / errN };
}

// --- field + marching squares --------------------------------------------------

/** Box radius whose three passes approximate a Gaussian of `sigma`. */
function boxRadius(sigma: number): number {
  return sigma < 0.3 ? 0 : Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2));
}

/** The blur actually applied for `sigma` (three box passes of boxRadius). */
function effectiveSigma(sigma: number): number {
  const r = boxRadius(sigma);
  return r ? Math.sqrt(((2 * r + 1) ** 2 - 1) / 4) : 0;
}

/** Separable box blur, applied three times (~Gaussian), in place. */
function blur(field: Float32Array, w: number, h: number, sigma: number): void {
  const r = boxRadius(sigma);
  if (!r) return;
  const tmp = new Float32Array(field.length);
  const pass = (src: Float32Array, dst: Float32Array, horizontal: boolean) => {
    const len = horizontal ? w : h, lines = horizontal ? h : w;
    const step = horizontal ? 1 : w, lineStep = horizontal ? w : 1;
    const norm = 1 / (2 * r + 1);
    for (let l = 0; l < lines; l++) {
      const base = l * lineStep;
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[base + Math.min(len - 1, Math.max(0, k)) * step];
      for (let p = 0; p < len; p++) {
        dst[base + p * step] = acc * norm;
        const out = Math.max(0, p - r), inn = Math.min(len - 1, p + r + 1);
        acc += src[base + inn * step] - src[base + out * step];
      }
    }
  };
  for (let i = 0; i < 3; i++) {
    pass(field, tmp, true);
    pass(tmp, field, false);
  }
}

/** Running maximum over a (2r+1) window, separable, in place. */
function maxFilter(field: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(field.length);
  const out = new Float32Array(field.length);
  const pass = (src: Float32Array, dst: Float32Array, horizontal: boolean) => {
    const len = horizontal ? w : h, lines = horizontal ? h : w;
    const step = horizontal ? 1 : w, lineStep = horizontal ? w : 1;
    // Monotonic deque per line: O(n) regardless of r.
    const dq = new Int32Array(len);
    for (let l = 0; l < lines; l++) {
      const base = l * lineStep;
      let head = 0, tail = 0;
      for (let p = 0; p < len + r; p++) {
        if (p < len) {
          const v = src[base + p * step];
          while (tail > head && src[base + dq[tail - 1] * step] <= v) tail--;
          dq[tail++] = p;
        }
        const c = p - r;
        if (c < 0) continue;
        while (dq[head] < c - r) head++;
        dst[base + c * step] = src[base + dq[head] * step];
      }
    }
  };
  pass(field, tmp, true);
  pass(tmp, out, false);
  return out;
}

/** Relative coverage: each pixel divided by the strongest coverage around it
 *  (floor 0.5). Shapes that reach full coverage are unchanged; strokes too
 *  thin to ever be fully covered (anti-aliased 1-2 px lines peaking at
 *  30-60%) are traced at their half height instead of breaking apart at the
 *  absolute 50% level. Faint halos stay below the level. */
function normalizeCoverage(field: Float32Array, w: number, h: number, r: number): void {
  const local = maxFilter(field, w, h, r);
  for (let i = 0; i < field.length; i++) field[i] = Math.min(1, field[i] / Math.max(0.5, local[i]));
}

/** Closed iso-contours (level 0.5) of a field, in pixel-centre coordinates. */
function marchingSquares(field: Float32Array, w: number, h: number): Pt[][] {
  // Pad with zeros so every contour closes.
  const W = w + 2, H = h + 2;
  const v = (x: number, y: number) => (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1 ? 0 : field[(y - 1) * w + (x - 1)]);
  const iso = 0.5;
  const pos = new Map<number, Pt>();
  const adj = new Map<number, number[]>();
  const hEdge = (x: number, y: number) => (y * W + x) * 2;
  const vEdge = (x: number, y: number) => (y * W + x) * 2 + 1;
  const point = (id: number): void => {
    if (pos.has(id)) return;
    const cell = id >> 1, x = cell % W, y = (cell - x) / W;
    if (id & 1) {
      const a = v(x, y), b = v(x, y + 1);
      const t = a === b ? 0.5 : (iso - a) / (b - a);
      pos.set(id, { x: x - 0.5, y: y + t - 0.5 });
    } else {
      const a = v(x, y), b = v(x + 1, y);
      const t = a === b ? 0.5 : (iso - a) / (b - a);
      pos.set(id, { x: x + t - 0.5, y: y - 0.5 });
    }
  };
  const link = (a: number, b: number) => {
    point(a); point(b);
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  };
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const tl = v(x, y), tr = v(x + 1, y), br = v(x + 1, y + 1), bl = v(x, y + 1);
      const c = (tl >= iso ? 8 : 0) | (tr >= iso ? 4 : 0) | (br >= iso ? 2 : 0) | (bl >= iso ? 1 : 0);
      if (c === 0 || c === 15) continue;
      const T = hEdge(x, y), B = hEdge(x, y + 1), L = vEdge(x, y), R = vEdge(x + 1, y);
      const centre = (tl + tr + br + bl) / 4 >= iso;
      switch (c) {
        case 1: case 14: link(L, B); break;
        case 2: case 13: link(B, R); break;
        case 3: case 12: link(L, R); break;
        case 4: case 11: link(T, R); break;
        case 6: case 9: link(T, B); break;
        case 7: case 8: link(T, L); break;
        case 5: if (centre) { link(T, L); link(B, R); } else { link(T, R); link(L, B); } break;
        case 10: if (centre) { link(T, R); link(L, B); } else { link(T, L); link(B, R); } break;
      }
    }
  }
  const loops: Pt[][] = [];
  const seen = new Set<number>();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop: Pt[] = [];
    let prev = -1, cur = start;
    for (let guard = 0; guard < 1e7; guard++) {
      seen.add(cur);
      loop.push(pos.get(cur)!);
      const nb = adj.get(cur)!;
      const next = nb[0] !== prev ? nb[0] : nb[1];
      if (next === undefined || next === start) break;
      prev = cur;
      cur = next;
      if (seen.has(cur)) break;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function area(loop: Pt[]): number {
  let a = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) a += (loop[j].x + loop[i].x) * (loop[j].y - loop[i].y);
  return a / 2;
}

// --- simplification + curve fitting --------------------------------------------

function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = pts[a], B = pts[b];
    const dx = B.x - A.x, dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i].x - dx * pts[i].y + B.x * A.y - B.y * A.x) / len;
      if (d > md) { md = d; mi = i; }
    }
    if (mi >= 0 && md > eps) {
      keep[mi] = 1;
      stack.push([a, mi], [mi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mulp = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const norm = (a: Pt): Pt => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; };

type Bez = [Pt, Pt, Pt, Pt];

function bezPt(b: Bez, t: number): Pt {
  const mt = 1 - t;
  const a = mt * mt * mt, c1 = 3 * mt * mt * t, c2 = 3 * mt * t * t, d = t * t * t;
  return { x: a * b[0].x + c1 * b[1].x + c2 * b[2].x + d * b[3].x, y: a * b[0].y + c1 * b[1].y + c2 * b[2].y + d * b[3].y };
}

function chordParams(p: Pt[]): number[] {
  const u = [0];
  for (let i = 1; i < p.length; i++) u.push(u[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y));
  const tot = u[u.length - 1] || 1;
  return u.map((v) => v / tot);
}

function generateBezier(p: Pt[], u: number[], t1: Pt, t2: Pt): Bez {
  const first = p[0], last = p[p.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < p.length; i++) {
    const t = u[i], mt = 1 - t;
    const b0 = mt * mt * mt, b1 = 3 * mt * mt * t, b2 = 3 * mt * t * t, b3 = t * t * t;
    const a1 = mulp(t1, b1), a2 = mulp(t2, b2);
    c00 += dot(a1, a1); c01 += dot(a1, a2); c11 += dot(a2, a2);
    const tmp = sub(p[i], add(mulp(first, b0 + b1), mulp(last, b2 + b3)));
    x0 += dot(a1, tmp); x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let al = det === 0 ? 0 : (x0 * c11 - x1 * c01) / det;
  let ar = det === 0 ? 0 : (c00 * x1 - c01 * x0) / det;
  const segLen = Math.hypot(last.x - first.x, last.y - first.y);
  const eps = 1e-6 * segLen;
  // Degenerate or ill-conditioned least squares (short, nearly straight
  // runs): handles pointing backwards or shooting far beyond the segment
  // would draw spikes. Fall back to the stable one-third heuristic.
  if (!(al >= eps && ar >= eps && al <= 2.5 * segLen && ar <= 2.5 * segLen)) { al = ar = segLen / 3; }
  return [first, add(first, mulp(t1, al)), add(last, mulp(t2, ar)), last];
}

function maxError(p: Pt[], b: Bez, u: number[]): [number, number] {
  let md = 0, split = Math.floor(p.length / 2);
  for (let i = 1; i < p.length - 1; i++) {
    const q = bezPt(b, u[i]);
    const d = (q.x - p[i].x) ** 2 + (q.y - p[i].y) ** 2;
    if (d >= md) { md = d; split = i; }
  }
  return [md, split];
}

function reparam(p: Pt[], u: number[], b: Bez): number[] {
  const d1 = [mulp(sub(b[1], b[0]), 3), mulp(sub(b[2], b[1]), 3), mulp(sub(b[3], b[2]), 3)];
  const d2 = [mulp(sub(d1[1], d1[0]), 2), mulp(sub(d1[2], d1[1]), 2)];
  const q1 = (t: number) => { const mt = 1 - t; return add(add(mulp(d1[0], mt * mt), mulp(d1[1], 2 * mt * t)), mulp(d1[2], t * t)); };
  const q2 = (t: number) => add(mulp(d2[0], 1 - t), mulp(d2[1], t));
  return u.map((t, i) => {
    const d = sub(bezPt(b, t), p[i]);
    const a = q1(t), c = q2(t);
    const den = dot(a, a) + dot(d, c);
    const nt = den === 0 ? t : t - dot(d, a) / den;
    return Math.min(1, Math.max(0, nt));
  });
}

/** Max distance of the points from the chord between the first and last. */
function chordDeviation(p: Pt[]): number {
  const A = p[0], B = p[p.length - 1];
  const dx = B.x - A.x, dy = B.y - A.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Infinity;
  let md = 0;
  for (let i = 1; i < p.length - 1; i++) md = Math.max(md, Math.abs(dy * p[i].x - dx * p[i].y + B.x * A.y - B.y * A.x) / len);
  return md;
}

/** Straight-line tolerance and minimum straight length (render px); set
 *  per trace in traceImage. */
let lineTol = 0.5;
let minStraight = 4;

function fitCubic(p: Pt[], t1: Pt, t2: Pt, err2: number, out: Bez[], depth = 0): void {
  // A run that lies on its chord is a straight edge: emit an exact line
  // (handles on the chord) instead of a curve that bends within tolerance.
  if (p.length > 2 && chordDeviation(p) <= lineTol) {
    const a = p[0], b = p[p.length - 1];
    out.push([a, add(a, mulp(sub(b, a), 1 / 3)), add(a, mulp(sub(b, a), 2 / 3)), b]);
    return;
  }
  if (p.length === 2) {
    const d = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y) / 3;
    out.push([p[0], add(p[0], mulp(t1, d)), add(p[1], mulp(t2, d)), p[1]]);
    return;
  }
  let u = chordParams(p);
  let b = generateBezier(p, u, t1, t2);
  let [e, split] = maxError(p, b, u);
  if (e < err2 || depth > 40) { out.push(b); return; }
  if (e < err2 * 4) {
    for (let i = 0; i < 6; i++) {
      u = reparam(p, u, b);
      b = generateBezier(p, u, t1, t2);
      [e, split] = maxError(p, b, u);
      if (e < err2) { out.push(b); return; }
    }
  }
  const tc = norm(sub(p[split - 1], p[split + 1]));
  fitCubic(p.slice(0, split + 1), t1, tc, err2, out, depth + 1);
  fitCubic(p.slice(split), mulp(tc, -1), t2, err2, out, depth + 1);
}

/** How far the middle third of a point run sits off its chord, relative to
 *  the outer thirds: an arc bows consistently to one side, a line's
 *  residuals are only noise. */
function bowOf(pts: Pt[]): number {
  const A = pts[0], B = pts[pts.length - 1];
  const d = norm(sub(B, A));
  const m = pts.length - 1;
  let mid = 0, nm = 0, outer = 0, no = 0;
  pts.forEach((p, q) => {
    const v = (p.x - A.x) * d.y - (p.y - A.y) * d.x;
    const f = q / m;
    if (f > 1 / 3 && f < 2 / 3) { mid += v; nm++; } else { outer += v; no++; }
  });
  return nm > 0 && no > 0 ? Math.abs(mid / nm - outer / no) : 0;
}

/** Least-squares line through points: centroid, unit direction and the
 *  largest perpendicular deviation. */
function lsqLine(pts: Pt[]): { c: Pt; d: Pt; dev: number } {
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= pts.length; cy /= pts.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) { const dx = p.x - cx, dy = p.y - cy; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const d = { x: Math.cos(ang), y: Math.sin(ang) };
  let dev = 0;
  for (const p of pts) dev = Math.max(dev, Math.abs((p.x - cx) * d.y - (p.y - cy) * d.x));
  return { c: { x: cx, y: cy }, d, dev };
}

/** Fit an open run as straight pieces and curves: maximal stretches that
 *  lie on a line (at least minStraight long) become exact lines, the rest is
 *  fitted with cubics whose ends continue the neighbouring lines' direction
 *  (no kink where a serif bracket meets a stem). */
function fitMixed(dense: Pt[], tStart: Pt, tEnd: Pt, err2: number, unit: number): Bez[] {
  const n = dense.length;
  // Greedy maximal straight pieces over the dense points.
  const pieces: { a: number; b: number; straight: boolean }[] = [];
  let i = 0, curveFrom = 0;
  // A gentle arc also stays within the tolerance of its chord over a short
  // stretch; what tells it from a line is its bow: an arc's middle sits
  // consistently to one side of the ends, a line's residuals are only noise.
  const minPiece = 4 * minStraight;
  const bowed = (a: number, b: number) => bowOf(dense.slice(a, b + 1)) > 0.05 * unit;
  while (i < n - 1) {
    let j = i + 1, best = -1;
    while (j < n) {
      const seg = dense.slice(i, j + 1);
      if (seg.length > 2 && chordDeviation(seg) > lineTol) break;
      if (Math.hypot(dense[j].x - dense[i].x, dense[j].y - dense[i].y) >= minPiece) best = j;
      j++;
    }
    while (best > 0 && bowed(i, best)) {
      best--;
      if (Math.hypot(dense[best].x - dense[i].x, dense[best].y - dense[i].y) < minPiece) best = -1;
    }
    if (best > 0) {
      if (curveFrom < i) pieces.push({ a: curveFrom, b: i, straight: false });
      pieces.push({ a: i, b: best, straight: true });
      i = best;
      curveFrom = best;
    } else {
      i++;
    }
  }
  if (curveFrom < n - 1) pieces.push({ a: curveFrom, b: n - 1, straight: false });

  // Straight pieces lie on their least-squares line (averaging the pixel
  // jitter): their end points are moved onto it, which the neighbouring
  // curves then start from. The run's own ends (corners) stay put and are
  // joined by a short line when off the fitted one.
  const pts = dense.slice();
  const seg = (a: Pt, b: Pt): Bez => [a, add(a, mulp(sub(b, a), 1 / 3)), add(a, mulp(sub(b, a), 2 / 3)), b];
  const head: Bez[] = [], tail: Bez[] = [];
  for (const pc of pieces) {
    if (!pc.straight) continue;
    const ln = lsqLine(dense.slice(pc.a, pc.b + 1));
    const proj = (q: Pt) => add(ln.c, mulp(ln.d, dot(sub(q, ln.c), ln.d)));
    for (const e of [pc.a, pc.b]) {
      const q = proj(dense[e]);
      if (e === 0 || e === n - 1) {
        if (Math.hypot(q.x - dense[e].x, q.y - dense[e].y) > lineTol) (e === 0 ? head : tail).push(e === 0 ? seg(dense[e], q) : seg(q, dense[e]));
        else continue;
      }
      pts[e] = q;
    }
  }
  const out: Bez[] = [...head];
  const dirOf = (pc: { a: number; b: number }) => norm(sub(pts[pc.b], pts[pc.a]));
  pieces.forEach((pc, idx) => {
    const a = pts[pc.a], b = pts[pc.b];
    if (pc.straight) {
      out.push(seg(a, b));
      return;
    }
    const prev = pieces[idx - 1], next = pieces[idx + 1];
    // Continue a neighbouring line's direction only where the curve really
    // leaves it tangentially (a serif bracket); where the outline already
    // turns at the joint (a soft junction), forcing the line's direction
    // makes the curve overshoot into a bump, so the data's own direction
    // is used there.
    const dataDir = (from: number, step: number) => {
      const o = pts[from];
      for (let q = from + step; q >= pc.a && q <= pc.b; q += step) {
        if (Math.hypot(pts[q].x - o.x, pts[q].y - o.y) >= 1.5 * unit) return norm(sub(pts[q], o));
      }
      return norm(sub(pts[step > 0 ? pc.b : pc.a], o));
    };
    const agree = (u: Pt, v: Pt) => dot(u, v) > Math.cos((20 * Math.PI) / 180);
    const d1 = dataDir(pc.a, 1), d2 = dataDir(pc.b, -1);
    const t1 = prev?.straight ? (agree(dirOf(prev), d1) ? dirOf(prev) : d1) : tStart;
    const t2 = next?.straight ? (agree(mulp(dirOf(next), -1), d2) ? mulp(dirOf(next), -1) : d2) : tEnd;
    const run = rdp(pts.slice(pc.a, pc.b + 1), 0.15 * unit);
    if (run.length < 2) return;
    fitCubic(run, t1, t2, err2, out);
  });
  out.push(...tail);
  return out;
}

/** Fit one closed loop: corners stay sharp, the rest becomes smooth curves.
 *
 *  Corners are found on the dense contour by the turn between the directions
 *  a fixed arc length before and after each point (so a corner the smoothing
 *  rounded off over a few pixels still reads as one sharp turn), and are
 *  rebuilt as the intersection of the two adjoining edges, which restores a
 *  crisp point instead of a slightly rounded one. */
function fitLoop(loop: Pt[], unit: number, detail: number, softness: number): TraceAnchor[] {
  const n = loop.length;
  if (n < 3) return [];
  // Cumulative arc length around the closed loop.
  const s = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) s[i] = s[i - 1] + Math.hypot(loop[i % n].x - loop[i - 1].x, loop[i % n].y - loop[i - 1].y);
  const total = s[n];
  if (total < 3 * unit) return [];
  /** Point at arc position t (wrapped), linearly interpolated. */
  const at = (t: number): Pt => {
    t = ((t % total) + total) % total;
    let lo = 0, hi = n;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s[mid] <= t) lo = mid; else hi = mid; }
    const a = loop[lo], b = loop[(lo + 1) % n];
    const seg = s[lo + 1] - s[lo] || 1;
    const f = (t - s[lo]) / seg;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  };
  // Measuring arc: longer than the stretch a corner gets rounded over by the
  // edge smoothing (softness = effective blur) and the source's own
  // anti-aliasing (~1 source pixel = unit).
  const L = Math.max(2, 1.5 * softness + 0.75 * unit);
  // Turning angle per point over +-L and +-2L of arc. At a corner nearly all
  // of the turn happens inside +-L, so widening the window adds little; along
  // a curve the turn keeps growing with the window. That concentration, not
  // the angle alone, separates corners (also softened inner corners) from
  // tight curves.
  const angle = (u: Pt, v: Pt) => Math.acos(Math.max(-1, Math.min(1, dot(norm(u), norm(v)))));
  const turn = new Float64Array(n);
  const turn2 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = loop[i];
    turn[i] = angle(sub(p, at(s[i] - L)), sub(at(s[i] + L), p));
    turn2[i] = angle(sub(p, at(s[i] - 2 * L)), sub(at(s[i] + 2 * L), p));
  }
  const DEG = Math.PI / 180;
  const isCorner = (i: number) => turn[i] > 75 * DEG || (turn[i] > 25 * DEG && turn2[i] < turn[i] * 1.35);
  // Corners: strongest turns first, at least L apart.
  const cand: number[] = [];
  for (let i = 0; i < n; i++) if (isCorner(i)) cand.push(i);
  cand.sort((a, b) => turn[b] - turn[a]);
  const corners: number[] = [];
  for (const i of cand) {
    if (corners.every((c) => { const d = Math.abs(s[c] - s[i]); return Math.min(d, total - d) > L; })) corners.push(i);
  }
  corners.sort((a, b) => a - b);

  const tol = Math.max(0.35, unit * (0.45 - 0.2 * detail));
  const err2 = tol * tol;
  const anchors: TraceAnchor[] = [];
  const emit = (beziers: Bez[], startCorner: boolean) => {
    beziers.forEach((bz, i) => {
      if (i === 0) {
        const prev = anchors[anchors.length - 1];
        if (prev && Math.hypot(prev.x - bz[0].x, prev.y - bz[0].y) < 1e-6) prev.cOut = bz[1];
        else anchors.push({ x: bz[0].x, y: bz[0].y, cOut: bz[1], corner: startCorner || undefined });
      } else {
        anchors[anchors.length - 1].cOut = bz[1];
      }
      anchors.push({ x: bz[3].x, y: bz[3].y, cIn: bz[2] });
    });
  };

  if (!corners.length) {
    // Smooth closed curve: fit as an open run whose end tangents match across
    // the seam, then fold the duplicate end anchor into the first one.
    const pts = rdp(loop, 0.15 * unit);
    if (pts.length < 3) return [];
    const run = [...pts, pts[0]];
    const tSeam = norm(sub(pts[1], pts[pts.length - 1]));
    const out: Bez[] = [];
    fitCubic(run, tSeam, mulp(tSeam, -1), err2, out);
    emit(out, false);
    const last = anchors.pop()!;
    anchors[0].cIn = last.cIn;
    return anchors;
  }

  // Each corner: the intersection of the edge coming in (from -3L to -L) and
  // the edge going out (from +L to +3L), when that lies near the contour.
  const gapTo = (k: number, dir: 1 | -1) => {
    // Arc distance to the neighbouring corner in that direction.
    if (corners.length < 2) return total;
    const other = corners[(k + dir + corners.length) % corners.length];
    const d = dir === 1 ? s[other] - s[corners[k]] : s[corners[k]] - s[other];
    return ((d % total) + total) % total || total;
  };
  const info = corners.map((i, k) => {
    const p = loop[i];
    // Edge samples from the straight part of each edge: past this corner's
    // rounding (L) and before the neighbour's (gap - L), at most 3L. On edges
    // too short for that, the edge's midpoint is the one point still on the
    // straight part, so the direction runs from near the corner to it.
    const span = (gap: number): [number, number] => {
      const far = Math.min(3 * L, gap - L);
      if (far - L >= 0.4 * L) return [L, far];
      const mid = gap / 2;
      return [Math.min(L, mid * 0.5), mid];
    };
    const [bn, bf] = span(gapTo(k, -1));
    const [fn, ff] = span(gapTo(k, 1));
    const straight = bf - bn > 0.5 && ff - fn > 0.5;
    const a0 = at(s[i] - bf), a1 = at(s[i] - bn), b0 = at(s[i] + fn), b1 = at(s[i] + ff);
    const dIn = norm(sub(a1, a0)), dOut = norm(sub(b1, b0));
    const cross = dIn.x * dOut.y - dIn.y * dOut.x;
    let point = p;
    if (straight && Math.abs(cross) > 1e-3) {
      const t = ((b0.x - a1.x) * dOut.y - (b0.y - a1.y) * dOut.x) / cross;
      const q = add(a1, mulp(dIn, t));
      const back = dot(sub(b0, q), dOut);
      if (t >= 0 && back >= 0 && Math.hypot(q.x - p.x, q.y - p.y) < 3 * L && Number.isFinite(q.x) && Number.isFinite(q.y)) point = q;
    }
    return { i, point, dIn, dOut };
  });
  // Dense points of each edge between corner k and k+1, minus the L-zones
  // around the corners (their rounding is not edge geometry).
  const runs: Pt[][] = info.map((c, k) => {
    const next = info[(k + 1) % info.length];
    const from = s[c.i] + L, to = s[next.i] - L + (next.i <= c.i ? total : 0);
    const mid: Pt[] = [];
    for (let j = (c.i + 1) % n, guard = 0; guard < n; j = (j + 1) % n, guard++) {
      const sj = s[j] + (j <= c.i ? total : 0);
      if (j === next.i) break;
      if (sj > from && sj < to) mid.push(loop[j]);
    }
    return mid;
  });
  // Straight edges: a least-squares line through ALL of the edge's points
  // (averaging the pixel jitter), accepted when every point lies within the
  // line tolerance of it.
  // The length test is on the whole edge (corner to corner), the run's
  // sample points exclude the rounded ends near the corners.
  const lines = runs.map((mid, k) => {
    if (mid.length < 3) return null;
    const { c: lc, d, dev } = lsqLine(mid);
    const span = Math.hypot(mid[mid.length - 1].x - mid[0].x, mid[mid.length - 1].y - mid[0].y);
    const a = loop[info[k].i], b = loop[info[(k + 1) % info.length].i];
    const edge = Math.hypot(b.x - a.x, b.y - a.y);
    return dev <= lineTol && span >= L && edge >= minStraight && bowOf(mid) <= 0.1 * unit ? { c: lc, d } : null;
  });
  // A corner between two straight edges is exactly their intersection.
  for (let k = 0; k < info.length; k++) {
    const a = lines[(k - 1 + info.length) % info.length], b = lines[k];
    if (!a || !b) continue;
    const cross = a.d.x * b.d.y - a.d.y * b.d.x;
    if (Math.abs(cross) < 0.05) continue;
    const t = ((b.c.x - a.c.x) * b.d.y - (b.c.y - a.c.y) * b.d.x) / cross;
    const q = add(a.c, mulp(a.d, t));
    const p = loop[info[k].i];
    if (Number.isFinite(q.x) && Math.hypot(q.x - p.x, q.y - p.y) < 3 * L) info[k].point = q;
  }
  for (let k = 0; k < info.length; k++) {
    const c = info[k], next = info[(k + 1) % info.length];
    const ln = lines[k];
    if (ln) {
      // Straight edge: an exact line along the fitted edge. A corner point
      // off that line (two corners merged at a narrow tip) is joined by a
      // short connecting line, so the edge itself stays where it really is.
      const seg = (a: Pt, b: Pt): Bez => [a, add(a, mulp(sub(b, a), 1 / 3)), add(a, mulp(sub(b, a), 2 / 3)), b];
      const proj = (q: Pt) => add(ln.c, mulp(ln.d, dot(sub(q, ln.c), ln.d)));
      const a = c.point, b = next.point, pa = proj(a), pb = proj(b);
      const parts: Bez[] = [];
      if (Math.hypot(pa.x - a.x, pa.y - a.y) > lineTol) parts.push(seg(a, pa));
      const from = parts.length ? pa : a;
      const offB = Math.hypot(pb.x - b.x, pb.y - b.y) > lineTol;
      parts.push(seg(from, offB ? pb : b));
      if (offB) parts.push(seg(pb, b));
      emit(parts, true);
      // The joints on the line are corners too.
      for (const q of [pa, pb]) for (const an of anchors) if (Math.hypot(an.x - q.x, an.y - q.y) < 1e-6) an.corner = true;
      continue;
    }
    const mid = runs[k];
    const dense = [c.point, ...mid, next.point].filter((p, idx, arr) => idx === 0 || Math.hypot(p.x - arr[idx - 1].x, p.y - arr[idx - 1].y) > 1e-6);
    if (dense.length < 2) continue;
    emit(fitMixed(dense, c.dOut, mulp(next.dIn, -1), err2, unit), true);
  }
  if (anchors.length < 2) return anchors;
  // The last anchor coincides with the first corner.
  const last = anchors.pop()!;
  anchors[0].cIn = last.cIn;
  anchors[0].corner = true;
  // Interior run boundaries that are corners keep their flag.
  for (const a of anchors) {
    if (info.some((c) => Math.hypot(c.point.x - a.x, c.point.y - a.y) < 1e-6)) a.corner = true;
  }
  return anchors;
}

// --- driver -----------------------------------------------------------------------

/** Trace RGBA pixels into colour layers of Bézier contours. `onProgress`
 *  receives 0..1; `yieldFn` lets a UI breathe between layers. */
export async function traceImage(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  opts: TraceOptions,
  hooks: { onProgress?: (p: number) => void; yieldFn?: () => Promise<void> } = {},
): Promise<TraceResult> {
  const n = width * height;
  const { labels, rgb, meanError } = quantize(data, n, opts);
  if (!rgb.length) return { layers: [], width, height, meanError: 0 };

  const counts = new Array(rgb.length).fill(0);
  for (let i = 0; i < n; i++) if (labels[i] >= 0) counts[labels[i]]++;

  let dropped = -1;
  if (opts.removeBackground) {
    const border = new Array(rgb.length).fill(0);
    let borderTotal = 0;
    const tally = (i: number) => { borderTotal++; if (labels[i] >= 0) border[labels[i]]++; };
    for (let x = 0; x < width; x++) { tally(x); tally((height - 1) * width + x); }
    for (let y = 1; y < height - 1; y++) { tally(y * width); tally(y * width + width - 1); }
    const best = border.indexOf(Math.max(...border));
    if (best >= 0 && border[best] > borderTotal * 0.4 && rgb.length > 1) dropped = best;
  }

  // Bottom (largest) to top.
  const order = rgb.map((_, i) => i).filter((i) => i !== dropped && counts[i] > 0).sort((a, b) => counts[b] - counts[a]);
  // Render pixels per source pixel; below 1 only for images beyond the
  // pixel budget (downsampled).
  const unit = Math.max(0.5, opts.scale);
  lineTol = unit * (0.5 - 0.15 * opts.detail);
  minStraight = 4 * unit;
  // Light smoothing only: the upsampled render already has smooth edges, and
  // more blur erodes strokes of 1-2 source pixels below the 50% level. The
  // curve fitting provides the smoothness.
  const sigma = unit * (0.35 - 0.25 * opts.detail);
  const minArea = unit * unit * (2.5 - 2 * opts.detail);
  const field = new Float32Array(n);
  const layers: TraceLayer[] = [];
  for (let li = 0; li < order.length; li++) {
    const members = new Set(order.slice(li));
    for (let i = 0; i < n; i++) {
      const l = labels[i];
      field[i] = l >= 0 && members.has(l) ? data[i * 4 + 3] / 255 : 0;
    }
    blur(field, width, height, sigma);
    // Window about 2 source pixels: wide enough to see a thin stroke's peak,
    // narrow enough that a solid shape nearby does not mask it.
    normalizeCoverage(field, width, height, Math.max(1, Math.round(2 * unit)));
    const loops = marchingSquares(field, width, height).filter((lp) => Math.abs(area(lp)) >= minArea);
    const contours = loops.map((lp) => fitLoop(lp, unit, opts.detail, effectiveSigma(sigma))).filter((c) => c.length >= 2);
    if (contours.length) layers.push({ color: rgb[order[li]], contours });
    hooks.onProgress?.((li + 1) / order.length);
    if (hooks.yieldFn) await hooks.yieldFn();
  }
  return { layers, width, height, meanError };
}

/** SVG path data for previews. */
export function contourToPathData(c: TraceAnchor[], k = 1): string {
  if (!c.length) return "";
  const f = (v: number) => (v * k).toFixed(2);
  let d = `M${f(c[0].x)} ${f(c[0].y)}`;
  for (let i = 1; i <= c.length; i++) {
    const a = c[i - 1], b = c[i % c.length];
    if (a.cOut || b.cIn) {
      const c1 = a.cOut ?? a, c2 = b.cIn ?? b;
      d += `C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(b.x)} ${f(b.y)}`;
    } else d += `L${f(b.x)} ${f(b.y)}`;
  }
  return d + "Z";
}
