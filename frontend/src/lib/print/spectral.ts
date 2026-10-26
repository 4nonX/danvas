// Reflectance spectra to CIE L*a*b* (D50, 2° observer), for colour libraries
// that give measured spectra instead of Lab (CxF, CGATS): the way the
// measuring software turns them into Lab, after ASTM E308.

// CIE 1931 2° observer x CIE D50, 380 to 730 nm in 10 nm steps: the
// tristimulus weighting factors after ASTM E308 / E2022 (360-370 nm folded into
// 380, 740-780 into 730, as for measured data that stops there), normalised to
// Y = 100 for a perfect white. Computed with colour-science 0.4.7 from the CIE
// tables; on the HLC Colour Atlas XL spectra they reproduce the Lab values its
// publisher gives to dE00 0.006 on average.
export const E308_D50_2_10NM: readonly (readonly [number, number, number])[] = [
  [0.003892, 0.000114, 0.018294],
  [0.012118, 0.000346, 0.057203],
  [0.059862, 0.001651, 0.283485],
  [0.233232, 0.006224, 1.110299],
  [0.774686, 0.022826, 3.721770],
  [1.618554, 0.066361, 7.901301],
  [2.451273, 0.162257, 12.300855],
  [2.771829, 0.312734, 14.618424],
  [2.498348, 0.514026, 14.338157],
  [1.717892, 0.798433, 11.303614],
  [0.860089, 1.238374, 7.301653],
  [0.283148, 1.841030, 4.131877],
  [0.039930, 2.947306, 2.465721],
  [0.088312, 4.632491, 1.446552],
  [0.593661, 6.590980, 0.736976],
  [1.588888, 8.301610, 0.400571],
  [2.800204, 9.199347, 0.196486],
  [4.204161, 9.645051, 0.084693],
  [5.657281, 9.471756, 0.036789],
  [7.134974, 8.905412, 0.019675],
  [8.533077, 8.105119, 0.014916],
  [9.269222, 6.838801, 0.010427],
  [9.833305, 5.836726, 0.007343],
  [9.464323, 4.751127, 0.003545],
  [8.006265, 3.571844, 0.001589],
  [5.932100, 2.445749, 0.000504],
  [4.168357, 1.628194, 0.000164],
  [2.611285, 0.985059, 0.000021],
  [1.541401, 0.569984, -0.000004],
  [0.853669, 0.312435, 0.000000],
  [0.433239, 0.157447, 0.000000],
  [0.194370, 0.070276, 0.000000],
  [0.096934, 0.034998, 0.000000],
  [0.049977, 0.018046, 0.000000],
  [0.022147, 0.007998, 0.000000],
  [0.021788, 0.007868, 0.000000],
];

const START = 380;
const STEP = 10;
const COUNT = E308_D50_2_10NM.length; // 380..730

/** The D50 white the weights add up to (X, Y = 100, Z). */
export const D50_WHITE: readonly [number, number, number] = [0, 1, 2].map((k) => E308_D50_2_10NM.reduce((s, w) => s + w[k], 0)) as unknown as [number, number, number];

/** Whether a spectrum from `startNm` in steps of `stepNm` with `count` values
 *  covers 380 to 730 nm on a grid that meets every 10 nm. */
export function spectrumCovers(startNm: number, stepNm: number, count: number): boolean {
  if (!(stepNm > 0) || STEP % stepNm !== 0 || (START - startNm) % stepNm !== 0) return false;
  return startNm <= START && startNm + stepNm * (count - 1) >= START + STEP * (COUNT - 1);
}

/** Lab (D50, 2°) of a reflectance spectrum (values 0..1, or 0..100 when any
 *  value is above 1.5) starting at `startNm` in steps of `stepNm`. Finer
 *  steps (5, 1 nm) are read at every 10 nm. Null when it does not cover 380
 *  to 730 nm. */
export function spectrumToLab(startNm: number, stepNm: number, values: readonly number[]): [number, number, number] | null {
  if (!spectrumCovers(startNm, stepNm, values.length) || values.some((v) => !Number.isFinite(v))) return null;
  const scale = values.some((v) => v > 1.5) ? 0.01 : 1;
  const xyz = [0, 0, 0];
  for (let i = 0; i < COUNT; i++) {
    const r = values[(START + i * STEP - startNm) / stepNm] * scale;
    for (let k = 0; k < 3; k++) xyz[k] += r * E308_D50_2_10NM[i][k];
  }
  return xyzToLab(xyz[0], xyz[1], xyz[2]);
}

/** CIE XYZ (Y = 100 for white) to L*a*b* against the D50 white. */
export function xyzToLab(x: number, y: number, z: number): [number, number, number] {
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x / D50_WHITE[0]), fy = f(y / D50_WHITE[1]), fz = f(z / D50_WHITE[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
