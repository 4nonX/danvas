// The Elements panel's rows: what a person arranged is read back safely, the
// row's line shows pinned tiles in their order and then the most used, and
// moving rows and tiles does what the panel shows.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROW_ORDER, defaultRowsPref, moveRowBefore, moveRowBy, moveTileBefore, normalizeRowsPref, recordUse,
  resetArrangement, setRowHidden, sortTiles, stripTiles, togglePin,
} from "./elementRows";

const tiles = ["a", "b", "c", "d", "e", "f", "g"].map((id) => ({ id }));
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("element rows", () => {
  it("reads any stored value safely", () => {
    expect(normalizeRowsPref(undefined)).toEqual(defaultRowsPref());
    expect(normalizeRowsPref("nonsense")).toEqual(defaultRowsPref());
    const p = normalizeRowsPref({ order: ["data", "bogus", "shapes", "data"], hidden: ["recent", "animated", 3], pins: ["x", "x"], uses: { a: 2, b: -1, c: "x" }, tileOrder: { shapes: ["b", "a"], nope: ["z"] } });
    // Unknown rows drop, duplicates collapse, rows missing from an older
    // value come back where they belong by default.
    expect(p.order).toEqual(["recent", "data", "graphics", "animated", "shapes", "frames"]);
    expect([...p.order].sort()).toEqual([...DEFAULT_ROW_ORDER].sort());
    // "Recent" cannot be hidden.
    expect(p.hidden).toEqual(["animated"]);
    expect(p.pins).toEqual(["x"]);
    expect(p.uses).toEqual({ a: 2 });
    expect(p.tileOrder).toEqual({ shapes: ["b", "a"] });
  });

  it("puts a row added in a later release after the row before it by default", () => {
    const p = normalizeRowsPref({ order: ["recent", "data", "shapes", "frames", "graphics"] });
    expect(p.order).toEqual(["recent", "data", "shapes", "frames", "graphics", "animated"]);
  });

  it("keeps moved tiles where they were put and the rest in their built-in order", () => {
    expect(ids(sortTiles(tiles, ["e", "a"]))).toEqual(["e", "a", "b", "c", "d", "f", "g"]);
    expect(ids(sortTiles(tiles, undefined))).toEqual(ids(tiles));
  });

  it("fills the line with pinned tiles first, in their order, then the most used", () => {
    let p = defaultRowsPref();
    p = togglePin(p, "f");
    p = togglePin(p, "c");
    p = recordUse(recordUse(recordUse(p, "g"), "g"), "e");
    const sorted = sortTiles(tiles, ["f"]);
    // f is moved first, so pinned f comes before pinned c.
    expect(ids(stripTiles(sorted, p))).toEqual(["f", "c", "g", "e", "a"]);
    expect(ids(stripTiles(sorted, p, 3))).toEqual(["f", "c", "g"]);
  });

  it("moves rows by dragging and with the arrow keys", () => {
    const p = defaultRowsPref();
    expect(moveRowBefore(p, "graphics", "shapes").order).toEqual(["recent", "graphics", "shapes", "frames", "data", "animated"]);
    expect(moveRowBefore(p, "recent", null).order).toEqual(["shapes", "frames", "data", "graphics", "animated", "recent"]);
    expect(moveRowBy(p, "frames", -1).order).toEqual(["recent", "frames", "shapes", "data", "graphics", "animated"]);
    expect(moveRowBy(p, "recent", -1)).toBe(p);
    expect(moveRowBy(p, "animated", 1)).toBe(p);
  });

  it("sorts a tile within its row, and pins it when dropped into the line", () => {
    const p = defaultRowsPref();
    const current = ids(tiles);
    const sorted = moveTileBefore(p, "shapes", current, "f", "b", false);
    expect(sorted.tileOrder.shapes).toEqual(["a", "f", "b", "c", "d", "e", "g"]);
    expect(sorted.pins).toEqual([]);
    const pinned = moveTileBefore(p, "shapes", current, "f", "a", true);
    expect(pinned.pins).toEqual(["f"]);
    expect(ids(stripTiles(sortTiles(tiles, pinned.tileOrder.shapes), pinned))[0]).toBe("f");
    // Onto itself or onto a tile of another row: nothing changes.
    expect(moveTileBefore(p, "shapes", current, "f", "f", true)).toBe(p);
    expect(moveTileBefore(p, "shapes", current, "f", "zz", true)).toBe(p);
  });

  it("hides and shows rows, never the recent one", () => {
    let p = setRowHidden(defaultRowsPref(), "animated", true);
    expect(p.hidden).toEqual(["animated"]);
    expect(setRowHidden(p, "recent", true).hidden).toEqual(["animated"]);
    p = setRowHidden(p, "animated", false);
    expect(p.hidden).toEqual([]);
  });

  it("records uses and recent tiles, bounded", () => {
    let p = defaultRowsPref();
    for (let i = 0; i < 15; i++) p = recordUse(p, `t${i}`);
    p = recordUse(p, "t3");
    expect(p.recent).toHaveLength(10);
    expect(p.recent[0]).toBe("t3");
    expect(p.uses.t3).toBe(2);
    for (let i = 0; i < 250; i++) p = recordUse(p, `u${i}`);
    expect(Object.keys(p.uses).length).toBeLessThanOrEqual(201);
    expect(p.uses.t3).toBe(2);
  });

  it("resets the arrangement and keeps what was used", () => {
    let p = recordUse(defaultRowsPref(), "a");
    p = togglePin(setRowHidden(moveRowBy(p, "frames", -1), "data", true), "a");
    const r = resetArrangement(p);
    expect(r.order).toEqual([...DEFAULT_ROW_ORDER]);
    expect(r.hidden).toEqual([]);
    expect(r.pins).toEqual([]);
    expect(r.uses).toEqual({ a: 1 });
    expect(r.recent).toEqual(["a"]);
  });
});
