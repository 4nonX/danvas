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

describe("turning the crop frame", () => {
  const corners = [[0, 0], [100, 0], [100, 80], [0, 80]];
  // The frame's page corners: the turned rectangle in the element's own
  // coordinates, through the element's transform.
  const framePage = (t: Transform, f: { x: number; y: number; w: number; h: number }, deg: number) => {
    const c = { x: f.x + f.w / 2, y: f.y + f.h / 2 };
    const r = (deg * Math.PI) / 180;
    return [[-f.w / 2, -f.h / 2], [f.w / 2, -f.h / 2], [f.w / 2, f.h / 2], [-f.w / 2, f.h / 2]].map(([x, y]) =>
      corner([rect("x", t)], c.x + Math.cos(r) * x - Math.sin(r) * y, c.y + Math.sin(r) * x + Math.cos(r) * y));
  };

  for (const [label, t] of [
    ["an unturned element", T(50, 40)],
    ["a turned, evenly scaled element", T(50, 40, { rotation: 18.35, scaleX: 1.488, scaleY: 1.488 })],
    ["a mirrored element", T(50, 40, { rotation: 10, scaleX: -1.2, scaleY: 1.2 })],
  ] as const) {
    it(`turns the frame on ${label}, the content stays put`, () => {
      // A copy goes into the document: the crop rewrites that transform.
      setup({ ...t });
      const before = corners.map(([x, y]) => corner([rect("x", t)], x, y));
      const f = { x: 10, y: 5, w: 50, h: 40 };
      useEditor.getState().cropBox("r", { x: f.x, y: f.y, width: f.w, height: f.h }, -25);
      const g = page().children[0] as G;
      const r = g.children[0];
      corners.forEach(([x, y], i) => close(corner([g, r], x, y), before[i]));
      const want = framePage(t, f, -25);
      [[0, 0], [50, 0], [50, 40], [0, 40]].forEach(([x, y], i) => close(corner([g], x, y), want[i]));
    });
  }

  it("turns a group's frame and keeps every child on the page", () => {
    const gt = T(300, 0, { rotation: 18.35, scaleX: 1.488, scaleY: 1.488 });
    setup(T(50, 40), gt);
    const g0 = page().children[1] as G;
    const before = g0.children.map((c) => corners.map(([x, y]) => corner([g0, c], x, y)));
    useEditor.getState().cropBox("g", { x: 15, y: 10, width: 60, height: 50 }, 30);
    const g = page().children[1] as G;
    expect(g.clip).toBe(true);
    expect(g.transform.rotation).toBeCloseTo(48.35, 6);
    g.children.forEach((c, k) => corners.forEach(([x, y], i) => close(corner([g, c], x, y), before[k][i])));
    useEditor.getState().undo();
    const back = page().children[1] as G;
    expect(back.transform).toEqual(gt);
    expect(back.children.map((c) => c.transform)).toEqual([T(0, 0), T(20, 20)]);
  });

  // A frame on the page, by its centre, size and angle: the page corners it
  // must end up at, clockwise from its top-left.
  const pageRect = (cx: number, cy: number, w: number, h: number, deg: number) => {
    const r = (deg * Math.PI) / 180;
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => ({
      x: cx + Math.cos(r) * x - Math.sin(r) * y, y: cy + Math.sin(r) * x + Math.cos(r) * y,
    }));
  };
  const cropOnPage = (id: string, cx: number, cy: number, w: number, h: number, deg: number) =>
    useEditor.getState().cropFrame(id, { x: cx - w / 2, y: cy - h / 2, width: w, height: h, angle: deg });

  for (const [label, t] of [
    ["a stretched, turned element", T(50, 40, { rotation: 30, scaleX: 1.5, scaleY: 0.8 })],
    ["a skewed element", T(50, 40, { rotation: -12, scaleX: 1.1, scaleY: 0.9, skewX: 14 })],
    ["an evenly scaled element", T(50, 40, { rotation: 18.35, scaleX: 1.488, scaleY: 1.488 })],
    ["a mirrored, stretched element", T(50, 40, { rotation: 5, scaleX: -1.3, scaleY: 0.7 })],
  ] as const) {
    it(`turns a frame on the page independently on ${label}`, () => {
      setup({ ...t });
      const before = corners.map(([x, y]) => corner([rect("x", t)], x, y));
      cropOnPage("r", 90, 80, 50, 30, 7);
      const g = page().children[0] as G;
      expect(g.clip).toBe(true);
      const r = g.children[0];
      corners.forEach(([x, y], i) => close(corner([g, r], x, y), before[i]));
      const want = pageRect(90, 80, 50, 30, 7);
      [[0, 0], [g.size.width, 0], [g.size.width, g.size.height], [0, g.size.height]].forEach(([x, y], i) => close(corner([g], x, y), want[i]));
      useEditor.getState().undo();
      expect(page().children[0].transform).toEqual(t);
    });
  }

  it("turns the frame of a group inside a stretched group", () => {
    const p = page();
    p.children.length = 0;
    const inner = {
      id: "g", type: "group", transform: T(10, 5, { rotation: 20 }),
      size: { width: 120, height: 100 }, opacity: 1, blendMode: "normal",
      children: [rect("a", T(0, 0)), rect("b", T(20, 20, { rotation: 15 }))],
    } as unknown as Node;
    const outer = {
      id: "o", type: "group", transform: T(200, 50, { scaleX: 1.8, scaleY: 0.6, rotation: 10 }),
      size: { width: 300, height: 300 }, opacity: 1, blendMode: "normal", children: [inner],
    } as unknown as G;
    p.children.push(outer);
    useEditor.setState({ selection: ["g"], undoStack: [], redoStack: [] });
    const kids = (inner as G).children;
    const before = kids.map((c) => corners.map(([x, y]) => corner([outer, inner, c], x, y)));
    cropOnPage("g", 300, 120, 80, 60, -33);
    const g = outer.children[0] as G;
    g.children.forEach((c, k) => corners.forEach(([x, y], i) => close(corner([outer, g, c], x, y), before[k][i])));
    const want = pageRect(300, 120, 80, 60, -33);
    [[0, 0], [80, 0], [80, 60], [0, 60]].forEach(([x, y], i) => close(corner([outer, g], x, y), want[i]));
  });

  it("is a plain crop when the frame lies along the element's edges", () => {
    const t = T(50, 40, { rotation: 30, scaleX: 1.5, scaleY: 0.8 });
    setup(t);
    const c = corner([rect("x", t)], 50, 40);
    cropOnPage("r", c.x, c.y, 60, 32, 30);
    const g = page().children[0] as G;
    expect(g.transform).toMatchObject({ rotation: 30, scaleX: 1.5, scaleY: 0.8 });
    expect(g.size.width).toBeCloseTo(40, 6);
    expect(g.size.height).toBeCloseTo(40, 6);
  });
});
