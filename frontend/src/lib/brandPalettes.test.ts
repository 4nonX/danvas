// A brand's palettes: add, rename, reorder, delete; a new colour into the
// chosen palette; a colour moved between palettes keeps its values.
import { describe, expect, it } from "vitest";
import type { BrandPalette } from "@hc/sdk";
import { addColor, addPalette, deletePalette, moveColor, movePalette, renamePalette } from "./brandPalettes";

const red = { srgb: { r: 1, g: 0, b: 0, a: 1 } };
const pals = (): BrandPalette[] => [
  { id: "p1", name: "Dachmarke", colors: [{ id: "s1", role: "primary", value: red, pantone: "PANTONE 485 C" }] },
  { id: "p2", name: "Website", colors: [] },
];

describe("brand palettes", () => {
  it("adds, renames, reorders and deletes palettes", () => {
    const { palettes, id } = addPalette(pals(), "  Funktionsfarben ");
    expect(palettes.map((p) => p.name)).toEqual(["Dachmarke", "Website", "Funktionsfarben"]);
    expect(renamePalette(palettes, id, "Funktion").at(-1)!.name).toBe("Funktion");
    expect(movePalette(palettes, id, -1).map((p) => p.id)).toEqual(["p1", id, "p2"]);
    expect(movePalette(palettes, "p1", -1).map((p) => p.id)).toEqual(["p1", "p2", id]); // already first
    expect(deletePalette(palettes, "p1").map((p) => p.id)).toEqual(["p2", id]);
  });

  it("adds a colour to the chosen palette, the first when none is chosen, a new one when there is none", () => {
    expect(addColor(pals(), "p2", { role: "accent", value: red }, "Palette")[1].colors).toHaveLength(1);
    expect(addColor(pals(), "gone", { role: "accent", value: red }, "Palette")[0].colors).toHaveLength(2);
    const fresh = addColor([], null, { role: "accent", value: red }, "Palette");
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({ name: "Palette", colors: [{ role: "accent" }] });
  });

  it("moves a colour with all its values, and leaves the list alone for a wrong target", () => {
    const moved = moveColor(pals(), "s1", "p2");
    expect(moved[0].colors).toEqual([]);
    expect(moved[1].colors).toEqual([{ id: "s1", role: "primary", value: red, pantone: "PANTONE 485 C" }]);
    expect(moveColor(pals(), "s1", "nope")).toEqual(pals());
    expect(moveColor(pals(), "s1", "p1")).toEqual(pals());
  });
});
