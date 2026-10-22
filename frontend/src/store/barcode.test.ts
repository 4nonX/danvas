// Barcodes in the editor (F43): inserting, changing and scaling with the
// handles each encode the code again in one undo step, and an invalid value
// changes nothing.

import { beforeEach, describe, expect, it } from "vitest";
import { createBlankDesign, type Node } from "@hc/schema";
import { useEditor } from "./editor";
import { barcodeOf, defaultSpec, loadBarcode } from "@/lib/barcode";

const mod = await loadBarcode();
type Group = Node & { children: Node[] };
const code = () => useEditor.getState().doc.pages[0].children.find((n) => barcodeOf(n)) as Group | undefined;
const bars = (g: Group) => g.children.find((c) => c.type === "path") as unknown as { contours: unknown[] };

describe("barcodes in the editor", () => {
  beforeEach(() => {
    useEditor.getState().loadDoc(createBlankDesign({ title: "t", width: 800, height: 600 }));
  });

  it("inserts a barcode as one selected group", async () => {
    const err = await useEditor.getState().insertBarcode(defaultSpec(mod, "ean13", "400638133393"));
    expect(err).toBeNull();
    const g = code()!;
    expect(useEditor.getState().selection).toEqual([g.id]);
    expect(1 + bars(g).contours.length).toBe(30);
    useEditor.getState().undo();
    expect(code()).toBeUndefined();
  });

  it("encodes again on a change, undoable, and refuses an invalid value", async () => {
    await useEditor.getState().insertBarcode(defaultSpec(mod, "code128", "A"));
    const g = code()!;
    const width = g.size.width;
    expect(await useEditor.getState().updateBarcode(g.id, { ...barcodeOf(g)!, value: "Charge 2026-0815" })).toBeNull();
    expect(barcodeOf(code())!.value).toBe("Charge 2026-0815");
    expect(code()!.size.width).toBeGreaterThan(width);
    const err = await useEditor.getState().updateBarcode(g.id, { ...barcodeOf(code())!, symbology: "ean13", value: "4006381333932" });
    expect(err?.code).toBe("check_digit");
    expect(barcodeOf(code())!.value).toBe("Charge 2026-0815");
    useEditor.getState().undo();
    expect(barcodeOf(code())!.value).toBe("A");
    expect(code()!.size.width).toBeCloseTo(width, 9);
  });

  it("turns a scale from the handles into module width and bar height", async () => {
    await useEditor.getState().insertBarcode(defaultSpec(mod, "pzn", "0471114"));
    const g = code()!;
    g.transform.scaleX = 2;
    g.transform.scaleY = 1.5;
    await useEditor.getState().bakeBarcodeScale(g.id);
    const after = code()!;
    expect(after.transform.scaleX).toBe(1);
    expect(after.transform.scaleY).toBe(1);
    expect(barcodeOf(after)!.moduleMm).toBeCloseTo(0.5, 9);
    expect(barcodeOf(after)!.barHeightMm).toBeCloseTo(15, 9);
  });
});
