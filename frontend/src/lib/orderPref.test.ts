// A stored order of known items reads back safely and moves as shown.
import { describe, expect, it } from "vitest";
import { moveBefore, moveBy, normalizeOrder } from "./orderPref";

const RAIL = ["templates", "elements", "text", "ai", "uploads", "stock", "apps", "brand", "layers"];

describe("order preference", () => {
  it("falls back to the built-in order", () => {
    expect(normalizeOrder(undefined, RAIL)).toEqual(RAIL);
    expect(normalizeOrder("x", RAIL)).toEqual(RAIL);
  });

  it("keeps a stored order, drops unknown ids and puts new ones where they belong", () => {
    // "apps" is new since this order was stored; "gone" no longer exists.
    const stored = ["brand", "text", "gone", "templates", "elements", "ai", "uploads", "stock", "layers", "text"];
    expect(normalizeOrder(stored, RAIL)).toEqual(["brand", "text", "templates", "elements", "ai", "uploads", "stock", "apps", "layers"]);
  });

  it("moves before another or to the end, and by one place", () => {
    expect(moveBefore(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveBefore(["a", "b", "c"], "a", null)).toEqual(["b", "c", "a"]);
    const same = ["a", "b"];
    expect(moveBefore(same, "a", "a")).toBe(same);
    expect(moveBy(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveBy(same, "a", -1)).toBe(same);
    expect(moveBy(same, "b", 1)).toBe(same);
  });
});
