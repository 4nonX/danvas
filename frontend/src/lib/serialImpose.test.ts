// @vitest-environment jsdom
// Serial print into several-on-a-sheet (F46 + F45): rows become pages, and
// the pages fill the sheets in row order.
import { beforeAll, describe, expect, it } from "vitest";
import { createNode, type DesignFile, type Node } from "@hc/schema";
import { buildBarcode, defaultSpec, loadBarcode } from "./barcode";
import { mergeRows } from "./serialPrint";
import { defaultImposeSettings } from "./print/impose";
import { exportVectorPdf } from "./vectorPdf";

beforeAll(async () => {
  globalThis.Blob = (await import("node:buffer")).Blob as unknown as typeof Blob;
  HTMLCanvasElement.prototype.getContext = function () {
    let style = "#000000";
    return { get fillStyle() { return style; }, set fillStyle(v: string) { style = v; } } as unknown as CanvasRenderingContext2D;
  } as typeof HTMLCanvasElement.prototype.getContext;
});

const mm = (v: number) => (v / 25.4) * 96;

describe("serial print on sheets", () => {
  it("puts 25 labels on 3 A4 sheets in row order, each with its own code", async () => {
    const mod = await loadBarcode();
    const spec = { ...defaultSpec(mod, "code128", "TEMPLATE"), text: false };
    const b = buildBarcode(mod, spec, 96);
    if (!b.ok) throw new Error("code");
    const code = createNode("group", { id: "code", name: "Charge", transform: { x: 10, y: 10, scaleX: 1, scaleY: 1, rotation: 0 }, size: { width: b.width, height: b.height }, children: b.children, data: { barcode: spec } } as Partial<Node>);
    const doc = {
      format: "hycanvas.design", schemaVersion: 29, id: "d", title: "Label", unit: "px", dpi: 96, assets: [], fonts: [], meta: {},
      pages: [{ id: "p", width: mm(90), height: mm(50), children: [code] }],
    } as unknown as DesignFile;
    const rows = Array.from({ length: 25 }, (_, i) => [`CH-${String(i + 1).padStart(3, "0")}`]);
    const merged = await mergeRows(doc, { headers: ["Charge"], rows }, { code: "Charge" });
    expect(merged.rows).toBe(25);
    const out = await exportVectorPdf(merged.doc, merged.doc.pages.map((_, i) => i), { print: false, impose: { settings: { ...defaultImposeSettings(), on: true, fill: "sequence" }, sheetMm: [210, 297] } });
    const text = Buffer.from(new Uint8Array(await out.blob.arrayBuffer())).toString("latin1");
    expect(text.match(/\/Type \/Page /g)?.length).toBe(3);
    expect(text.match(/\/Subtype \/Form/g)?.length).toBe(25);
  });
});
