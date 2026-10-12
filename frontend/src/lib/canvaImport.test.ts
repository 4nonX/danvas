import { describe, expect, it } from "vitest";
import { toImportPicks } from "./canvaImport";

describe("toImportPicks", () => {
  it("sends each pick's type, id, name and ancestors", () => {
    expect(
      toImportPicks([
        { item: { type: "folder", id: "root", name: "" }, ancestors: [] },
        { item: { type: "design", id: "D1", name: "Pitch", pageCount: 3 }, ancestors: ["root", "F1"] },
      ]),
    ).toEqual([
      { type: "folder", id: "root", name: "", ancestors: [] },
      { type: "design", id: "D1", name: "Pitch", ancestors: ["root", "F1"] },
    ]);
  });
});
