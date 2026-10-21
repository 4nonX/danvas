// @vitest-environment jsdom
// Print-shop features: the resolution written into PNG and JPEG files, spot
// colours, overprint and layers in the PDF writer, and the image PDF.
import { beforeAll, describe, expect, it } from "vitest";
import { readDpi, setJpegDpi, setPngDpi } from "./rasterMeta";
import { PdfCanvas, PdfResources, pdfName } from "../vectorPdf/pdfCanvas";
import { drawDieLine, drawPrintMarks, mmToPx, printSheet } from "./sheet";
import { psText } from "./eps";
import { createScene, renderScene, type CanvasLike } from "@hc/engine";
import type { DesignFile } from "@hc/schema";

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

// A 1x1 PNG and a minimal JPEG start (SOI + JFIF APP0).
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const JFIF = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);

describe("resolution in raster files", () => {
  it("writes and replaces the PNG resolution", () => {
    const once = setPngDpi(PNG, 300);
    expect(readDpi(once)).toBe(300);
    const twice = setPngDpi(once, 600);
    expect(readDpi(twice)).toBe(600);
    // One pHYs chunk only, and the image data untouched.
    expect(new TextDecoder("latin1").decode(twice).split("pHYs").length - 1).toBe(1);
    expect(twice.length).toBe(once.length);
  });

  it("writes the JPEG resolution, adding a JFIF header when there is none", () => {
    expect(readDpi(setJpegDpi(JFIF, 300))).toBe(300);
    const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 2, 0xff, 0xd9]);
    const withHeader = setJpegDpi(bare, 254);
    expect(readDpi(withHeader)).toBe(254);
    expect(withHeader.length).toBe(bare.length + 18);
  });

  it("leaves other files alone", () => {
    const other = new Uint8Array([1, 2, 3, 4, 5]);
    expect(setPngDpi(other, 300)).toBe(other);
    expect(setJpegDpi(other, 300)).toBe(other);
  });
});

describe("spot colours, overprint and layers in PDF", () => {
  it("names spot colours safely", () => {
    expect(pdfName("Stanze")).toBe("/Stanze");
    expect(pdfName("Cut Contour")).toBe("/Cut#20Contour");
  });

  it("keeps a spot colour's name byte for byte in EPS, as in the PDF", () => {
    // Umlauts and parentheses were once replaced by "?", so a separation
    // "Prägung" reached the print shop as "Pr?gung".
    expect(psText("Stanze")).toBe("(Stanze)");
    expect(psText("Prägung (Stanze)")).toBe("(Pr\\303\\244gung \\(Stanze\\))");
    expect(psText("A\\B")).toBe("(A\\\\B)");
    expect(pdfName("Prägung")).toBe("/Pr#c3#a4gung");
  });

  it("defines separations and overprinting graphics states", () => {
    const res = new PdfResources();
    const cs = res.separation({ name: "Stanze", cmyk: [0, 1, 0, 0] });
    expect(res.separation({ name: "Stanze", cmyk: [0, 1, 0, 0] })).toBe(cs);
    expect(res.colorSpaceDict()).toContain("/Separation /Stanze /DeviceCMYK");
    res.gs(1, 1, "Normal", true);
    expect(res.extGStateDict()).toContain("/OP true /op true /OPM 1");
  });

  it("overprints black-only paint, as CMYK in PDF and as the Black separation for PostScript", () => {
    const draw = (asSeparation: boolean) => {
      const res = new PdfResources();
      const ctx = new PdfCanvas({ width: 100, height: 100, faces: new Map(), resources: res, color: { cmyk: () => [0.5, 0.5, 0.5, 0.5], blackOnly: true, overprintBlack: true, overprintAsSeparation: asSeparation } });
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, 10, 10);
      ctx.fillStyle = "#336699";
      ctx.fillRect(20, 0, 10, 10);
      return { ops: ctx.content(), res };
    };
    const pdf = draw(false);
    expect(pdf.ops).toMatch(/0 0 0 1 k/);
    expect(pdf.res.extGStateDict()).toContain("/OP true");
    // The coloured fill does not overprint.
    expect(pdf.ops).toMatch(/0\.5 0\.5 0\.5 0\.5 k/);
    const ps = draw(true);
    expect(ps.ops).toMatch(/cs 1 scn/);
    expect(ps.res.colorSpaceDict()).toContain("/Separation /Black");
  });

  it("draws the die line in its spot colour on its own layer, and marks in registration", () => {
    const res = new PdfResources();
    const ctx = new PdfCanvas({ width: 400, height: 400, faces: new Map(), resources: res });
    const sheet = printSheet({ width: mmToPx(50, 96), height: mmToPx(100, 96), bleed: mmToPx(1.5, 96), printMarks: { crop: true } }, 96);
    drawPrintMarks(ctx as never, sheet, 1, true);
    drawDieLine(ctx as never, sheet, 1, { name: "Stanze", radiusMm: 2 }, 96);
    const ops = ctx.content();
    expect([...res.spots.keys()]).toEqual(["All", "Stanze"]);
    expect(ops).toMatch(/\/OC \/OC0 BDC[\s\S]*CS 1 SCN[\s\S]*EMC/);
    expect([...res.layers.keys()]).toEqual(["Stanze"]);
  });

  it("writes explicit CMYK and spot colours as given, not through the profile", () => {
    const solid = (srgb: [number, number, number], extra: Record<string, unknown> = {}) => ({ type: "solid", color: { srgb: { r: srgb[0], g: srgb[1], b: srgb[2], a: 1 }, ...extra } });
    const rect = (id: string, x: number, fill: unknown) => ({ id, type: "shape", shape: "rect", transform: { x, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, size: { width: 10, height: 10 }, opacity: 1, blendMode: "normal", fills: [fill] });
    const doc = {
      format: "hycanvas.design", schemaVersion: 29, id: "d", title: "D", unit: "px", dpi: 96, measureUnit: "mm", assets: [], fonts: [], meta: {},
      pages: [{ id: "p", width: 100, height: 100, children: [
        rect("cmyk", 0, solid([0, 0.57, 0.79], { cmyk: { c: 0.73, m: 0.25, y: 0.07, k: 0 } })),
        // White ink as a spot colour, and plain white (paper) next to it with
        // the very same sRGB: only the first is the separation.
        rect("ink", 20, solid([1, 1, 1], { spot: { name: "Weiß", fallback: { c: 0, m: 0, y: 0, k: 0 } } })),
        rect("paper", 40, solid([1, 1, 1])),
        rect("rgb", 60, solid([0.2, 0.4, 0.6])),
        rect("grad", 80, { type: "gradient", gradient: "linear", angle: 0, stops: [
          { position: 0, color: { srgb: { r: 0, g: 0.57, b: 0.79, a: 1 }, cmyk: { c: 0.73, m: 0.25, y: 0.07, k: 0 } } },
          { position: 1, color: { srgb: { r: 1, g: 1, b: 1, a: 1 }, cmyk: { c: 0, m: 0, y: 0, k: 0 } } },
        ] }),
      ] }],
    } as unknown as DesignFile;
    const res = new PdfResources();
    const ctx = new PdfCanvas({ width: 100, height: 100, faces: new Map(), resources: res, color: { cmyk: () => [0.5, 0.5, 0.5, 0.5], blackOnly: true } });
    renderScene(createScene(doc, 0), ctx as unknown as CanvasLike, { width: 100, height: 100, zoom: 1, panX: 0, panY: 0, dpr: 1 }, { clear: false, cull: false });
    const ops = ctx.content();
    expect(ops).toMatch(/0\.73 0\.25 0\.07 0 k/);
    expect([...res.spots.keys()]).toEqual(["Weiß"]);
    expect(ops.match(/cs 1 scn/g)?.length).toBe(1);
    // Paper white and the RGB colour go through the (stub) profile.
    expect(ops.match(/0\.5 0\.5 0\.5 0\.5 k/g)?.length).toBe(2);
    // The gradient blends between the given CMYK values.
    expect(res.shadings.map((s) => s.dict).join(" ")).toMatch(/\/C0 \[0\.73 0\.25 0\.07 0\] \/C1 \[0 0 0 0\]/);
  });

  it("draws no die line where it would be printed (a plain canvas)", () => {
    let strokes = 0;
    // A canvas without spot colours (setSpot and layers absent).
    const plain = new Proxy({} as Record<string, unknown>, { get: (t, k) => (k in t ? t[k as string] : k === "setSpot" || k === "beginLayer" || k === "endLayer" ? undefined : k === "stroke" ? () => { strokes++; } : () => {}), set: (t, k, v) => { t[k as string] = v; return true; } });
    drawDieLine(plain as never, printSheet({ width: 100, height: 100 }, 96), 1, { name: "Stanze", radiusMm: 2 }, 96);
    expect(strokes).toBe(0);
  });
});
