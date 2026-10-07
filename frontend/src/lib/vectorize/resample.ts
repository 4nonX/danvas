// High-quality upsampling for tracing. The browser enlarges images
// bilinearly, whose interpolated edges are piecewise straight: contours
// traced from it follow those facets, so straight stems come out wavy.
// Catmull-Rom (bicubic) interpolation on premultiplied RGBA gives smooth,
// accurate edges and keeps the peak of thin strokes. Pure; no DOM.

function cubic(t: number): [number, number, number, number] {
  // Catmull-Rom weights for the 4 taps around a sample at fraction t.
  const t2 = t * t, t3 = t2 * t;
  return [
    -0.5 * t3 + t2 - 0.5 * t,
    1.5 * t3 - 2.5 * t2 + 1,
    -1.5 * t3 + 2 * t2 + 0.5 * t,
    0.5 * t3 - 0.5 * t2,
  ];
}

/** Upsample RGBA by an integer-or-fractional factor (output size rounded). */
export function upsampleBicubic(src: Uint8ClampedArray, w: number, h: number, factor: number): { data: Uint8ClampedArray; width: number; height: number } {
  const W = Math.max(1, Math.round(w * factor)), H = Math.max(1, Math.round(h * factor));
  // Premultiply so transparent pixels' colour does not bleed into edges.
  const pre = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = src[i * 4 + 3] / 255;
    pre[i * 4] = src[i * 4] * a;
    pre[i * 4 + 1] = src[i * 4 + 1] * a;
    pre[i * 4 + 2] = src[i * 4 + 2] * a;
    pre[i * 4 + 3] = src[i * 4 + 3];
  }
  // Separable: horizontal pass into a (W x h) buffer, then vertical.
  const sx = w / W, sy = h / H;
  const tmp = new Float32Array(W * h * 4);
  for (let X = 0; X < W; X++) {
    const fx = (X + 0.5) * sx - 0.5;
    const x0 = Math.floor(fx);
    const wt = cubic(fx - x0);
    for (let y = 0; y < h; y++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < 4; k++) {
        const xi = Math.min(w - 1, Math.max(0, x0 - 1 + k));
        const o = (y * w + xi) * 4;
        r += pre[o] * wt[k]; g += pre[o + 1] * wt[k]; b += pre[o + 2] * wt[k]; a += pre[o + 3] * wt[k];
      }
      const t = (y * W + X) * 4;
      tmp[t] = r; tmp[t + 1] = g; tmp[t + 2] = b; tmp[t + 3] = a;
    }
  }
  const out = new Uint8ClampedArray(W * H * 4);
  for (let Y = 0; Y < H; Y++) {
    const fy = (Y + 0.5) * sy - 0.5;
    const y0 = Math.floor(fy);
    const wt = cubic(fy - y0);
    for (let X = 0; X < W; X++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < 4; k++) {
        const yi = Math.min(h - 1, Math.max(0, y0 - 1 + k));
        const o = (yi * W + X) * 4;
        r += tmp[o] * wt[k]; g += tmp[o + 1] * wt[k]; b += tmp[o + 2] * wt[k]; a += tmp[o + 3] * wt[k];
      }
      const o = (Y * W + X) * 4;
      const A = Math.min(255, Math.max(0, a));
      out[o + 3] = A;
      if (A > 0.5) {
        // Un-premultiply: colour channels were scaled by alpha/255.
        const k = 255 / A;
        out[o] = r * k;
        out[o + 1] = g * k;
        out[o + 2] = b * k;
      }
    }
  }
  return { data: out, width: W, height: H };
}
