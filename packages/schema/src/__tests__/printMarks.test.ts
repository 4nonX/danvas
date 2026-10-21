// Schema v28: print marks. `printMarks` is an optional key on a page and
// `bleed` (design px) gets a defined unit. What is worth testing is the
// contract that keeps files openable: the style validates as ANY string, so a
// style added later never makes this client reject a whole file, and the
// version step rewrites nothing.

import { describe, expect, it } from "vitest";
import { createBlankDesign, migrate, PageSchema, validate } from "../index";

describe("migration to v28", () => {
  it("is a pure no-op on a v27 document", () => {
    const before = { ...createBlankDesign(), schemaVersion: 27 } as Record<string, unknown>;
    const after = migrate(structuredClone(before) as never, 28) as unknown as Record<string, unknown>;
    expect(after.schemaVersion).toBe(28);
    expect({ ...after, schemaVersion: 27 }).toEqual(before);
  });
});

describe("v28 print marks", () => {
  const page = () => structuredClone(createBlankDesign().pages[0]) as unknown as Record<string, unknown>;

  it("accepts a page without bleed or marks, the shape every existing design has", () => {
    expect(PageSchema.safeParse(page()).success).toBe(true);
  });

  it("accepts bleed and marks, any style included", () => {
    for (const style of ["solid", "dashed", "dotted", "some-future-style"]) {
      const p = { ...page(), bleed: 11.34, printMarks: { crop: true, style, weight: 0.25, length: 18.9, offset: 11.34, color: { srgb: { r: 0, g: 0, b: 0, a: 1 } } } };
      expect(PageSchema.safeParse(p).success).toBe(true);
    }
  });

  it("keeps a whole file with marks valid", () => {
    const d = createBlankDesign() as unknown as { pages: Record<string, unknown>[] };
    d.pages[0].bleed = 11.34;
    d.pages[0].printMarks = { crop: true };
    expect(validate(d as never).ok).toBe(true);
  });
});
