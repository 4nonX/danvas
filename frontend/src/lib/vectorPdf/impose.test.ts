// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import type { DesignFile } from "@hc/schema";
import { planImposition, defaultImposeSettings } from "@/lib/print/impose";
import { imposeSheets, placeForm, type FormPage } from "./impose";
import { exportVectorPdf } from "./index";

const PT = 72 / 25.4;

/** The form of a 90 x 50 mm card with 3 mm bleed. */
const card = (name = "Fm0"): FormPage => ({ name, width: 96 * PT, height: 56 * PT, margin: 3 * PT, trimW: 90, trimH: 50, bleed: 3 });

/** Applies the `a b c d e f cm` of a placement to a form point (pt, y up). */
function mapPoint(ops: string, x: number, y: number): [number, number] {
  const m = / ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) cm /.exec(ops)!.slice(1).map(Number);
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

describe("placing a page in a slot", () => {
  for (const rotate of [false, true]) {
    it(`puts the trim box exactly on the slot${rotate ? ", turned a quarter clockwise" : ""}`, () => {
      // A narrow portrait sheet: two turned cards fit side by side, one unturned.
      const plan = planImposition({ itemW: 90, itemH: 50, bleed: 3, sheetW: rotate ? 120 : 210, sheetH: 297, orientation: "portrait", marginMm: 5, gapMm: 0, marks: false, rotate })!;
      expect(plan.rotated).toBe(rotate);
      const f = card();
      const H = plan.sheetH * PT;
      for (const slot of plan.slots) {
        const ops = placeForm(f, plan, slot, H);
        // The form's trim corners (pt, y up): top left, top right, bottom left.
        const tl = mapPoint(ops, f.margin, f.height - f.margin);
        const tr = mapPoint(ops, f.width - f.margin, f.height - f.margin);
        const bl = mapPoint(ops, f.margin, f.margin);
        const sheet = (x: number, y: number) => [x * PT, H - y * PT];
        const [sx, sy] = [slot.x, slot.y];
        if (!rotate) {
          expect(tl[0]).toBeCloseTo(sheet(sx, sy)[0], 3); expect(tl[1]).toBeCloseTo(sheet(sx, sy)[1], 3);
          expect(tr[0]).toBeCloseTo(sheet(sx + 90, sy)[0], 3);
          expect(bl[1]).toBeCloseTo(sheet(sx, sy + 50)[1], 3);
        } else {
          // Clockwise: the top edge becomes the right edge, top left goes to top right.
          expect(tl[0]).toBeCloseTo(sheet(sx + 50, sy)[0], 3); expect(tl[1]).toBeCloseTo(sheet(sx + 50, sy)[1], 3);
          expect(tr[0]).toBeCloseTo(sheet(sx + 50, sy + 90)[0], 3); expect(tr[1]).toBeCloseTo(sheet(sx + 50, sy + 90)[1], 3);
          expect(bl[0]).toBeCloseTo(sheet(sx, sy)[0], 3); expect(bl[1]).toBeCloseTo(sheet(sx, sy)[1], 3);
        }
        expect(ops).toMatch(/ re W n /);
        expect(ops).toContain("/Fm0 Do");
      }
    });
  }
});

describe("imposed sheets", () => {
  it("repeats each page on its own sheets and draws the cut marks", () => {
    const s = { ...defaultImposeSettings(), on: true };
    const { sheets, plans } = imposeSheets([card("Fm0"), card("Fm1")], s, [210, 297], { stroke: "0 G", weight: 0.25 });
    const per = plans[0].slots.length;
    expect(sheets.length).toBe(2);
    expect(sheets[0].stream.split("/Fm0 Do").length - 1).toBe(per);
    expect(sheets[1].stream.split("/Fm1 Do").length - 1).toBe(per);
    expect(sheets[0].stream.split(" m ").length - 1).toBe(plans[0].marks.length);
  });

  it("fills the slots in order and starts a new grid for another size", () => {
    const s = { ...defaultImposeSettings(), on: true, fill: "sequence" as const, marks: false };
    const big: FormPage = { ...card("Fm2"), trimW: 100, trimH: 70 };
    const { sheets, plans } = imposeSheets([card("Fm0"), card("Fm1"), big], s, [210, 297], { stroke: "0 G", weight: 0.25 });
    expect(plans.length).toBe(2);
    expect(sheets.length).toBe(2);
    expect(sheets[0].stream).toContain("/Fm0 Do");
    expect(sheets[0].stream).toContain("/Fm1 Do");
    expect(sheets[1].stream).toContain("/Fm2 Do");
  });

  it("refuses an item larger than the sheet", () => {
    const huge: FormPage = { ...card(), trimW: 400, trimH: 500 };
    expect(() => imposeSheets([huge], { ...defaultImposeSettings(), on: true }, [210, 297], { stroke: "0 G", weight: 0.25 })).toThrow();
  });
});

// jsdom has no canvas; the PDF recorder only needs one to normalize colours.
// Its Blob has no stream(), which the PDF writer compresses through.
beforeAll(async () => {
  globalThis.Blob = (await import("node:buffer")).Blob as unknown as typeof Blob;
  HTMLCanvasElement.prototype.getContext = function () {
    let style = "#000000";
    return { get fillStyle() { return style; }, set fillStyle(v: string) { style = v; } } as unknown as CanvasRenderingContext2D;
  } as typeof HTMLCanvasElement.prototype.getContext;
});

/** Every stream of a PDF, inflated where compressed. */
function streams(pdf: Uint8Array): string[] {
  const text = Buffer.from(pdf).toString("latin1");
  const out: string[] = [];
  const re = /stream\n([\s\S]*?)\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = Buffer.from(m[1], "latin1");
    try { out.push(inflateSync(raw).toString("latin1")); } catch { out.push(m[1]); }
  }
  return out;
}

describe("vector PDF with imposition", () => {
  it("writes one form per page and a sheet that places it in every slot", async () => {
    const mm = (v: number) => (v / 25.4) * 96;
    const doc = {
      format: "hycanvas.design", schemaVersion: 29, id: "d", title: "Card", unit: "px", dpi: 96, assets: [], fonts: [], meta: {},
      pages: [{ id: "p", width: mm(90), height: mm(50), bleed: mm(3), children: [
        { id: "r", type: "shape", shape: "rect", transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, size: { width: mm(90), height: mm(50) }, opacity: 1, blendMode: "normal", fills: [{ type: "solid", color: { srgb: { r: 0, g: 0.4, b: 0.8, a: 1 } } }] },
      ] }],
    } as unknown as DesignFile;
    const out = await exportVectorPdf(doc, [0], { print: { bleed: true, marks: true }, impose: { settings: { ...defaultImposeSettings(), on: true }, sheetMm: [210, 297] } });
    expect(out.widthMm).toBe(210);
    expect(out.heightMm).toBe(297);
    const bytes = new Uint8Array(await out.blob.arrayBuffer());
    const text = Buffer.from(bytes).toString("latin1");
    expect(text.match(/\/Type \/Page /g)?.length).toBe(1);
    expect(text).toMatch(/\/Subtype \/Form/);
    expect(text).toMatch(/\/MediaBox \[0 0 595\.27\d* 841\.88\d*\]/);
    const sheet = streams(bytes).find((s) => s.includes("/Fm0 Do"))!;
    expect(sheet.split("/Fm0 Do").length - 1).toBe(10);
    // Marks drawn on the sheet, none from the page itself (its form has no strokes).
    expect(sheet).toMatch(/ S Q/);
    // The form: the page's own content, mapped from device px by its first cm.
    const form = streams(bytes).find((s) => /^[\d.]+ 0 0 -[\d.]+ 0 [\d.]+ cm/.test(s))!;
    expect(form).toBeDefined();
    expect(form).toMatch(/\bf\b/);
    expect(form).not.toMatch(/\bS\b/);
  });
});
