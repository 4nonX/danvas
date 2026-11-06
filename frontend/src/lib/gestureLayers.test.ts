// While something is dragged, the page splits into what lies below the moving
// elements, the moving elements, and what lies above; the stacking stays exact.
import { describe, expect, it } from "vitest";
import { gestureLayers } from "./useEditorCanvas";

const page = (...ids: (string | { id: string; blendMode?: string; children?: unknown[] })[]) => ({
  pages: [{ children: ids.map((x) => (typeof x === "string" ? { id: x } : x)) }],
});
const self = (id: string) => id;

describe("gestureLayers", () => {
  it("splits around the moving element", () => {
    expect(gestureLayers(page("a", "b", "c", "d"), 0, ["c"], self)).toMatchObject({ below: ["a", "b"], moving: ["c"], above: ["d"] });
  });

  it("redraws everything between two moving elements, so their order with it stays", () => {
    expect(gestureLayers(page("a", "b", "c", "d", "e"), 0, ["b", "d"], self)).toMatchObject({ below: ["a"], moving: ["b", "c", "d"], above: ["e"] });
  });

  it("moves a child with its top-level group", () => {
    const top = (id: string) => (id === "child" ? "g" : id);
    expect(gestureLayers(page("a", "g", "b"), 0, ["child"], top)).toMatchObject({ below: ["a"], moving: ["g"], above: ["b"] });
  });

  it("draws live from the first element above that blends", () => {
    const doc = page("a", "m", "b", { id: "x", blendMode: "multiply" }, "c");
    expect(gestureLayers(doc, 0, ["m"], self)).toMatchObject({ below: ["a"], moving: ["m", "b", "x", "c"], above: [] });
    const nested = page("m", { id: "g", children: [{ id: "k", blendMode: "screen" }] });
    expect(gestureLayers(nested, 0, ["m"], self)).toMatchObject({ moving: ["m", "g"], above: [] });
  });

  it("keeps the stored pictures only while the split is the same", () => {
    const one = gestureLayers(page("a", "b", "c"), 0, ["b"], self)!;
    const same = gestureLayers(page("a", "b", "c"), 0, ["b"], self)!;
    const other = gestureLayers(page("a", "b", "c"), 0, ["a"], self)!;
    expect(one.key).toBe(same.key);
    expect(one.key).not.toBe(other.key);
  });

  it("gives no split when nothing is selected or the selection is on another page", () => {
    expect(gestureLayers(page("a"), 0, [], self)).toBeNull();
    expect(gestureLayers(page("a"), 0, ["zz"], self)).toBeNull();
  });
});
