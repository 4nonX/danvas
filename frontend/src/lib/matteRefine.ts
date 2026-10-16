// Edge refinement for a background-removal matte (fast guided filter, He et
// al.): the segmentation model works on a 1024 x 1024 copy of the photo, so
// on a large photo its matte arrives scaled up and the edge is soft. The
// filter fits the matte to the photo's own edges: within each window the
// matte becomes a linear function of the photo's brightness, so where the
// photo has a crisp edge, the matte gets one too.
//
// The coefficients are computed at about the model's resolution and applied
// at full size, so the cost stays close to one pass over the photo.

export interface RefineOptions {
  /** Window radius at the working (reduced) resolution. */
  radius?: number;
  /** Regularization: larger keeps more of the model's matte. */
  eps?: number;
  /** Long side of the working resolution. */
  workingSize?: number;
}

/** Mean over a (2r+1)^2 window, edges handled by counting what is inside. */
function boxFilter(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  // Horizontal running sums.
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) sum += src[row + x];
    for (let x = 0; x < w; x++) {
      const lo = Math.max(0, x - r), hi = Math.min(w - 1, x + r);
      tmp[row + x] = sum / (hi - lo + 1);
      const add = x + r + 1, drop = x - r;
      if (add < w) sum += src[row + add];
      if (drop >= 0) sum -= src[row + drop];
    }
  }
  // Vertical running sums.
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y <= Math.min(r, h - 1); y++) sum += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      const lo = Math.max(0, y - r), hi = Math.min(h - 1, y + r);
      out[y * w + x] = sum / (hi - lo + 1);
      const add = y + r + 1, drop = y - r;
      if (add < h) sum += tmp[add * w + x];
      if (drop >= 0) sum -= tmp[drop * w + x];
    }
  }
  return out;
}

/**
 * Refine `alpha` (one byte per pixel, 0..255) against the photo `rgba` (four
 * bytes per pixel), both `w` x `h`. Returns the refined alpha, one byte per
 * pixel.
 */
export function refineMatte(rgba: Uint8ClampedArray, alpha: Uint8ClampedArray, w: number, h: number, opts: RefineOptions = {}): Uint8ClampedArray {
  const radius = opts.radius ?? 4;
  const eps = opts.eps ?? 1e-3;
  const s = Math.max(1, Math.floor(Math.max(w, h) / (opts.workingSize ?? 1024)));
  const lw = Math.ceil(w / s), lh = Math.ceil(h / s);
  const gray = (i: number) => (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) / 255;

  // The photo's brightness and the matte at the working resolution (block
  // averages).
  const I = new Float32Array(lw * lh);
  const P = new Float32Array(lw * lh);
  for (let ly = 0; ly < lh; ly++) {
    for (let lx = 0; lx < lw; lx++) {
      let si = 0, sp = 0, n = 0;
      for (let y = ly * s; y < Math.min(h, (ly + 1) * s); y++) {
        for (let x = lx * s; x < Math.min(w, (lx + 1) * s); x++) {
          const i = y * w + x;
          si += gray(i);
          sp += alpha[i] / 255;
          n++;
        }
      }
      I[ly * lw + lx] = si / n;
      P[ly * lw + lx] = sp / n;
    }
  }
  const II = new Float32Array(lw * lh);
  const IP = new Float32Array(lw * lh);
  for (let i = 0; i < I.length; i++) { II[i] = I[i] * I[i]; IP[i] = I[i] * P[i]; }
  const mI = boxFilter(I, lw, lh, radius);
  const mP = boxFilter(P, lw, lh, radius);
  const mII = boxFilter(II, lw, lh, radius);
  const mIP = boxFilter(IP, lw, lh, radius);
  const A = new Float32Array(lw * lh);
  const B = new Float32Array(lw * lh);
  for (let i = 0; i < A.length; i++) {
    const varI = mII[i] - mI[i] * mI[i];
    const cov = mIP[i] - mI[i] * mP[i];
    A[i] = cov / (varI + eps);
    B[i] = mP[i] - A[i] * mI[i];
  }
  const mA = boxFilter(A, lw, lh, radius);
  const mB = boxFilter(B, lw, lh, radius);

  // Full size: the coefficients sampled bilinearly, applied to the photo.
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(lh - 1, Math.max(0, (y + 0.5) / s - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(lh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(lw - 1, Math.max(0, (x + 0.5) / s - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(lw - 1, x0 + 1), tx = fx - x0;
      const i00 = y0 * lw + x0, i01 = y0 * lw + x1, i10 = y1 * lw + x0, i11 = y1 * lw + x1;
      const a = (mA[i00] * (1 - tx) + mA[i01] * tx) * (1 - ty) + (mA[i10] * (1 - tx) + mA[i11] * tx) * ty;
      const b = (mB[i00] * (1 - tx) + mB[i01] * tx) * (1 - ty) + (mB[i10] * (1 - tx) + mB[i11] * tx) * ty;
      const i = y * w + x;
      out[i] = Math.round(Math.min(1, Math.max(0, a * gray(i) + b)) * 255);
    }
  }
  return out;
}
