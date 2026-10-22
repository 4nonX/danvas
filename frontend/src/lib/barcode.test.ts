/**
 * @vitest-environment jsdom
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createNode, validate, type DesignFile, type Node } from "@hc/schema";
import { createScene, renderScene, type CanvasLike } from "@hc/engine";
import { PdfCanvas, PdfResources } from "./vectorPdf/pdfCanvas";
import { barcodeOf, buildBarcode, defaultSpec, loadBarcode, type BarcodeSpec } from "./barcode";

const mod = await loadBarcode();

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

function barcodeGroup(spec: BarcodeSpec, id = "code", dpi = 96): Node {
  const built = buildBarcode(mod, spec, dpi);
  if (!built.ok) throw new Error(built.detail);
  return createNode("group", { id, transform: { x: 10, y: 10, scaleX: 1, scaleY: 1, rotation: 0 }, size: { width: built.width, height: built.height }, children: built.children, data: { barcode: spec } } as Partial<Node>);
}

function design(children: Node[]): DesignFile {
  return { format: "hycanvas.design", schemaVersion: 29, id: "d", title: "D", unit: "px", dpi: 96, measureUnit: "mm", assets: [], fonts: [], meta: {}, pages: [{ id: "p", width: 600, height: 300, children }] } as unknown as DesignFile;
}

/** The content stream of a CMYK print PDF of the page (stub profile: every
 *  colour without print values becomes 0.5/0.5/0.5/0.5). */
function pdfOps(doc: DesignFile): string {
  const res = new PdfResources();
  const ctx = new PdfCanvas({ width: 600, height: 300, faces: new Map(), resources: res, color: { cmyk: () => [0.5, 0.5, 0.5, 0.5], blackOnly: true } });
  renderScene(createScene(doc, 0), ctx as unknown as CanvasLike, { width: 600, height: 300, zoom: 1, panX: 0, panY: 0, dpr: 1 }, { clear: false, cull: false });
  return ctx.content();
}

describe("barcode groups", () => {
  it("are a path with one contour per bar and a text node per digit", () => {
    const spec = defaultSpec(mod, "ean13", "400638133393");
    const g = barcodeGroup(spec) as Node & { children: Node[] };
    const path = g.children.find((c) => c.type === "path") as unknown as { segments: unknown[]; contours: unknown[]; fills: { color: unknown }[] };
    expect(1 + path.contours.length).toBe(30);
    expect(path.fills[0].color).toEqual({ srgb: { r: 0, g: 0, b: 0, a: 1 }, cmyk: { c: 0, m: 0, y: 0, k: 1 } });
    expect(g.children.filter((c) => c.type === "text").length).toBe(13);
    // 11 + 95 + 7 modules of 0.33 mm at 96 dpi.
    expect(g.size.width).toBeCloseTo((113 * 0.33 / 25.4) * 96, 6);
    expect(barcodeOf(g)?.value).toBe("400638133393");
  });

  it("validate as an ordinary design, so every release opens them", () => {
    const doc = design([barcodeGroup(defaultSpec(mod, "pzn", "0471114")), barcodeGroup(defaultSpec(mod, "gs1datamatrix", "(01)04150123456782(17)271231(10)ABC"), "code2")]);
    const r = validate(JSON.parse(JSON.stringify(doc)));
    expect(r.ok ? "ok" : `${(r as { pointer?: string }).pointer}: ${(r as { message?: string }).message}`).toBe("ok");
  });

  it("print as filled vector paths in black ink only, without strokes or images", () => {
    const spec = { ...defaultSpec(mod, "code128", "Charge 4711"), text: false };
    const ops = pdfOps(design([barcodeGroup(spec)]));
    expect(ops).toMatch(/0 0 0 1 k/);
    // Nothing went through the profile, nothing was stroked or placed as an image.
    expect(ops).not.toMatch(/0\.5 0\.5 0\.5 0\.5 k/);
    expect(ops).not.toMatch(/\bS\b/);
    expect(ops).not.toMatch(/\bDo\b/);
    expect(ops).toMatch(/\bf\*/);
  });

  it("draw the same without their barcode data (as an older release sees them)", () => {
    const spec = { ...defaultSpec(mod, "datamatrix", "Charge 0815 / 12.2027"), text: false };
    const g = barcodeGroup(spec);
    const plain = JSON.parse(JSON.stringify(g)) as Node;
    delete (plain as { data?: unknown }).data;
    const ops = pdfOps(design([g]));
    expect(ops).toMatch(/0 0 0 1 k/);
    expect(pdfOps(design([plain]))).toBe(ops);
  });

  it("refuse an invalid value", () => {
    const r = buildBarcode(mod, defaultSpec(mod, "ean13", "4006381333932"), 96);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe("check_digit");
  });
});
