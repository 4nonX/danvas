import { describe, expect, it } from "vitest";
import type { DesignFile } from "@hc/schema";
import { normalizeTrimSize, trimMismatch } from "./trimSize";
import { normalizeSettings } from "./exportProfiles";

// A design whose pages are the given sizes in mm, at 96 dpi.
const design = (...sizes: [number, number][]): DesignFile =>
  ({ dpi: 96, pages: sizes.map(([w, h]) => ({ width: (w * 96) / 25.4, height: (h * 96) / 25.4 })) }) as unknown as DesignFile;

describe("trim size (F48)", () => {
  const label = { w: 50, h: 100 };

  it("accepts the size within half a millimetre", () => {
    expect(trimMismatch(design([50, 100]), [0], label)).toBeNull();
    expect(trimMismatch(design([49.96, 100.3]), [0], label)).toBeNull();
  });

  it("names a design of another size", () => {
    expect(trimMismatch(design([90, 40]), [0], label)).toMatchObject({ wMm: 90, hMm: 40, turned: false });
  });

  it("tells a label that only lies the wrong way", () => {
    expect(trimMismatch(design([100, 50]), [0], label)).toMatchObject({ turned: true });
  });

  it("checks every exported page, not the others", () => {
    const d = design([50, 100], [90, 40]);
    expect(trimMismatch(d, [0], label)).toBeNull();
    expect(trimMismatch(d, [0, 1], label)).toMatchObject({ wMm: 90 });
  });

  it("compares the whole-mm size when the export rounds", () => {
    expect(trimMismatch(design([50.6, 100]), [0], label)).not.toBeNull();
    expect(trimMismatch(design([50.6, 100]), [0], { w: 51, h: 100 }, true)).toBeNull();
  });

  it("is kept in a profile, and off when missing or invalid", () => {
    expect(normalizeSettings({ trimSize: { w: 50, h: 100 } }).trimSize).toEqual({ w: 50, h: 100 });
    expect(normalizeSettings({}).trimSize).toBeNull();
    expect(normalizeTrimSize({ w: 0, h: 100 })).toBeNull();
    expect(normalizeTrimSize({ w: "50", h: 100 })).toBeNull();
  });
});
