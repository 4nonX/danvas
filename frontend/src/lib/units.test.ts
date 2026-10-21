import { describe, expect, it } from "vitest";
import { formatLength, fromUnit, measureUnitOf, parseLength, pxPerUnit, toUnit, unitInputText, unitRulerTicks } from "./units";

describe("measurement units", () => {
  it("converts exactly, without rounding the stored value", () => {
    const w = fromUnit(50, "mm", 96);
    expect(w).toBeCloseTo((50 / 25.4) * 96, 12);
    expect(toUnit(w, "mm", 96)).toBeCloseTo(50, 12);
    // What a PDF gets: 50 mm in points.
    expect((w * 72) / 96).toBeCloseTo((50 / 25.4) * 72, 10);
    expect(fromUnit(1, "in", 300)).toBe(300);
    expect(toUnit(96, "pt", 96)).toBe(72);
    expect(fromUnit(2.54, "cm", 96)).toBeCloseTo(96, 12);
    expect(pxPerUnit("px", 300)).toBe(1);
  });

  it("reads the design's unit, px when absent or unknown", () => {
    expect(measureUnitOf({ measureUnit: "mm" })).toBe("mm");
    expect(measureUnitOf({})).toBe("px");
    expect(measureUnitOf({ measureUnit: "furlong" })).toBe("px");
  });

  it("shows values at the unit's precision", () => {
    expect(unitInputText(fromUnit(50, "mm", 96), "mm", 96)).toBe("50");
    expect(unitInputText(fromUnit(1.5, "mm", 96), "mm", 96)).toBe("1.5");
    expect(unitInputText(fromUnit(12.3456, "mm", 96), "mm", 96)).toBe("12.35");
    expect(formatLength(fromUnit(100, "mm", 96), "mm", 96)).toMatch(/^100 mm$/);
  });

  it("parses entries in the design's unit, with another unit named, and relative", () => {
    const cur = fromUnit(50, "mm", 96);
    expect(parseLength("100", "mm", 96, cur)).toBeCloseTo(fromUnit(100, "mm", 96), 12);
    expect(parseLength("1,5", "mm", 96, cur)).toBeCloseTo(fromUnit(1.5, "mm", 96), 12);
    expect(parseLength("2 cm", "mm", 96, cur)).toBeCloseTo(fromUnit(20, "mm", 96), 12);
    expect(parseLength('1"', "mm", 96, cur)).toBeCloseTo(96, 12);
    expect(parseLength("72pt", "mm", 96, cur)).toBeCloseTo(96, 12);
    expect(parseLength("100px", "mm", 96, cur)).toBe(100);
    expect(parseLength("+5", "mm", 96, cur)).toBeCloseTo(fromUnit(55, "mm", 96), 12);
    expect(parseLength("*2", "mm", 96, cur)).toBeCloseTo(fromUnit(100, "mm", 96), 12);
    expect(parseLength("abc", "mm", 96, cur)).toBeNull();
  });

  it("places ruler marks at round values of the unit", () => {
    const { majors, minors } = unitRulerTicks(3, fromUnit(100, "mm", 96), "mm", 96);
    // 60 screen px at zoom 3 is about 5.3 mm: marks every 10 mm.
    expect(majors.map((m) => m.value)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(majors[5].px).toBeCloseTo(fromUnit(50, "mm", 96), 9);
    expect(minors.length).toBeGreaterThan(0);
    expect(unitRulerTicks(1, 1000, "px", 96).majors[1].value).toBe(100);
  });
});
