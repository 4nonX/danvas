import { describe, expect, it } from "vitest";
import type { BrandCollection } from "@hc/sdk";
import {
  addCategory, addGraphics, categoryName, deleteCategory, graphicName, isGraphicFile, isSvgAsset,
  moveCategory, moveGraphic, removeGraphic, renameCategory, renamedFilename, replaceGraphic,
} from "./brandGraphics";

const base = (): BrandCollection[] => [
  { id: "c-icons", kind: "icons", assetIds: ["a1", "a2"] },
  { id: "c-sil", kind: "graphics", name: "Silhouetten", assetIds: ["s1"] },
];

describe("brand graphics (F50)", () => {
  it("names a category, older collections by their kind", () => {
    const [icons, sil] = base();
    expect(categoryName(sil)).toBe("Silhouetten");
    expect(categoryName(icons)).not.toBe("");
  });

  it("creates, renames, reorders and deletes categories", () => {
    const { collections, id } = addCategory(base(), "  Zeichnungen ");
    expect(collections.at(-1)).toEqual({ id, kind: "graphics", name: "Zeichnungen", assetIds: [] });
    expect(renameCategory(collections, "c-sil", "Pflanzen").find((c) => c.id === "c-sil")?.name).toBe("Pflanzen");
    expect(moveCategory(collections, "c-sil", -1).map((c) => c.id)).toEqual(["c-sil", "c-icons", id]);
    expect(moveCategory(collections, "c-icons", -1)).toBe(collections); // already first
    expect(deleteCategory(collections, "c-icons").map((c) => c.id)).toEqual(["c-sil", id]);
  });

  it("adds graphics once each, removes, moves and replaces them", () => {
    let cols = addGraphics(base(), "c-sil", ["s2", "s1", "s2"]);
    expect(cols[1].assetIds).toEqual(["s1", "s2"]);
    cols = moveGraphic(cols, "c-sil", "c-icons", "s1");
    expect(cols[0].assetIds).toEqual(["a1", "a2", "s1"]);
    expect(cols[1].assetIds).toEqual(["s2"]);
    cols = replaceGraphic(cols, "c-icons", "a2", "a9");
    expect(cols[0].assetIds).toEqual(["a1", "a9", "s1"]); // in place
    expect(removeGraphic(cols, "c-icons", "a1")[0].assetIds).toEqual(["a9", "s1"]);
  });

  it("names graphics after their files and keeps the extension on rename", () => {
    expect(graphicName("Klee - Silhouette schwarz.svg")).toBe("Klee - Silhouette schwarz");
    expect(renamedFilename("Klee.svg", "Rotklee ")).toBe("Rotklee.svg");
    expect(renamedFilename(null, "Ohne")).toBe("Ohne");
  });

  it("tells graphic files and SVGs apart", () => {
    expect(isGraphicFile({ name: "a.svg", type: "" })).toBe(true);
    expect(isGraphicFile({ name: "a.png", type: "image/png" })).toBe(true);
    expect(isGraphicFile({ name: "a.pdf", type: "application/pdf" })).toBe(false);
    expect(isSvgAsset({ mimeType: "image/svg+xml" })).toBe(true);
    expect(isSvgAsset({ mimeType: null, filename: "x.SVG" })).toBe(true);
    expect(isSvgAsset({ mimeType: "image/png", filename: "x.png" })).toBe(false);
  });
});
