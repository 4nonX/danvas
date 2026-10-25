import { describe, expect, it } from "vitest";
import type { BrandKit } from "@hc/sdk";
import { colorsFromHexes, draftToPatch, duplicatePatch, emptyDraft, hexToColor, kitToDraft } from "./brandDraft";

function kit(): BrandKit {
  return {
    id: "k1",
    workspaceId: "w1",
    name: "Acme",
    version: 3,
    isDefault: false,
    palettes: [
      { id: "p1", name: "Main", colors: [
        { id: "s1", role: "primary", name: "Acme Red", value: { srgb: { r: 0.9, g: 0.2, b: 0.27, a: 0.5 } } },
        { id: "s2", role: "accent", value: hexToColor("#1d3557") },
      ] },
      { id: "p2", name: "Seasonal", colors: [{ id: "s9", role: "accent", value: hexToColor("#ffcc00") }] },
    ],
    fonts: [
      { id: "f1", role: "heading", fontFamily: "Space Grotesk", defaultStyle: { weight: 700 } },
      { id: "f2", role: "body", fontFamily: "Work Sans" },
      { id: "f3", role: "caption", fontFamily: "IBM Plex Mono" },
    ],
    logos: [{ id: "l1", label: "Mark", assetId: "a1", variants: { dark: "a2" }, minSizePx: 24 }],
    voice: { tone: ["Bold"], doSay: [], dontSay: [], modelProfileId: "mp1" },
    collections: [{ id: "c1", kind: "icons", assetIds: ["a5"] }],
    controls: { lockColors: true, lockFonts: false, restrictTemplates: false, lintPolicy: "warn" },
    createdAt: "",
    updatedAt: "",
  };
}

describe("brand draft", () => {
  it("round-trips a kit without losing what the draft does not edit", () => {
    const k = kit();
    const patch = draftToPatch(kitToDraft(k), k, "Palette");
    // The untouched swatch keeps its name and exact value (alpha included).
    expect(patch.palettes?.[0].colors[0]).toEqual(k.palettes[0].colors[0]);
    // Extra palettes, other font roles, a font's default style, logo
    // variants and the voice's model profile all survive.
    expect(patch.palettes?.[1]).toEqual(k.palettes[1]);
    expect(patch.fonts).toEqual(k.fonts);
    expect(patch.logos).toEqual(k.logos);
    expect(patch.voice?.modelProfileId).toBe("mp1");
    // Collections and controls are never part of an edit patch.
    expect(patch).not.toHaveProperty("collections");
    expect(patch).not.toHaveProperty("controls");
  });

  it("writes edited colors and fonts in place", () => {
    const k = kit();
    const d = kitToDraft(k);
    d.colors[1].hex = "#00ff00";
    d.headingFont = "Fraunces";
    d.bodyFont = "";
    d.accentFont = "Syne";
    const patch = draftToPatch(d, k, "Palette");
    expect(patch.palettes?.[0].colors[1]).toMatchObject({ id: "s2", role: "accent", value: hexToColor("#00ff00") });
    expect(patch.fonts).toEqual([
      { id: "f1", role: "heading", fontFamily: "Fraunces", defaultStyle: { weight: 700 }, fontAssetId: null },
      { id: "f3", role: "caption", fontFamily: "IBM Plex Mono" },
      expect.objectContaining({ role: "accent", fontFamily: "Syne" }),
    ]);
  });

  it("builds a fresh kit's patch from an empty draft plus colors", () => {
    const d = emptyDraft();
    d.name = "  New brand ";
    d.colors = colorsFromHexes(["#AA0000", "#aa0000", "nope", "#00aa00", "#0000aa"]);
    const patch = draftToPatch(d, null, "Palette");
    expect(patch.name).toBe("New brand");
    expect(patch.palettes?.[0].name).toBe("Palette");
    expect(patch.palettes?.[0].colors.map((c) => c.role)).toEqual(["primary", "secondary", "accent"]);
    expect(patch.voice).toBeNull();
    expect(patch.fonts).toEqual([]);
  });

  it("duplicates every array by value", () => {
    const k = kit();
    const p = duplicatePatch(k);
    expect(p.collections).toEqual(k.collections);
    expect(p.collections).not.toBe(k.collections);
    expect(p.controls).toEqual(k.controls);
  });
});
