// The proof view's arithmetic, on a page rendered and converted to CMYK
// (interleaved bytes, 0..255 = 0..100 % ink): single plates, total area
// coverage (TAC, the sum of the four inks) against the print shop's limit,
// and colours the press cannot reach. Pure functions on typed arrays, so
// they run anywhere and are tested without a browser.

/** The process plates, in their order in the CMYK bytes. */
export const PLATES = ["c", "m", "y", "k"] as const;
export type Plate = (typeof PLATES)[number];

/** How each plate is tinted when shown in colour. */
const TINT: Record<Plate, [number, number, number]> = { c: [0, 174, 239], m: [236, 0, 140], y: [255, 242, 0], k: [35, 31, 32] };

/** Common TAC limits: coated papers allow more ink than uncoated ones. */
export function defaultTacLimit(profileName: string | undefined): number {
  const n = (profileName ?? "").toLowerCase();
  if (/uncoated|ungestrichen|newspaper|zeitung|snp|fogra47|fogra52/.test(n)) return 300;
  if (/coated|gestrichen|fogra39|fogra51/.test(n)) return 330;
  return 300;
}

/**
 * The black-only rule of the vector print files: pure black (what the
 * export writes as K 100 % alone) on its own plate. Applied to the pixels
 * that are pure black in the render, which is what the vector formats do
 * for shapes and text; images in them go through the profile like every
 * other pixel, so this is the preview's approximation (the output check
 * looks at the real file).
 */
export function applyBlackOnly(rgba: Uint8Array | Uint8ClampedArray, cmyk: Uint8Array): void {
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 4) {
    if (rgba[i + 3] >= 250 && rgba[i] <= 1 && rgba[i + 1] <= 1 && rgba[i + 2] <= 1) {
      cmyk[j] = 0; cmyk[j + 1] = 0; cmyk[j + 2] = 0; cmyk[j + 3] = 255;
    }
  }
}

/** The ink of one pixel, in per cent per plate. */
export function inkAt(cmyk: Uint8Array, pixel: number): { c: number; m: number; y: number; k: number; total: number } {
  const j = pixel * 4;
  const pct = (v: number) => Math.round((v / 255) * 100);
  const c = pct(cmyk[j]), m = pct(cmyk[j + 1]), y = pct(cmyk[j + 2]), k = pct(cmyk[j + 3]);
  return { c, m, y, k, total: c + m + y + k };
}

export interface TacStats {
  /** The highest total coverage, per cent. */
  maxPct: number;
  /** Share of the inked area above the limit, per cent. */
  overPct: number;
  /** Pixels above the limit (1) or not (0). */
  over: Uint8Array;
}

/** Total area coverage against `limitPct`. */
export function tacStats(cmyk: Uint8Array, limitPct: number): TacStats {
  const n = cmyk.length / 4;
  const over = new Uint8Array(n);
  const limit = (limitPct / 100) * 255;
  let max = 0, inked = 0, above = 0;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const sum = cmyk[j] + cmyk[j + 1] + cmyk[j + 2] + cmyk[j + 3];
    if (sum > max) max = sum;
    if (sum > 0) inked++;
    // Strictly above, with half a step of tolerance for rounding.
    if (sum > limit + 0.5) { over[i] = 1; above++; }
  }
  return { maxPct: Math.round((max / 255) * 100), overPct: inked ? Math.round((above / inked) * 1000) / 10 : 0, over };
}

/** One plate as an image: its ink as grey (or in its colour), paper white
 *  where it prints nothing. */
export function plateImage(cmyk: Uint8Array, plate: Plate, tinted: boolean): Uint8ClampedArray {
  const n = cmyk.length / 4;
  const off = PLATES.indexOf(plate);
  const out = new Uint8ClampedArray(n * 4);
  const [tr, tg, tb] = tinted ? TINT[plate] : [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const a = cmyk[i * 4 + off] / 255;
    const j = i * 4;
    out[j] = 255 - (255 - tr) * a;
    out[j + 1] = 255 - (255 - tg) * a;
    out[j + 2] = 255 - (255 - tb) * a;
    out[j + 3] = 255;
  }
  return out;
}

/** A spot-colour plate from a mask (alpha of a drawing of it). */
export function maskPlate(alpha: Uint8ClampedArray, tint: [number, number, number]): Uint8ClampedArray {
  const n = alpha.length / 4;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const a = alpha[i * 4 + 3] / 255;
    const j = i * 4;
    out[j] = 255 - (255 - tint[0]) * a;
    out[j + 1] = 255 - (255 - tint[1]) * a;
    out[j + 2] = 255 - (255 - tint[2]) * a;
    out[j + 3] = 255;
  }
  return out;
}

/** The proof dimmed, with what exceeds the limit (or falls outside the
 *  press gamut) in a signal colour. */
export function highlight(proof: Uint8ClampedArray, mask: Uint8Array, color: [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(proof.length);
  for (let i = 0; i < mask.length; i++) {
    const j = i * 4;
    if (mask[i]) {
      out[j] = color[0]; out[j + 1] = color[1]; out[j + 2] = color[2];
    } else {
      // Greyed, so the marked areas stand out.
      const g = (proof[j] * 0.3 + proof[j + 1] * 0.59 + proof[j + 2] * 0.11) * 0.5 + 127;
      out[j] = g; out[j + 1] = g; out[j + 2] = g;
    }
    out[j + 3] = 255;
  }
  return out;
}

// sRGB (0..255) to CIE Lab (D65), for the colour difference.
function lab(r: number, g: number, b: number): [number, number, number] {
  const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Pixels whose printed colour differs visibly from the design's (CIE76
 *  above `deltaE`): what the press cannot reach. Compares the design with
 *  its relative soft proof, so paper white is not counted. */
export function gamutMask(design: Uint8Array | Uint8ClampedArray, proof: Uint8ClampedArray, deltaE = 6): Uint8Array {
  const n = proof.length / 4;
  const out = new Uint8Array(n);
  const cache = new Map<number, boolean>();
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    if (design[j + 3] < 128) continue;
    const key = design[j] * 65536 + design[j + 1] * 256 + design[j + 2] + (proof[j] * 65536 + proof[j + 1] * 256 + proof[j + 2]) * 16777216;
    let bad = cache.get(key);
    if (bad === undefined) {
      const a = lab(design[j], design[j + 1], design[j + 2]);
      const b = lab(proof[j], proof[j + 1], proof[j + 2]);
      bad = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > deltaE;
      if (cache.size < 200000) cache.set(key, bad);
    }
    if (bad) out[i] = 1;
  }
  return out;
}
