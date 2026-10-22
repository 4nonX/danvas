import { describe, expect, it } from "vitest";
import { assignSlots, normalizeImpose, planImposition, type ImposeInput } from "./impose";

const card = (patch: Partial<ImposeInput> = {}): ImposeInput => ({
  itemW: 90, itemH: 50, bleed: 0, sheetW: 210, sheetH: 297, orientation: "auto", marginMm: 5, gapMm: 0, marks: true, rotate: true, ...patch,
});

describe("imposition layout", () => {
  it("fits ten business cards on A4 with marks, twelve without", () => {
    const withMarks = planImposition(card())!;
    expect([withMarks.cols, withMarks.rows, withMarks.rotated, withMarks.sheetW]).toEqual([2, 5, false, 210]);
    const plain = planImposition(card({ marks: false }))!;
    // 12 fit both as turned cards on portrait and as cards on landscape: unturned wins.
    expect([plain.cols, plain.rows, plain.rotated, plain.sheetW, plain.sheetH]).toEqual([3, 4, false, 297, 210]);
  });

  it("turns items only when that fits more, and keeps a fixed orientation", () => {
    const p = planImposition(card({ marks: false, orientation: "portrait" }))!;
    expect([p.cols, p.rows, p.rotated, p.itemW, p.itemH]).toEqual([4, 3, true, 50, 90]);
    const q = planImposition(card({ marks: false, orientation: "portrait", rotate: false }))!;
    expect([q.cols, q.rows, q.rotated]).toEqual([2, 5, false]);
  });

  it("centres the grid and keeps marks and bleed inside the printable area", () => {
    const p = planImposition(card({ bleed: 3, gapMm: 6 }))!;
    const xs = p.slots.map((s) => s.x), ys = p.slots.map((s) => s.y);
    const left = Math.min(...xs), right = p.sheetW - (Math.max(...xs) + p.itemW);
    const top = Math.min(...ys), bottom = p.sheetH - (Math.max(...ys) + p.itemH);
    expect(left).toBeCloseTo(right, 9);
    expect(top).toBeCloseTo(bottom, 9);
    for (const m of p.marks) {
      for (const v of [m.x1, m.x2]) {
        expect(v).toBeGreaterThanOrEqual(5 - 1e-9);
        expect(v).toBeLessThanOrEqual(p.sheetW - 5 + 1e-9);
      }
      for (const v of [m.y1, m.y2]) {
        expect(v).toBeGreaterThanOrEqual(5 - 1e-9);
        expect(v).toBeLessThanOrEqual(p.sheetH - 5 + 1e-9);
      }
      // Never on the artwork: outside the grid plus its bleed.
      const inGridX = (v: number) => v > left - 3 && v < p.sheetW - right + 3;
      const inGridY = (v: number) => v > top - 3 && v < p.sheetH - bottom + 3;
      expect(inGridX(m.x1) && inGridY(m.y1) && inGridX(m.x2) && inGridY(m.y2)).toBe(false);
    }
  });

  it("gives every item its full bleed with a gap of twice the bleed, none between butted items", () => {
    const wide = planImposition(card({ bleed: 3, gapMm: 6, marks: false }))!;
    for (const s of wide.slots) expect(Object.values(s.bleed)).toEqual([3, 3, 3, 3]);
    const butted = planImposition(card({ bleed: 3, gapMm: 0, marks: false }))!;
    const inner = butted.slots.find((s, i) => i % butted.cols !== 0 && i % butted.cols !== butted.cols - 1 && i >= butted.cols && i < butted.slots.length - butted.cols);
    const corner = butted.slots[0];
    expect(corner.bleed).toEqual({ left: 3, right: 0, top: 3, bottom: 0 });
    if (inner) expect(Object.values(inner.bleed)).toEqual([0, 0, 0, 0]);
    // Neighbours' bleed areas never overlap.
    for (const a of butted.slots) for (const b of butted.slots) {
      if (a === b) continue;
      const ax2 = a.x + butted.itemW + a.bleed.right, bx1 = b.x - b.bleed.left;
      const ay2 = a.y + butted.itemH + a.bleed.bottom, by1 = b.y - b.bleed.top;
      const overlapX = a.x - a.bleed.left < b.x + butted.itemW + b.bleed.right - 1e-9 && bx1 < ax2 - 1e-9;
      const overlapY = a.y - a.bleed.top < b.y + butted.itemH + b.bleed.bottom - 1e-9 && by1 < ay2 - 1e-9;
      expect(overlapX && overlapY).toBe(false);
    }
  });

  it("puts a mark at every cut line, twice", () => {
    const p = planImposition(card({ gapMm: 4 }))!;
    const vertical = new Set(p.marks.filter((m) => m.x1 === m.x2).map((m) => m.x1.toFixed(6)));
    const horizontal = new Set(p.marks.filter((m) => m.y1 === m.y2).map((m) => m.y1.toFixed(6)));
    expect(vertical.size).toBe(p.cols * 2);
    expect(horizontal.size).toBe(p.rows * 2);
    expect(p.marks.length).toBe((p.cols * 2 + p.rows * 2) * 2);
  });

  it("refuses an item larger than the sheet", () => {
    expect(planImposition(card({ itemW: 300, itemH: 400 }))).toBeNull();
  });
});

describe("slot assignment", () => {
  it("repeats each page on its own sheet, or fills the slots in order", () => {
    expect(assignSlots([0, 1], 3, "repeat")).toEqual([[0, 0, 0], [1, 1, 1]]);
    expect(assignSlots([0, 1, 2, 3, 4], 2, "sequence")).toEqual([[0, 1], [2, 3], [4]]);
    expect(assignSlots([0], 0, "repeat")).toEqual([]);
  });

  it("opens older settings with imposition off", () => {
    expect(normalizeImpose(undefined).on).toBe(false);
    expect(normalizeImpose({ on: true, sheet: "sra3", gapMm: -4, fill: "sequence" })).toMatchObject({ on: true, sheet: "sra3", gapMm: 0, fill: "sequence" });
  });
});
