// Logo versions (F50): logos from before keep their files, and a logo's main
// and dark file always follow its versions.
import { describe, expect, it } from "vitest";
import type { BrandLogo, BrandLogoVersion } from "@hc/sdk";
import { LEGACY_VERSIONS, kitVersions, logoFiles, newLogo, relinkLogos, versionsDropFiles, withVersionFile } from "./logoVersions";

const ours: BrandLogoVersion[] = [
  { id: "colour", name: "Farbe", ground: "light" },
  { id: "black", name: "Schwarz", ground: "light" },
  { id: "white", name: "Weiß", ground: "dark" },
];
const old: BrandLogo = { id: "l1", label: "Wortmarke", assetId: "a-main", variants: { dark: "a-dark" }, clearSpaceRatio: 0.2 };
const files = (l: BrandLogo, vs: BrandLogoVersion[]) => Object.fromEntries(logoFiles(l, vs).map((f) => [f.version.id, f.assetId ?? null]));

describe("logo versions", () => {
  it("shows a kit without named versions as the logo and its dark version", () => {
    expect(kitVersions({})).toBe(LEGACY_VERSIONS);
    expect(files(old, LEGACY_VERSIONS)).toEqual({ main: "a-main", dark: "a-dark" });
  });

  it("reads a logo from before in the first light and the first dark version", () => {
    expect(files(old, ours)).toEqual({ colour: "a-main", black: null, white: "a-dark" });
  });

  it("keeps the main and the dark file in step with the versions", () => {
    let l = withVersionFile(old, ours, "black", "a-black")!;
    expect(l.versions).toEqual({ colour: "a-main", black: "a-black", white: "a-dark" });
    expect([l.assetId, l.variants?.dark, l.clearSpaceRatio]).toEqual(["a-main", "a-dark", 0.2]);
    l = withVersionFile(l, ours, "colour", null)!;
    expect(l.assetId).toBe("a-black"); // the next light version is the main file
    l = withVersionFile(l, ours, "white", null)!;
    expect(l.variants).toBeUndefined();
    expect(withVersionFile(l, ours, "black", null)).toBeNull(); // no file left
  });

  it("starts a logo in any version, a dark one too", () => {
    const l = newLogo("Bildmarke", ours, "white", "a-w");
    expect([l.assetId, l.variants?.dark, l.versions]).toEqual(["a-w", "a-w", { white: "a-w" }]);
  });

  it("moves logos into the versions a kit names for the first time, whatever they were stored as", () => {
    const edited = withVersionFile(old, LEGACY_VERSIONS, "main", "a-main2")!; // stored as {main, dark}
    const out = relinkLogos([old, edited], LEGACY_VERSIONS, ours);
    expect(out.map((l) => l.versions)).toEqual([
      { colour: "a-main", white: "a-dark" },
      { colour: "a-main2", white: "a-dark" },
    ]);
    expect(versionsDropFiles([old], LEGACY_VERSIONS, ours)).toBe(0);
  });

  it("drops only the files of a removed version, and a logo left with none", () => {
    const both = withVersionFile(newLogo("A", ours, "colour", "a1"), ours, "white", "a2")!;
    const onlyWhite = newLogo("B", ours, "white", "b2");
    const fewer = ours.filter((v) => v.id !== "white");
    const out = relinkLogos([both, onlyWhite], ours, fewer);
    expect(out.map((l) => [l.label, l.versions, l.variants?.dark])).toEqual([["A", { colour: "a1" }, undefined]]);
    expect(versionsDropFiles([both, onlyWhite], ours, fewer)).toBe(2);
  });

  it("keeps the files when versions are renamed or reordered", () => {
    const l = withVersionFile(newLogo("A", ours, "colour", "a1"), ours, "black", "a3")!;
    const reordered: BrandLogoVersion[] = [{ ...ours[1], name: "Schwarz-Weiß" }, ours[0], ours[2]];
    const [out] = relinkLogos([l], ours, reordered);
    expect(out.versions).toEqual({ colour: "a1", black: "a3" });
    expect(out.assetId).toBe("a3"); // the first light version is now black
  });
});
