// Schema v29: measurement unit. `measureUnit` is an optional key on the file:
// the unit lengths are shown and entered in, while geometry stays in design
// px. It validates as ANY string, so a unit added later never makes this
// client reject a whole file, and the version step rewrites nothing.

import { describe, expect, it } from "vitest";
import { createBlankDesign, currentSchemaVersion, migrate, validate } from "../index";

describe("migration to v29", () => {
  it("pins the exact version pair (see the Go twin in v29_test.go)", () => {
    // The paired EXACT pins are the cross-language drift alarm: a future bump
    // must update this line, the Go pin, and both currentSchemaVersion mirrors
    // in the SAME change (CLAUDE.md bump protocol).
    expect(currentSchemaVersion).toBe(29);
  });

  it("is a pure no-op on a v28 document", () => {
    const before = { ...createBlankDesign(), schemaVersion: 28 } as Record<string, unknown>;
    const after = migrate(structuredClone(before) as never, 29) as unknown as Record<string, unknown>;
    expect(after.schemaVersion).toBe(29);
    expect({ ...after, schemaVersion: 28 }).toEqual(before);
  });
});

describe("v29 measurement unit", () => {
  it("accepts a file without it, the shape every existing design has", () => {
    expect(validate(createBlankDesign()).ok).toBe(true);
    expect("measureUnit" in createBlankDesign()).toBe(false);
  });

  it("accepts any unit, one added later included, and keeps the geometry as given", () => {
    for (const measureUnit of ["mm", "cm", "in", "pt", "px", "some-future-unit"]) {
      const d = createBlankDesign({ width: (50 / 25.4) * 96, height: (100 / 25.4) * 96, measureUnit });
      expect(validate(d).ok).toBe(true);
      expect(d.pages[0].width).toBeCloseTo(188.976377952756, 9);
    }
  });

  it("is only written when it is not px", () => {
    expect(createBlankDesign({ measureUnit: "mm" }).measureUnit).toBe("mm");
    expect("measureUnit" in createBlankDesign({ measureUnit: "px" })).toBe(false);
  });
});
