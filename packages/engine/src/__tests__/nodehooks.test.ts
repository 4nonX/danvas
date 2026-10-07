// Recording targets (the tagged PDF) learn which element a drawing call
// belongs to from onNodeEnter/onNodeExit, which bracket each visible node's
// drawing, its subtree included.

import { describe, expect, it } from "vitest";
import { createScene } from "../scene";
import { renderScene } from "../render2d";
import type { DesignFile, Node } from "@hc/schema";

const rect = (id: string, x: number, extra: Record<string, unknown> = {}): Node => ({
  id, type: "shape", shape: "rect",
  transform: { x, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  size: { width: 50, height: 50 }, opacity: 1, blendMode: "normal",
  fills: [{ type: "solid", color: { srgb: { r: 1, g: 0, b: 0, a: 1 } } }],
  ...extra,
} as unknown as Node);

const group: Node = {
  id: "g", type: "group",
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  size: { width: 200, height: 100 }, opacity: 1, blendMode: "normal",
  children: [rect("a", 0), rect("b", 60)],
} as unknown as Node;

const file = {
  schemaVersion: 19, id: "d", title: "t", assets: [], fonts: [], meta: {},
  pages: [{ id: "p1", width: 400, height: 200, children: [group, rect("hidden", 100, { hidden: true }), rect("c", 200)] }],
} as unknown as DesignFile;

function trace(): string[] {
  const out: string[] = [];
  const noop = () => {};
  const ctx = new Proxy({ canvas: { width: 400, height: 200 }, measureText: () => ({ width: 0 }), createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }), createPattern: () => null } as Record<string, unknown>, {
    get: (t, k) => (k === "fillRect" || k === "fill" ? () => { out.push("draw"); } : k in t ? t[k as string] : noop),
    set: (t, k, v) => { t[k as string] = v; return true; },
  });
  renderScene(createScene(file, 0), ctx as never, { zoom: 1, panX: 0, panY: 0, dpr: 1, width: 400, height: 200 }, {
    onNodeEnter: (n) => out.push(`+${n.id}`),
    onNodeExit: (n) => out.push(`-${n.id}`),
  });
  return out;
}

describe("node enter/exit hooks", () => {
  it("bracket every visible node, children nested inside their parent", () => {
    const t = trace().filter((s) => s !== "draw");
    expect(t).toEqual(["+g", "+a", "-a", "+b", "-b", "-g", "+c", "-c"]);
  });

  it("put each node's drawing between its own enter and exit", () => {
    const t = trace();
    const between = (id: string) => t.slice(t.indexOf(`+${id}`) + 1, t.indexOf(`-${id}`));
    expect(between("a")).toContain("draw");
    expect(between("c")).toContain("draw");
  });
});
