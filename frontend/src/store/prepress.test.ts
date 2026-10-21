// Prepress in the editor: exact page sizes (no rounding to whole px), the
// design's measurement unit, the design's colour profile showing exact print
// colours anew (print values untouched, one undo), and print colours kept by
// group recolouring and brand colours.

import { describe, it, expect } from "vitest";
import { createBlankDesign, createNode, type Color, type Node, type ShapeNode } from "@hc/schema";
import type { BrandKit } from "@hc/sdk";
import { useEditor } from "./editor";
import { brandColorOf } from "./brand";
import { recolor } from "@/lib/selectionColors";
import { cmykColor, printColorLabel, spotColor, spotNamesOf } from "@/lib/print/printColor";
import { fromUnit } from "@/lib/units";

const blue: Color = { srgb: { r: 0, g: 0.5, b: 0.8, a: 1 }, cmyk: { c: 0.73, m: 0.25, y: 0.07, k: 0 } };

function rect(id: string, color: Color): Node {
  return createNode("shape", { id, shape: "rect", transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, size: { width: 10, height: 10 }, fills: [{ type: "solid", color }] } as never);
}

function load(nodes: Node[]) {
  const doc = createBlankDesign({ title: "t", width: 100, height: 100 });
  doc.pages[0].children.push(...nodes);
  useEditor.getState().loadDoc(doc);
}

const fillOf = (id: string) => ((useEditor.getState().doc.pages[0].children.find((n) => n.id === id) as ShapeNode).fills[0] as { color: Color }).color;

describe("exact sizes and the measurement unit", () => {
  it("keeps a page size given in mm exactly, and undoes it", () => {
    load([]);
    const st = useEditor.getState();
    st.setPageSize(fromUnit(50, "mm", 96), fromUnit(100, "mm", 96));
    const p = useEditor.getState().doc.pages[0];
    expect(p.width).toBeCloseTo((50 / 25.4) * 96, 12);
    expect(p.height).toBeCloseTo((100 / 25.4) * 96, 12);
    expect(Number.isInteger(p.width)).toBe(false);
    st.undo();
    expect(useEditor.getState().doc.pages[0].width).toBe(100);
  });

  it("sets the unit on the file, and px removes it", () => {
    load([]);
    useEditor.getState().setMeasureUnit("mm");
    expect(useEditor.getState().doc.measureUnit).toBe("mm");
    useEditor.getState().setMeasureUnit("px");
    expect("measureUnit" in useEditor.getState().doc).toBe(false);
  });
});

describe("the design's colour profile", () => {
  it("shows print colours anew through it, keeps the print values, and undoes in one step", () => {
    load([rect("a", blue), rect("b", { srgb: { r: 1, g: 0, b: 0, a: 1 } })]);
    const st = useEditor.getState();
    st.setColorProfile("profile-1", () => ({ r: 0.1, g: 0.2, b: 0.3 }));
    expect(useEditor.getState().doc.colorProfile).toBe("profile-1");
    expect(fillOf("a").srgb).toEqual({ r: 0.1, g: 0.2, b: 0.3, a: 1 });
    expect(fillOf("a").cmyk).toEqual(blue.cmyk);
    // A colour without print values is left alone.
    expect(fillOf("b").srgb).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    st.undo();
    expect(useEditor.getState().doc.colorProfile).toBeUndefined();
    expect(fillOf("a").srgb).toEqual(blue.srgb);
  });
});

describe("print colours survive recolouring and brand colours", () => {
  it("recolours a group with the new colour's print values", () => {
    const nodes = [rect("a", { srgb: { r: 1, g: 0, b: 0, a: 0.5 } })];
    // Same opacity as before: each slot keeps its own (the picker's opacity
    // slider is what changes it for all).
    const undo = recolor(nodes, "#ff0000", spotColor("HKS 44", { c: 1, m: 0, y: 0.7, k: 0.1 }, 0.5));
    const c = ((nodes[0] as ShapeNode).fills[0] as { color: Color }).color;
    expect(c.spot?.name).toBe("HKS 44");
    expect(c.srgb.a).toBe(0.5);
    undo?.();
    expect(((nodes[0] as ShapeNode).fills[0] as { color: Color }).color.spot).toBeUndefined();
  });

  it("applies a brand colour with its print values", () => {
    const kit = { palettes: [{ id: "p", name: "P", colors: [{ id: "s", role: "accent", value: { srgb: { r: 0, g: 0, b: 1, a: 1 }, cmyk: { c: 1, m: 0.7, y: 0, k: 0 } } }] }] } as unknown as BrandKit;
    expect(brandColorOf(kit, "#0000ff").cmyk).toEqual({ c: 1, m: 0.7, y: 0, k: 0 });
    expect(brandColorOf(kit, "#00ff00")).toEqual({ srgb: { r: 0, g: 1, b: 0, a: 1 } });
  });
});

describe("print colour helpers", () => {
  it("makes and names exact and spot colours", () => {
    const c = cmykColor({ c: 0.73, m: 0.25, y: 0.07, k: 0 });
    expect(c.cmyk).toEqual({ c: 0.73, m: 0.25, y: 0.07, k: 0 });
    expect(printColorLabel(c)).toBe("C73 M25 Y7 K0");
    const s = spotColor("Weiß", { c: 0, m: 0, y: 0, k: 0 }, 0.5);
    expect(printColorLabel(s)).toBe("Weiß");
    expect(s.srgb.a).toBe(0.5);
    expect(printColorLabel({ srgb: { r: 0, g: 0, b: 0, a: 1 } })).toBeNull();
  });

  it("lists the spot colours a design uses, each once", () => {
    const doc = createBlankDesign();
    doc.pages[0].children.push(rect("a", spotColor("HKS 44", { c: 1, m: 0, y: 0.7, k: 0.1 })), rect("b", spotColor("HKS 44", { c: 1, m: 0, y: 0.7, k: 0.1 })), rect("c", spotColor("Lack", { c: 0, m: 0, y: 0, k: 0 })), rect("d", blue));
    expect(spotNamesOf(doc)).toEqual(["HKS 44", "Lack"]);
  });
});
