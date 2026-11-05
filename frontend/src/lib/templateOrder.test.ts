import { describe, expect, it } from "vitest";
import { moveTemplate, normalizeTemplateOrder, sortTemplates, templateOrderKey } from "./templateOrder";

const list = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (l: { id: string }[]) => l.map((t) => t.id);

describe("template order", () => {
  it("keeps the server's order until the person arranges something", () => {
    expect(ids(sortTemplates(list("c", "a", "b"), []))).toEqual(["c", "a", "b"]);
  });

  it("sorts by the stored order and puts new templates first", () => {
    expect(ids(sortTemplates(list("new", "a", "b", "c"), ["c", "a", "b"]))).toEqual(["new", "c", "a", "b"]);
  });

  it("does not change the list it was given", () => {
    const l = list("a", "b");
    sortTemplates(l, ["b", "a"]);
    expect(ids(l)).toEqual(["a", "b"]);
  });

  it("moves to the place of the template dropped on, forward and back", () => {
    const l = list("a", "b", "c", "d");
    expect(moveTemplate(["a", "b", "c", "d"], l, "a", "c", true)).toEqual(["b", "c", "a", "d"]);
    expect(moveTemplate(["a", "b", "c", "d"], l, "d", "b", true)).toEqual(["a", "d", "b", "c"]);
  });

  it("reaches the last and the first place", () => {
    const l = list("a", "b", "c");
    expect(moveTemplate(["a", "b", "c"], l, "a", "c", true)).toEqual(["b", "c", "a"]);
    expect(moveTemplate(["a", "b", "c"], l, "c", "a", true)).toEqual(["c", "a", "b"]);
  });

  it("places what was not placed yet where it is shown, before the first move's result", () => {
    expect(moveTemplate([], list("a", "b", "c"), "a", "b", true)).toEqual(["b", "a", "c"]);
    expect(moveTemplate(["a", "b"], list("new", "a", "b"), "b", "a", true)).toEqual(["new", "b", "a"]);
  });

  it("drops templates that are gone only when the whole list is loaded", () => {
    expect(moveTemplate(["gone", "a", "b"], list("a", "b"), "a", "b", true)).toEqual(["b", "a"]);
    // A collection shows part of the templates: the others keep their places.
    expect(moveTemplate(["x", "a", "y", "b"], list("a", "b"), "a", "b", false)).toEqual(["x", "y", "b", "a"]);
  });

  it("ignores a move onto itself or onto something unknown", () => {
    expect(moveTemplate(["a", "b"], list("a", "b"), "a", "a", true)).toEqual(["a", "b"]);
    expect(moveTemplate(["a", "b"], list("a", "b"), "a", "zz", true)).toEqual(["a", "b"]);
  });

  it("stays within the size of a preference, and takes only clean stored values", () => {
    const many = Array.from({ length: 900 }, (_, i) => `id-${i}`);
    const moved = moveTemplate(many, list(...many), "id-0", "id-1", true);
    expect(moved.length).toBe(700);
    expect(JSON.stringify(moved.map(() => "00000000-0000-4000-8000-000000000000")).length).toBeLessThan(32 << 10);
    expect(normalizeTemplateOrder(["a", 1, "a", null, "b"])).toEqual(["a", "b"]);
    expect(normalizeTemplateOrder({ not: "a list" })).toEqual([]);
  });

  it("uses a preference key the server accepts, one per workspace", () => {
    const key = templateOrderKey("0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(key).toMatch(/^[a-z][A-Za-z0-9._-]{0,63}$/);
    expect(key).not.toBe(templateOrderKey("another"));
  });
});
