// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { drawPrintMarks, hasPrintAdditions, mmToPx, pdfBoxes, printSheet, pxToMm, resolvedMarks, sheetViewport } from "./sheet";
import { PdfCanvas, PdfResources } from "../vectorPdf/pdfCanvas";

// jsdom has no canvas; the PDF recorder only needs one to normalize colours.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = function () {
    let style = "#000000";
    return {
      get fillStyle() { return style; },
      set fillStyle(v: string) { style = v; },
    } as unknown as CanvasRenderingContext2D;
  } as typeof HTMLCanvasElement.prototype.getContext;
});

// An A6 page at 96 dpi with 3 mm bleed.
const DPI = 96;
const A6 = { width: mmToPx(105, DPI), height: mmToPx(148, DPI) };
const bleed = mmToPx(3, DPI);

describe("print sheet", () => {
  it("is the bare page without bleed, marks, or the print option", () => {
    const s = printSheet({ ...A6 }, DPI);
    expect([s.margin, s.bleed, s.marks.length]).toEqual([0, 0, 0]);
    expect([s.sheetWidth, s.sheetHeight]).toEqual([A6.width, A6.height]);
    const off = printSheet({ ...A6, bleed, printMarks: { crop: true } }, DPI, false);
    expect([off.margin, off.marks.length]).toEqual([0, 0]);
  });

  it("adds the bleed on every side", () => {
    const s = printSheet({ ...A6, bleed }, DPI);
    expect(s.margin).toBeCloseTo(bleed);
    expect(pxToMm(s.sheetWidth, DPI)).toBeCloseTo(111);
    expect(pxToMm(s.sheetHeight, DPI)).toBeCloseTo(154);
  });

  it("draws eight crop marks outside the bleed, on the trim lines", () => {
    const s = printSheet({ ...A6, bleed, printMarks: { crop: true, offset: mmToPx(1, DPI), length: mmToPx(5, DPI) } }, DPI);
    expect(s.marks).toHaveLength(8);
    // The offset (1 mm) is smaller than the bleed (3 mm): marks start at the bleed.
    for (const l of s.marks) {
      const onTrim = [0, A6.width].includes(l.x1) && l.x1 === l.x2 || [0, A6.height].includes(l.y1) && l.y1 === l.y2;
      expect(onTrim).toBe(true);
      // Nothing of a mark lies inside the bleed box.
      const inside = (x: number, y: number) => x > -bleed + 1e-9 && x < A6.width + bleed - 1e-9 && y > -bleed + 1e-9 && y < A6.height + bleed - 1e-9;
      expect(inside(l.x1, l.y1) || inside(l.x2, l.y2)).toBe(false);
    }
    expect(Math.abs(s.marks[0].y1)).toBeCloseTo(bleed);
    // The sheet reaches to the end of the marks: bleed + 5 mm.
    expect(pxToMm(s.margin, DPI)).toBeCloseTo(8);
  });

  it("fills in defaults and draws unknown styles solid", () => {
    const m = resolvedMarks({ printMarks: { crop: true, style: "wavy" } }, DPI)!;
    expect(m.style).toBe("solid");
    expect(m.weightPt).toBe(0.25);
    expect(pxToMm(m.length, DPI)).toBeCloseTo(5);
    expect(pxToMm(m.offset, DPI)).toBeCloseTo(3);
    expect(resolvedMarks({ printMarks: { crop: false } }, DPI)).toBeNull();
    expect(resolvedMarks({}, DPI)).toBeNull();
  });

  it("dashes and dots the line, in the chosen color and weight", () => {
    const dashed = printSheet({ ...A6, printMarks: { crop: true, style: "dashed", weight: 0.5, color: { srgb: { r: 1, g: 0, b: 0, a: 1 } } } }, DPI);
    expect(dashed.stroke.color).toBe("#ff0000");
    expect(dashed.stroke.width).toBeCloseTo((0.5 * DPI) / 72);
    expect(dashed.stroke.dash.length).toBe(2);
    const dotted = printSheet({ ...A6, printMarks: { crop: true, style: "dotted" } }, DPI);
    expect(dotted.stroke.dash[0]).toBe(0);
    expect(dotted.stroke.cap).toBe("round");
    expect(printSheet({ ...A6, printMarks: { crop: true } }, DPI).stroke.dash).toEqual([]);
  });

  it("states the PDF boxes: trim inside bleed inside media", () => {
    const s = printSheet({ ...A6, bleed, printMarks: { crop: true } }, DPI);
    const b = pdfBoxes(s, DPI);
    const pt = (mm: number) => (mm / 25.4) * 72;
    expect(b.trim[2] - b.trim[0]).toBeCloseTo(pt(105));
    expect(b.bleed[2] - b.bleed[0]).toBeCloseTo(pt(111));
    expect(b.media[2]).toBeCloseTo(pt(105 + 2 * 8));
    expect(b.trim[0] - b.bleed[0]).toBeCloseTo(pt(3));
  });

  it("renders the sheet from the bleed's top-left corner", () => {
    const s = printSheet({ ...A6, bleed }, DPI);
    const vp = sheetViewport(s, 2);
    expect([vp.panX, vp.panY]).toEqual([-bleed, -bleed]);
    expect(vp.width).toBe(Math.ceil(s.sheetWidth * 2));
  });

  it("knows when pages have anything to add", () => {
    expect(hasPrintAdditions([{}, { bleed: 0 }])).toBe(false);
    expect(hasPrintAdditions([{}, { bleed }])).toBe(true);
    expect(hasPrintAdditions([{ printMarks: { crop: true } }])).toBe(true);
  });

  it("writes the marks into a PDF page as one dashed stroke", () => {
    const s = printSheet({ ...A6, bleed, printMarks: { crop: true, style: "dashed" } }, DPI);
    const ctx = new PdfCanvas({ width: 100, height: 100, faces: new Map(), resources: new PdfResources() });
    drawPrintMarks(ctx as unknown as Parameters<typeof drawPrintMarks>[0], s, 1);
    const ops = ctx.content();
    expect(ops).toMatch(/\[[\d. ]+\] [\d.]+ d/);
    expect((ops.match(/ m\b/g) ?? []).length).toBe(8);
    expect(ops).toMatch(/\bS\b/);
  });
});
