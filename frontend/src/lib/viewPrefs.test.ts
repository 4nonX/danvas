// View aids: grid spacing in units, which grid lines are drawn at a zoom,
// snapping to the nearer edge, scrollbar thumbs, and what is kept.
import { afterEach, describe, expect, it } from "vitest";
import { cleanGrid, DEFAULT_VIEW_PREFS, gridLines, gridStep, loadViewPrefs, saveViewPrefs, scrollThumb, snapToGrid } from "./viewPrefs";

describe("grid", () => {
  it("turns the spacing into design px through the dpi", () => {
    expect(gridStep({ value: 10, unit: "mm", subdivisions: 2 }, 300).major).toBeCloseTo(118.11, 2);
    expect(gridStep({ value: 10, unit: "mm", subdivisions: 2 }, 300).minor).toBeCloseTo(59.06, 2);
    expect(gridStep({ value: 50, unit: "px", subdivisions: 1 }, 300)).toEqual({ major: 50, minor: 50 });
  });

  it("draws subdivisions only while they are far enough apart, nothing when too dense", () => {
    const step = { major: 100, minor: 25 };
    expect(gridLines(300, step, 1)).toEqual({ majors: [0, 100, 200, 300], minors: [25, 50, 75, 125, 150, 175, 225, 250, 275] });
    expect(gridLines(300, step, 0.1)!.minors).toEqual([]);
    expect(gridLines(300, step, 0.03)).toBeNull();
  });

  it("snaps the nearer edge onto a line within the threshold", () => {
    expect(snapToGrid({ x: 98, y: 7, width: 40, height: 50 }, 50, 5)).toEqual({ dx: 2, dy: 0 });
    // The right edge (x 147) is nearer to 150 than the left (x 107) to 100.
    expect(snapToGrid({ x: 107, y: 0, width: 40, height: 50 }, 50, 5)).toEqual({ dx: 3, dy: 0 });
    expect(snapToGrid({ x: 120, y: 120, width: 10, height: 10 }, 50, 5)).toEqual({ dx: 0, dy: 0 });
  });

  it("makes stored settings safe", () => {
    expect(cleanGrid({ value: -3, unit: "furlong" as never, subdivisions: 99 })).toEqual({ value: 10, unit: "mm", subdivisions: 10 });
    expect(cleanGrid({ value: 0.5, unit: "in", subdivisions: 0 })).toEqual({ value: 0.5, unit: "in", subdivisions: 1 });
  });
});

describe("scrollbar thumb", () => {
  it("sizes and places the thumb over content plus margin", () => {
    // Content 0..1000, view 0..250 on a 100 px track, no margin.
    const t = scrollThumb(0, 1000, 0, 250, 100, 0)!;
    expect(t.size).toBe(25);
    expect(t.offset).toBe(0);
    expect(scrollThumb(0, 1000, 750, 250, 100, 0)!.offset).toBe(75);
  });

  it("hides when everything is in view, and widens the range to the view", () => {
    expect(scrollThumb(0, 100, -50, 400, 100, 10)).toBeNull();
    // Scrolled past the content: the range grows to include the view.
    const t = scrollThumb(0, 1000, 1200, 250, 100, 0)!;
    expect(t.offset + t.size).toBeCloseTo(100, 5);
  });
});

describe("view prefs", () => {
  const store = new Map<string, string>();
  const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  afterEach(() => { store.clear(); });

  it("keeps the settings and falls back on broken data", () => {
    (globalThis as { localStorage?: unknown }).localStorage = ls;
    expect(loadViewPrefs()).toEqual(DEFAULT_VIEW_PREFS);
    const p = { showRulers: true, showGrid: true, showScrollbars: false, snapEnabled: false, grid: { value: 5, unit: "mm" as const, subdivisions: 5 } };
    saveViewPrefs(p);
    expect(loadViewPrefs()).toEqual(p);
    store.set("oc.editor.view.v1", "{not json");
    expect(loadViewPrefs()).toEqual(DEFAULT_VIEW_PREFS);
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
});
