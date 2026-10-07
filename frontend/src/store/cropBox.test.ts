// Cropping an element that the image crop does not cover (store.cropBox):
// content stays where it is on the page whatever its scale or rotation,
// nothing is lost, and one undo restores the original.

import { beforeEach, describe, expect, it } from "vitest";
import { fromTransform, multiply, type Mat2D } from "@hc/engine";
import { useEditor } from "./editor";
import type { Node, Transform } from "@hc/schema";

const T = (x: number, y: number, extra: Partial<Transform> = {}): Transform => ({ x, y, scaleX: 1, scaleY: 1, rotation: 0, ...extra });

const rect = (id: string, t: Transform): Node => ({
  id, type: "shape", shape: "rect", transform: t,
  size: { width: 100, height: 80 }, opacity: 1, blendMode: "normal",
  fills: [{ type: "solid", color: { srgb: { r: 1, g: 0, b: 0, a: 1 } } }],
} as unknown as Node);

const page = () => {
  const st = useEditor.getState();
  return st.doc.pages[st.activePage];
};
type G = Node & { clip?: boolean; children: Node[] };

/** Page position of a node's local corner, through every ancestor. */
function corner(chain: Node[], px: number, py: number) {
  let m: Mat2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  for (const n of chain) m = multiply(m, fromTransform(n.transform));
  return { x: m.a * px + m.c * py + m.e, y: m.b * px + m.d * py + m.f };
}
const close = (p: { x: number; y: number }, q: { x: number; y: number }) => {
  expect(p.x).toBeCloseTo(q.x, 6);
  expect(p.y).toBeCloseTo(q.y, 6);
};

function setup(rTransform: Transform, gTransform: Transform = T(300, 0)) {
  const p = page();
  p.children.length = 0;
  p.children.push(rect("r", rTransform));
  p.children.push({
    id: "g", type: "group", transform: gTransform,
    size: { width: 120, height: 100 }, opacity: 1, blendMode: "normal",
    children: [rect("a", T(0, 0)), rect("b", T(20, 20))],
  } as unknown as Node);
  useEditor.setState({ selection: ["r"], undoStack: [], redoStack: [] });
}

beforeEach(() => setup(T(50, 40)));

describe("cropping a single element", () => {
  it("wraps it in a clipping group with the crop box, content unmoved", () => {
    useEditor.getState().cropBox("r", { x: 10, y: 10, width: 40, height: 30 });
    const g = page().children[0] as G;
    expect(g.type).toBe("group");
    expect(g.clip).toBe(true);
    expect(g.transform).toMatchObject({ x: 60, y: 50 });
    expect(g.size).toEqual({ width: 40, height: 30 });
    const r = g.children[0];
    expect(r.id).toBe("r");
    close(corner([g, r], 0, 0), { x: 50, y: 40 });
    expect(r.size).toEqual({ width: 100, height: 80 });
    expect(useEditor.getState().selection).toEqual([g.id]);
  });

  it("keeps a rotated, scaled element exactly in place", () => {
    const t = T(50, 40, { rotation: 30, scaleX: 1.5, scaleY: 0.8 });
    setup(t);
    const before = [[0, 0], [100, 0], [100, 80], [0, 80]].map(([x, y]) => corner([rect("x", t)], x, y));
    useEditor.getState().cropBox("r", { x: 10, y: 5, width: 50, height: 40 });
    const g = page().children[0] as G;
    expect(g.transform).toMatchObject({ rotation: 30, scaleX: 1.5, scaleY: 0.8 });
    const r = g.children[0];
    [[0, 0], [100, 0], [100, 80], [0, 80]].forEach(([x, y], i) => close(corner([g, r], x, y), before[i]));
  });

  it("undoes in one step", () => {
    useEditor.getState().cropBox("r", { x: 10, y: 10, width: 40, height: 30 });
    useEditor.getState().undo();
    const r = page().children[0];
    expect(r.id).toBe("r");
    expect(r.transform).toEqual(T(50, 40));
    expect(useEditor.getState().selection).toEqual(["r"]);
  });

  it("does nothing when the box is unchanged", () => {
    useEditor.getState().cropBox("r", { x: 0, y: 0, width: 100, height: 80 });
    expect(page().children[0].id).toBe("r");
    expect(useEditor.getState().undoStack).toHaveLength(0);
  });
});

describe("cropping a group", () => {
  it("clips the group itself and keeps its children on the page", () => {
    useEditor.getState().cropBox("g", { x: 10, y: 10, width: 60, height: 50 });
    const g = page().children[1] as G;
    expect(g.id).toBe("g");
    expect(g.clip).toBe(true);
    expect(g.transform).toMatchObject({ x: 310, y: 10 });
    expect(g.size).toEqual({ width: 60, height: 50 });
    close(corner([g, g.children[0]], 0, 0), { x: 300, y: 0 });
    close(corner([g, g.children[1]], 0, 0), { x: 320, y: 20 });
  });

  it("works on a resized (scaled) group", () => {
    // A group resized with the handles carries scale; that used to make the
    // crop overlay give up silently.
    setup(T(50, 40), T(300, 0, { scaleX: 1.12, scaleY: 1.05 }));
    const g0 = page().children[1] as G;
    const before = corner([g0, g0.children[1]], 0, 0);
    useEditor.getState().cropBox("g", { x: 15, y: 10, width: 60, height: 50 });
    const g = page().children[1] as G;
    expect(g.transform.x).toBeCloseTo(300 + 15 * 1.12, 6);
    expect(g.transform.y).toBeCloseTo(10 * 1.05, 6);
    close(corner([g, g.children[1]], 0, 0), before);
  });

  it("can be widened again later, back to everything", () => {
    useEditor.getState().cropBox("g", { x: 10, y: 10, width: 60, height: 50 });
    useEditor.getState().cropBox("g", { x: -10, y: -10, width: 120, height: 100 });
    const g = page().children[1] as G;
    expect(g.children.map((c) => [c.transform.x, c.transform.y])).toEqual([[0, 0], [20, 20]]);
    useEditor.getState().undo();
    useEditor.getState().undo();
    const back = page().children[1] as G;
    expect(back.clip).toBeUndefined();
    expect(back.transform).toMatchObject({ x: 300, y: 0 });
    expect(back.children.map((c) => [c.transform.x, c.transform.y])).toEqual([[0, 0], [20, 20]]);
  });
});
