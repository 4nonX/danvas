import { describe, expect, it } from "vitest";
import { actOn } from "./selection";

describe("actOn", () => {
  it("takes the whole selection when the item is part of it", () => {
    expect(actOn("a", new Set(["a", "b", "c"]))).toEqual(["a", "b", "c"]);
  });
  it("takes the item alone when it is not selected", () => {
    expect(actOn("x", new Set(["a", "b"]))).toEqual(["x"]);
  });
  it("takes the item alone when nothing else is selected", () => {
    expect(actOn("a", new Set(["a"]))).toEqual(["a"]);
    expect(actOn("a", new Set())).toEqual(["a"]);
  });
});
