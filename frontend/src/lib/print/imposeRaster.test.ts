// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DesignFile } from "@hc/schema";
import { defaultImposeSettings, planImposition } from "./impose";

// Each page picture: a stand-in of the size the real one would have.
vi.mock("@/lib/exportFormats", () => ({
  renderPageCanvas: (doc: DesignFile, index: number, scale: number, _opaque: boolean, print: { bleed: boolean }) => {
    const pg = doc.pages[index];
    const b = print.bleed ? pg.bleed ?? 0 : 0;
    return { width: Math.round((pg.width + 2 * b) * scale), height: Math.round((pg.height + 2 * b) * scale), page: index };
  },
}));

type Call = { op: string; args: number[]; transform: number[] };
const calls: Call[] = [];

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = function () {
    let t = [1, 0, 0, 1, 0, 0];
    const rec = (op: string) => (...args: unknown[]) => { calls.push({ op, args: args.filter((a) => typeof a === "number") as number[], transform: [...t] }); };
    return {
      fillStyle: "", strokeStyle: "", lineWidth: 1,
      fillRect: rec("fillRect"), save: rec("save"), restore: () => { t = [1, 0, 0, 1, 0, 0]; },
      beginPath: rec("beginPath"), rect: rec("rect"), clip: rec("clip"), moveTo: rec("moveTo"), lineTo: rec("lineTo"), stroke: rec("stroke"),
      setTransform: (...m: number[]) => { t = m; },
      drawImage: (img: { page: number }, ...xy: number[]) => calls.push({ op: "drawImage", args: [img.page, ...xy], transform: [...t] }),
    } as unknown as CanvasRenderingContext2D;
  } as typeof HTMLCanvasElement.prototype.getContext;
});

const mm = (v: number) => (v / 25.4) * 96;
const doc = { dpi: 96, pages: [{ width: mm(90), height: mm(50), bleed: mm(3) }, { width: mm(90), height: mm(50), bleed: mm(3) }] } as unknown as DesignFile;

describe("imposed sheet pictures", () => {
  it("places the trim corner of every page on its slot", async () => {
    const { imposeCanvases } = await import("./imposeRaster");
    calls.length = 0;
    const s = { ...defaultImposeSettings(), on: true };
    const sheets = imposeCanvases(doc, [0, 1], s, [210, 297], 300, true);
    const plan = planImposition({ itemW: 90, itemH: 50, bleed: 3, sheetW: 210, sheetH: 297, orientation: "auto", marginMm: 5, gapMm: 0, marks: true, rotate: true })!;
    expect(sheets.length).toBe(2);
    expect(sheets[0].canvas.width).toBe(Math.round((210 / 25.4) * 300));
    const draws = calls.filter((c) => c.op === "drawImage");
    expect(draws.length).toBe(plan.slots.length * 2);
    const px = (v: number) => (v / 25.4) * 300;
    const margin = mm(3) * (300 / 96);
    plan.slots.forEach((slot, j) => {
      const d = draws[j];
      expect(d.args[0]).toBe(0);
      expect(d.args[1]).toBeCloseTo(px(slot.x) - margin, 6);
      expect(d.args[2]).toBeCloseTo(px(slot.y) - margin, 6);
    });
    expect(draws[plan.slots.length].args[0]).toBe(1);
  });

  it("turns pages a quarter clockwise when the layout does", async () => {
    const { imposeCanvases } = await import("./imposeRaster");
    calls.length = 0;
    const s = { ...defaultImposeSettings(), on: true, marks: false, orientation: "portrait" as const };
    imposeCanvases(doc, [0], s, [120, 297], 300, true);
    const plan = planImposition({ itemW: 90, itemH: 50, bleed: 3, sheetW: 120, sheetH: 297, orientation: "portrait", marginMm: 5, gapMm: 0, marks: false, rotate: true })!;
    expect(plan.rotated).toBe(true);
    const px = (v: number) => (v / 25.4) * 300;
    const scale = 300 / 96;
    const margin = mm(3) * scale;
    const imgH = Math.round((mm(50) + 2 * mm(3)) * scale);
    const draws = calls.filter((c) => c.op === "drawImage");
    plan.slots.forEach((slot, j) => {
      const [a, b, c, d, e, f] = draws[j].transform;
      expect([a, b, c, d]).toEqual([0, 1, -1, 0]);
      // The picture's trim top left (margin, margin) lands on the slot's top right.
      const x = a * margin + c * margin + e, y = b * margin + d * margin + f;
      expect(x).toBeCloseTo(px(slot.x) + (imgH - 2 * margin), 6);
      expect(y).toBeCloseTo(px(slot.y), 6);
    });
  });
});
