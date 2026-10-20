// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { clipToBleed, drawPrintMarks, hasPrintAdditions, initialPrintOverride, printAdditions, withPrintOverride, mmToPx, pdfBoxes, printSheet, pxToMm, resolvedMarks, sheetViewport } from "./sheet";
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

  it("draws eight crop marks on the trim lines, outside the bleed when the gap is at least the bleed", () => {
    const s = printSheet({ ...A6, bleed, printMarks: { crop: true, offset: mmToPx(3, DPI), length: mmToPx(5, DPI) } }, DPI);
    expect(s.marks).toHaveLength(8);
    for (const l of s.marks) {
      const onTrim = [0, A6.width].includes(l.x1) && l.x1 === l.x2 || [0, A6.height].includes(l.y1) && l.y1 === l.y2;
      expect(onTrim).toBe(true);
      // Nothing of a mark lies inside the bleed box.
      const inside = (x: number, y: number) => x > -bleed + 1e-9 && x < A6.width + bleed - 1e-9 && y > -bleed + 1e-9 && y < A6.height + bleed - 1e-9;
      expect(inside(l.x1, l.y1) || inside(l.x2, l.y2)).toBe(false);
    }
    // The sheet reaches to the end of the marks: 3 + 5 mm.
    expect(pxToMm(s.margin, DPI)).toBeCloseTo(8);
  });

  it("starts marks at the gap as set, also inside the bleed", () => {
    const s = printSheet({ ...A6, bleed, printMarks: { crop: true, offset: mmToPx(1.5, DPI), length: mmToPx(5, DPI) } }, DPI);
    expect(pxToMm(Math.abs(s.marks[0].y1), DPI)).toBeCloseTo(1.5);
    expect(pxToMm(Math.abs(s.marks[0].y2), DPI)).toBeCloseTo(6.5);
    // The sheet reaches to the end of the marks, past the bleed.
    expect(pxToMm(s.margin, DPI)).toBeCloseTo(6.5);
    // A gap of zero starts the marks right at the corner.
    const zero = printSheet({ ...A6, printMarks: { crop: true, offset: 0 } }, DPI);
    expect(zero.marks[0].y1 + 0).toBe(0);
  });

  it("includes the bleed and the marks each on their own", () => {
    const page = { ...A6, bleed, printMarks: { crop: true } };
    const onlyBleed = printSheet(page, DPI, { bleed: true, marks: false });
    expect([onlyBleed.bleed, onlyBleed.margin, onlyBleed.marks.length]).toEqual([bleed, bleed, 0]);
    const onlyMarks = printSheet(page, DPI, { bleed: false, marks: true });
    expect(onlyMarks.bleed).toBe(0);
    expect(onlyMarks.marks).toHaveLength(8);
    // Without the bleed the marks start at their own offset (3 mm) and the
    // sheet ends 3 + 5 mm past the trim.
    expect(pxToMm(Math.abs(onlyMarks.marks[0].y1), DPI)).toBeCloseTo(3);
    expect(pxToMm(onlyMarks.margin, DPI)).toBeCloseTo(8);
    const b = pdfBoxes(onlyMarks, DPI);
    expect(b.bleed).toEqual(b.trim);
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

  it("keeps round dots out of the bleed", () => {
    const weight = 2;
    const s = printSheet({ ...A6, bleed, printMarks: { crop: true, style: "dotted", weight } }, DPI);
    const half = (weight * DPI) / 72 / 2;
    for (const l of s.marks) {
      const near = Math.min(Math.abs(l.x1 - 0), Math.abs(l.x1 - A6.width), Math.abs(l.y1 - 0), Math.abs(l.y1 - A6.height));
      const fromTrim = l.x1 === l.x2 ? Math.min(Math.abs(l.y1), Math.abs(l.y1 - A6.height)) : Math.min(Math.abs(l.x1), Math.abs(l.x1 - A6.width));
      expect(near).toBe(0);
      expect(fromTrim).toBeCloseTo(bleed + half);
    }
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

  it("applies one export-wide setting to every design, of any dpi, without changing them", () => {
    const plain = { schemaVersion: 28, dpi: 96, pages: [{ id: "a", ...A6, children: [] }] } as never;
    const own = { schemaVersion: 28, dpi: 300, pages: [{ id: "b", width: mmToPx(105, 300), height: mmToPx(148, 300), bleed: mmToPx(5, 300), printMarks: { crop: true, style: "dotted" }, children: [] }] } as never;
    const start = initialPrintOverride([plain, own]);
    // The first design that sets anything gives the starting values.
    expect(start.bleed && start.marks).toBe(true);
    expect(start.bleedMm).toBeCloseTo(5);
    expect(start.style).toBe("dotted");
    const o = { ...start, bleedMm: 3, style: "solid" };
    for (const [doc, dpi] of [[plain, 96], [own, 300]] as const) {
      const pg = withPrintOverride(doc, o).pages[0];
      expect(pxToMm(pg.bleed ?? 0, dpi)).toBeCloseTo(3);
      expect(pg.printMarks?.style).toBe("solid");
      expect(pxToMm(printSheet(pg, dpi).margin, dpi)).toBeCloseTo(8);
    }
    // The originals are untouched.
    expect((plain as { pages: { bleed?: number }[] }).pages[0].bleed).toBeUndefined();
    expect((own as { pages: { printMarks: { style: string } }[] }).pages[0].printMarks.style).toBe("dotted");
    // Switched off, nothing is added, and existing settings are dropped.
    const off = withPrintOverride(own, { ...o, bleed: false, marks: false }).pages[0];
    expect([off.bleed, off.printMarks]).toEqual([undefined, undefined]);
    expect(initialPrintOverride([plain])).toMatchObject({ bleed: false, marks: false, bleedMm: 3 });
  });

  it("knows which additions pages have", () => {
    expect(printAdditions([{ bleed }, {}])).toEqual({ bleed: true, marks: false });
    expect(printAdditions([{ printMarks: { crop: true } }])).toEqual({ bleed: false, marks: true });
  });

  it("knows when pages have anything to add", () => {
    expect(hasPrintAdditions([{}, { bleed: 0 }])).toBe(false);
    expect(hasPrintAdditions([{}, { bleed }])).toBe(true);
    expect(hasPrintAdditions([{ printMarks: { crop: true } }])).toBe(true);
  });

  it("cuts artwork at the bleed line when the sheet has room for marks", () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k) => (k in t ? t[k as string] : (...a: number[]) => { calls.push(`${String(k)}(${a.map((v) => Math.round(v * 100) / 100).join(",")})`); }),
      set: (t, k, v) => { t[k as string] = v; return true; },
    });
    clipToBleed(ctx as never, printSheet({ ...A6, bleed, printMarks: { crop: true } }, DPI), 1);
    const r = (v: number) => Math.round(v * 100) / 100;
    expect(calls).toContain(`rect(${r(-bleed)},${r(-bleed)},${r(A6.width + 2 * bleed)},${r(A6.height + 2 * bleed)})`);
    expect(calls).toContain("clip()");
    // Without marks the file's own edge is the bleed line: no clip needed.
    calls.length = 0;
    clipToBleed(ctx as never, printSheet({ ...A6, bleed }, DPI), 1);
    expect(calls).toEqual([]);
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
