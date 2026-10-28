// @vitest-environment jsdom
// Print roles of elements: kept in their data, the artwork without die line
// elements, the die line page, and both roles in the PDF and EPS writers.
import { beforeAll, describe, expect, it } from "vitest";
import type { DesignFile, Node } from "@hc/schema";
import { createScene, renderScene, type CanvasLike } from "@hc/engine";
import { dieLinePage, hasDieLines, hasOverprint, isOverprint, printRoleOf, withoutDieLines, withPrintRole } from "./nodePrint";
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

const T = (x: number, y: number) => ({ x, y, scaleX: 1, scaleY: 1, rotation: 0 });
const solid = (r: number, g: number, b: number, extra: Record<string, unknown> = {}) => ({ type: "solid", color: { srgb: { r, g, b, a: 1 }, ...extra } });
const rect = (id: string, x: number, extra: Record<string, unknown> = {}) => ({ id, type: "shape", shape: "rect", transform: T(x, 0), size: { width: 10, height: 10 }, opacity: 1, blendMode: "normal", fills: [solid(0.2, 0.4, 0.6)], ...extra }) as unknown as Node;
const doc = (children: Node[]) => ({ format: "hycanvas.design", schemaVersion: 29, id: "d", title: "D", unit: "px", dpi: 96, assets: [], fonts: [], meta: {}, pages: [{ id: "p", width: 100, height: 100, background: solid(1, 1, 1), children }] }) as unknown as DesignFile;

describe("print roles in the data", () => {
  it("sets and clears a role, keeping the node's other data", () => {
    const n = rect("a", 0, { data: { shapeText: { overflow: "grow" } } });
    const on = withPrintRole(n, { overprint: true });
    expect(on).toEqual({ shapeText: { overflow: "grow" }, print: { overprint: true } });
    n.data = on;
    expect(isOverprint(n)).toBe(true);
    n.data = withPrintRole(n, { dieLine: true, overprint: false });
    expect(printRoleOf(n)).toEqual({ dieLine: true });
    n.data = withPrintRole(n, { dieLine: false });
    expect(n.data).toEqual({ shapeText: { overflow: "grow" } });
    expect(withPrintRole(rect("b", 0), { overprint: false })).toBeUndefined();
  });

  it("reads only true as a role", () => {
    expect(printRoleOf(rect("a", 0, { data: { print: { overprint: "yes", dieLine: 1 } } }))).toEqual({});
  });
});

describe("die line elements", () => {
  const cut = rect("cut", 20, { data: { print: { dieLine: true } } });
  const group = { id: "g", type: "group", transform: T(50, 0), size: { width: 20, height: 20 }, opacity: 1, blendMode: "normal", children: [rect("inner", 0), rect("innerCut", 5, { data: { print: { dieLine: true } } })] } as unknown as Node;

  it("leaves the artwork without them, also inside groups", () => {
    const d = doc([rect("art", 0), cut, group]);
    expect(hasDieLines(d)).toBe(true);
    const art = withoutDieLines(d);
    expect(hasDieLines(art)).toBe(false);
    expect(art.pages[0].children.map((n) => n.id)).toEqual(["art", "g"]);
    expect((art.pages[0].children[1] as unknown as { children: Node[] }).children.map((n) => n.id)).toEqual(["inner"]);
    // The design itself is not changed, and one without any comes back as is.
    expect(d.pages[0].children).toHaveLength(3);
    const plain = doc([rect("art", 0)]);
    expect(withoutDieLines(plain)).toBe(plain);
  });

  it("draws them alone as hairlines, groups around them without their own paint", () => {
    const page = dieLinePage(doc([rect("art", 0), cut, group]).pages[0], 0.5)!;
    expect(page.background).toBeUndefined();
    expect(page.children.map((n) => n.id)).toEqual(["cut", "g"]);
    const c = page.children[0] as unknown as { fills: unknown[]; stroke: { width: number } };
    expect(c.fills).toEqual([]);
    expect(c.stroke.width).toBe(0.5);
    expect((page.children[1] as unknown as { children: Node[] }).children.map((n) => n.id)).toEqual(["innerCut"]);
    expect(dieLinePage(doc([rect("art", 0)]).pages[0], 0.5)).toBeNull();
  });
});

describe("overprinting elements in the vector writers", () => {
  /** Draw a design through PdfCanvas with the export's element hooks. */
  function draw(d: DesignFile, asSeparation: boolean) {
    const res = new PdfResources();
    const ctx = new PdfCanvas({ width: 100, height: 100, faces: new Map(), resources: res, color: { cmyk: () => [0.4, 0.3, 0, 0], blackOnly: true, overprintAsSeparation: asSeparation } });
    renderScene(createScene(d, 0), ctx as unknown as CanvasLike, { width: 100, height: 100, zoom: 1, panX: 0, panY: 0, dpr: 1 }, {
      clear: false, cull: false, skipBackground: true,
      onNodeEnter: (n) => ctx.printEnter(n, isOverprint(n)),
      onNodeExit: (n) => ctx.printExit(n),
    } as Parameters<typeof renderScene>[3]);
    return { ops: ctx.content(), res };
  }
  const op = rect("op", 30, { data: { print: { overprint: true } }, fills: [solid(0, 0.5, 1, { cmyk: { c: 0.6, m: 0, y: 0.2, k: 0 } })] });
  const d = doc([rect("knockout", 0), op, { id: "g", type: "group", transform: T(60, 0), size: { width: 10, height: 10 }, opacity: 1, blendMode: "normal", data: { print: { overprint: true } }, children: [rect("child", 0)] } as unknown as Node]);

  it("overprints with overprint mode 1 in a PDF: the element and everything inside one", () => {
    const { ops, res } = draw(d, false);
    expect(hasOverprint(d)).toBe(true);
    const states = [...res.extGStates.entries()];
    const on = states.find(([k]) => k.endsWith("|1"))![1];
    const off = states.find(([k]) => k.endsWith("|0"))![1];
    expect(res.extGStateDict()).toContain("/OP true /op true /OPM 1");
    const fills = ops.split("\n").filter((l) => / k$| k /.test(l) || l.includes(" gs "));
    // The plain rectangle knocks out; the overprinting one and the group's child do not.
    expect(fills.filter((l) => l.includes(`/${off} gs`))).toHaveLength(1);
    expect(fills.filter((l) => l.includes(`/${on} gs`))).toHaveLength(2);
    expect(ops).toMatch(/0\.6 0 0\.2 0 k/);
  });

  it("writes overprinting colours on the plates they use only, for PostScript", () => {
    const { ops, res } = draw(d, true);
    // Cyan and yellow (mask 1 + 4), and the converted child (cyan + magenta).
    expect([...res.deviceN.keys()].sort()).toEqual([3, 5]);
    expect(ops).toMatch(/\/DN5 cs 0\.6 0\.2 scn/);
    expect(ops).toMatch(/\/DN3 cs 0\.4 0\.3 scn/);
  });

  it("paints nothing for an overprinting colour without ink, in PostScript", () => {
    const white = doc([rect("w", 0, { data: { print: { overprint: true } }, fills: [solid(1, 1, 1, { cmyk: { c: 0, m: 0, y: 0, k: 0 } })] })]);
    const { res } = draw(white, true);
    expect([...res.spots.keys()]).toEqual(["None"]);
  });
});
