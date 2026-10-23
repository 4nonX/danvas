import { describe, expect, it } from "vitest";
import { createBlankDesign, createNode, repairContainers, repairCornerRadius, validate } from "../index";
import type { GroupNode, ShapeNode } from "../schema";

function deckWithNumericRadius() {
  const file = createBlankDesign({ title: "legacy", width: 1920, height: 1080 });
  const rule = createNode("shape", { name: "Accent", shape: "rect" }) as ShapeNode;
  (rule as unknown as { cornerRadius: unknown }).cornerRadius = 4;
  const inner = createNode("shape", { name: "Panel", shape: "rect" }) as ShapeNode;
  (inner as unknown as { cornerRadius: unknown }).cornerRadius = 30;
  const group = createNode("group", { name: "Card", children: [inner] }) as GroupNode;
  const plain = createNode("shape", { name: "Square", shape: "rect" }) as ShapeNode;
  file.pages[0].children.push(rule, group, plain);
  return { file, rule, inner, plain };
}

describe("repairCornerRadius", () => {
  it("turns a bare-number radius into the per-corner record, through groups, and leaves the rest alone", () => {
    const { file, rule, inner, plain } = deckWithNumericRadius();
    expect(validate(file).ok).toBe(false);
    const out = repairCornerRadius(file);
    expect(out).toBe(file); // in place
    expect(rule.cornerRadius).toEqual({ topLeft: 4, topRight: 4, bottomRight: 4, bottomLeft: 4 });
    expect(inner.cornerRadius).toEqual({ topLeft: 30, topRight: 30, bottomRight: 30, bottomLeft: 30 });
    expect(plain.cornerRadius).toBeUndefined();
    expect(validate(file).ok).toBe(true);
  });

  it("is idempotent and keeps unknown keys on the node", () => {
    const { file, rule } = deckWithNumericRadius();
    (rule as unknown as { futureKey: string }).futureKey = "kept";
    repairCornerRadius(repairCornerRadius(file));
    expect(rule.cornerRadius).toEqual({ topLeft: 4, topRight: 4, bottomRight: 4, bottomLeft: 4 });
    expect((rule as unknown as { futureKey: string }).futureKey).toBe("kept");
  });
});

describe("repairContainers", () => {
  it("gives a group, frame or grid without children an empty list, also nested, and keeps everything else", () => {
    const file = createBlankDesign({ title: "t", width: 100, height: 100 });
    const broken = { id: "g", type: "group", name: "Symbol", transform: { x: 1, y: 2, scaleX: 1, scaleY: 1, rotation: 0 }, size: { width: 10, height: 10 }, opacity: 1, blendMode: "normal" };
    const outer = { ...broken, id: "outer", children: [{ ...broken, id: "inner" }] };
    file.pages[0].children.push(broken as never, outer as never);
    const out = repairContainers(file);
    expect(out).toBe(file);
    const [g, o] = file.pages[0].children as unknown as { id: string; name: string; children: { children: unknown[] }[] }[];
    expect(g.children).toEqual([]);
    expect(g.name).toBe("Symbol");
    expect(o.children[0].children).toEqual([]);
    expect(validate(file).ok).toBe(true);
    // Idempotent, and a sound file is left as it is.
    const again = JSON.stringify(file);
    expect(JSON.stringify(repairContainers(file))).toBe(again);
  });
});
