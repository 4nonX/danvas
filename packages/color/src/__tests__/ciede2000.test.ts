// CIEDE2000 against the reference pairs of Sharma, Wu and Dalal (2005).
import { describe, expect, it } from "vitest";
import { ciede2000 } from "../ciede2000";

const pairs: [number, number, number, number, number, number, number][] = [
  [50, 2.6772, -79.7751, 50, 0, -82.7485, 2.0425],
  [50, 3.1571, -77.2803, 50, 0, -82.7485, 2.8615],
  [50, 2.8361, -74.02, 50, 0, -82.7485, 3.4412],
  [50, -1.3802, -84.2814, 50, 0, -82.7485, 1.0],
  [50, 0, 0, 50, -1, 2, 2.3669],
  [50, 2.49, -0.001, 50, -2.49, 0.0009, 7.1792],
  [50, 2.5, 0, 73, 25, -18, 27.1492],
  [50, 2.5, 0, 50, 3.1736, 0.5854, 1.0],
  [60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644],
  [63.0109, -31.0961, -5.8663, 62.8187, -29.7946, -4.0864, 1.263],
  [22.7233, 20.0904, -46.694, 23.0331, 14.973, -42.5619, 2.0373],
  [90.8027, -2.0831, 1.441, 91.1528, -1.6435, 0.0447, 1.4441],
  [2.0776, 0.0795, -1.135, 0.9033, -0.0636, -0.5514, 0.9082],
];

describe("CIEDE2000", () => {
  it("matches the published reference pairs", () => {
    for (const [l1, a1, b1, l2, a2, b2, want] of pairs) {
      expect(ciede2000({ l: l1, a: a1, b: b1 }, { l: l2, a: a2, b: b2 })).toBeCloseTo(want, 3);
    }
  });

  it("is zero for the same colour and symmetric", () => {
    const x = { l: 54.29, a: 80.8, b: 69.9 }, y = { l: 60, a: 70, b: 50 };
    expect(ciede2000(x, x)).toBe(0);
    expect(ciede2000(x, y)).toBeCloseTo(ciede2000(y, x), 10);
  });
});
