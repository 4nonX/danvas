// @vitest-environment jsdom
// "Transparent background" for SVG and the vector PDFs: the page background is
// left out, the elements stay.
import { inflateSync } from "node:zlib";
import type { DesignFile } from "@hc/schema";
import { beforeAll, describe, expect, it } from "vitest";
import { exportVectorPdf, exportVectorSvg } from "./index";

function pdfContent(pdf: Uint8Array): string {
  const text = Buffer.from(pdf).toString("latin1");
  const out: string[] = [];
  const re = /stream\n([\s\S]*?)\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = Buffer.from(m[1], "latin1");
    try { out.push(inflateSync(raw).toString("latin1")); } catch { out.push(m[1]); }
  }
  return out.join("\n");
}

// A red page with one blue square on it.
const doc = {
  format: "hycanvas.design", schemaVersion: 29, id: "d", title: "Sticker", unit: "px", dpi: 96, assets: [], fonts: [], meta: {},
  pages: [{
    id: "p", width: 200, height: 100,
    background: { type: "solid", color: { srgb: { r: 1, g: 0, b: 0, a: 1 } } },
    children: [{
      id: "s", type: "shape", shape: "rect", transform: { x: 50, y: 25, scaleX: 1, scaleY: 1, rotation: 0 }, size: { width: 50, height: 50 },
      opacity: 1, blendMode: "normal", fills: [{ type: "solid", color: { srgb: { r: 0, g: 0, b: 1, a: 1 } } }],
    }],
  }],
} as unknown as DesignFile;

const RED_PDF = /(^|\s)1 0 0 rg/m;
const BLUE_PDF = /(^|\s)0 0 1 rg/m;
const RED_SVG = /#ff0000|rgb\(255, ?0, ?0\)/i;
const BLUE_SVG = /#0000ff|rgb\(0, ?0, ?255\)/i;

// jsdom has no canvas: a stand-in that reads colours back as given, as the other export tests use.
beforeAll(async () => {
  globalThis.Blob = (await import("node:buffer")).Blob as unknown as typeof Blob;
  HTMLCanvasElement.prototype.getContext = function () {
    let style = "#000000";
    return { get fillStyle() { return style; }, set fillStyle(v: string) { style = v; } } as unknown as CanvasRenderingContext2D;
  } as typeof HTMLCanvasElement.prototype.getContext;
});

describe("leaving the page background out", () => {
  it("vector PDF: the background only when wanted, the elements always", async () => {
    const withBg = pdfContent(new Uint8Array(await (await exportVectorPdf(doc, [0])).blob.arrayBuffer()));
    const without = pdfContent(new Uint8Array(await (await exportVectorPdf(doc, [0], { noBackground: true })).blob.arrayBuffer()));
    expect(withBg).toMatch(RED_PDF);
    expect(withBg).toMatch(BLUE_PDF);
    expect(without).not.toMatch(RED_PDF);
    expect(without).toMatch(BLUE_PDF);
  });

  it("accessible PDF too", async () => {
    const without = pdfContent(new Uint8Array(await (await exportVectorPdf(doc, [0], { tagged: true, noBackground: true })).blob.arrayBuffer()));
    expect(without).not.toMatch(RED_PDF);
    expect(without).toMatch(BLUE_PDF);
  });

  it("SVG", async () => {
    const withBg = await exportVectorSvg(doc, 0);
    const without = await exportVectorSvg(doc, 0, { noBackground: true });
    expect(withBg).toMatch(RED_SVG);
    expect(without).not.toMatch(RED_SVG);
    expect(without).toMatch(BLUE_SVG);
  });
});
