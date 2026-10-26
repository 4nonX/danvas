// Reflectance spectra to Lab (D50, 2°): against values computed independently
// with colour-science's ASTM E308 tristimulus integration for the same
// spectra, and the grid checks.
import { describe, expect, it } from "vitest";
import { D50_WHITE, spectrumCovers, spectrumToLab } from "./spectral";

const cases: Record<string, { r: number[]; lab: number[] }> = {
  white: { r: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], lab: [100, 0, 0] },
  grey50: { r: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], lab: [76.0693, 0, 0] },
  red: { r: [0.05, 0.05, 0.05, 0.05, 0.05, 0.050001, 0.050001, 0.050003, 0.050007, 0.050017, 0.050039, 0.050089, 0.050204, 0.05047, 0.05108, 0.052482, 0.055689, 0.062977, 0.079278, 0.114479, 0.185039, 0.3075, 0.475, 0.6425, 0.764961, 0.835521, 0.870722, 0.887023, 0.894311, 0.897518, 0.89892, 0.89953, 0.899796, 0.899911, 0.899961, 0.899983], lab: [53.8617, 64.0283, 46.6509] },
  blue: { r: [0.052592, 0.060989, 0.087306, 0.151408, 0.270728, 0.434708, 0.586904, 0.65, 0.586904, 0.434708, 0.270728, 0.151408, 0.087306, 0.060989, 0.052592, 0.05049, 0.050074, 0.050009, 0.050001, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05], lab: [30.7168, 39.9938, -73.4589] },
  green: { r: [0.04, 0.04, 0.040001, 0.040004, 0.040026, 0.040142, 0.040672, 0.042692, 0.049158, 0.066465, 0.104961, 0.175434, 0.279826, 0.400711, 0.500805, 0.54, 0.500805, 0.400711, 0.279826, 0.175434, 0.104961, 0.066465, 0.049158, 0.042692, 0.040672, 0.040142, 0.040026, 0.040004, 0.040001, 0.04, 0.04, 0.04, 0.04, 0.04, 0.04, 0.04], lab: [57.937, -74.811, 41.3019] },
};

describe("spectrum to Lab", () => {
  it("matches the reference values", () => {
    for (const [name, c] of Object.entries(cases)) {
      const lab = spectrumToLab(380, 10, c.r)!;
      for (let k = 0; k < 3; k++) expect(lab[k], `${name}[${k}]`).toBeCloseTo(c.lab[k], 3);
    }
  });

  it("has the D50 white", () => {
    expect(D50_WHITE.map((v) => Math.round(v * 100) / 100)).toEqual([96.42, 100, 82.51]);
  });

  it("reads percent values, wider ranges and finer steps; refuses a short range", () => {
    const grey = cases.grey50;
    expect(spectrumToLab(380, 10, grey.r.map((v) => v * 100))![0]).toBeCloseTo(grey.lab[0], 3);
    // 360..780 in 5 nm steps: read at every 10 nm from 380.
    const fine = Array.from({ length: 85 }, (_, i) => (360 + i * 5 >= 380 && 360 + i * 5 <= 730 ? cases.red.r[(360 + i * 5 - 380) / 10] ?? 0.5 : 0.5));
    expect(spectrumToLab(360, 5, fine)![1]).toBeCloseTo(cases.red.lab[1], 1);
    expect(spectrumCovers(400, 10, 31)).toBe(false);
    expect(spectrumToLab(400, 10, Array(31).fill(0.5))).toBeNull();
    expect(spectrumToLab(380, 20, Array(18).fill(0.5))).toBeNull();
  });
});
