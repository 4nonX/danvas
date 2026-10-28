// Text in a shape through the store: putting text in, typing more than fits,
// resizing, changing the settings, and undoing each of them.
import { beforeEach, describe, expect, it } from "vitest";
import type { Node, Paragraph, TextNode } from "@hc/schema";
import { locate } from "@hc/editor";
import { shapeTextOf } from "@/lib/shapeText";
import { useEditor } from "./editor";

const kids = () => (useEditor.getState().doc.pages[0] as unknown as { children: Node[] }).children;

function seed() {
  const st = useEditor.getState();
  st.doc.pages.splice(1);
  kids().length = 0;
  useEditor.setState({ activePage: 0, selection: [], undoStack: [], redoStack: [] });
}
beforeEach(seed);

function rect(): string {
  const st = useEditor.getState();
  const id = st.addShapeAt(100, 80, "rect");
  const n = locate(st.doc, id)!.node;
  n.size = { width: 200, height: 60 };
  return id;
}

const para = (text: string): Paragraph[] => [{ runs: [{ text, style: { fontFamily: "system", fontStyle: "Regular", fontSize: 20 } }], style: { align: "center" } } as unknown as Paragraph];

describe("shape text in the store", () => {
  it("puts text in a shape in one undo step, keeping its place", () => {
    const id = rect();
    const st = useEditor.getState();
    const before = st.undoStack.length;
    const textId = st.addShapeText(id)!;
    expect(textId).toBeTruthy();
    const group = kids()[0];
    const parts = shapeTextOf(group)!;
    expect(parts.shape.id).toBe(id);
    expect(parts.text.id).toBe(textId);
    expect(group.transform.x).toBe(100);
    expect(group.transform.y).toBe(80);
    expect(parts.shape.transform.x).toBe(0);
    expect(useEditor.getState().undoStack.length).toBe(before + 1);
    // A second call finds the text that is there.
    expect(st.addShapeText(id)).toBe(textId);

    st.undo();
    expect(kids()).toHaveLength(1);
    expect(kids()[0].id).toBe(id);
    expect(kids()[0].transform.x).toBe(100);
  });

  it("grows the shape when the text needs more room, and undo shrinks it back", () => {
    const id = rect();
    const st = useEditor.getState();
    const textId = st.addShapeText(id)!;
    const long = para("Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.");
    st.setContent(textId, long, 400, 60);
    const parts = shapeTextOf(kids()[0])!;
    expect(parts.shape.size.height).toBeGreaterThan(60);
    expect(parts.text.box.height).toBeCloseTo(parts.shape.size.height);
    expect((kids()[0] as unknown as { size: { height: number } }).size.height).toBeCloseTo(parts.shape.size.height);

    st.undo();
    expect(shapeTextOf(kids()[0])!.shape.size.height).toBe(60);
  });

  it("keeps the shape's size when set to shrink the text, and undo restores the setting", () => {
    const id = rect();
    const st = useEditor.getState();
    const textId = st.addShapeText(id)!;
    const groupId = kids()[0].id;
    st.setShapeTextOptions(groupId, { overflow: "shrink", padding: { t: 4, r: 12, b: 4, l: 12 }, verticalAlign: "bottom" });
    st.setContent(textId, para("Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt."), 400, 60);
    let parts = shapeTextOf(kids()[0])!;
    expect(parts.spec.overflow).toBe("shrink");
    expect(parts.shape.size.height).toBe(60);
    expect(parts.text.box.autoFit?.enabled).toBe(true);
    expect(parts.text.box.padding).toEqual({ t: 4, r: 12, b: 4, l: 12 });
    expect(parts.text.box.verticalAlign).toBe("bottom");

    st.undo(); // the text
    st.undo(); // the settings
    parts = shapeTextOf(kids()[0])!;
    expect(parts.spec.overflow).toBe("grow");
    expect(parts.text.box.verticalAlign).toBe("middle");
  });

  it("turns a resize of the group into the shape's size, one undo back to before the drag", () => {
    const id = rect();
    const st = useEditor.getState();
    st.addShapeText(id);
    const group = kids()[0];
    const before = structuredClone(group.transform);
    group.transform = { ...group.transform, scaleX: 2, scaleY: 1.5 };
    expect(st.bakeShapeTextScale(group.id, before)).toBe(true);
    const parts = shapeTextOf(kids()[0])!;
    expect(parts.group.transform.scaleX).toBe(1);
    expect(parts.shape.size).toEqual({ width: 400, height: 90 });
    expect((parts.text as TextNode).box.width).toBe(400);

    st.undo();
    const back = shapeTextOf(kids()[0])!;
    expect(back.group.transform).toEqual(before);
    expect(back.shape.size).toEqual({ width: 200, height: 60 });
  });

  it("leaves shapes inside a boolean shape alone", () => {
    const st = useEditor.getState();
    const id = rect();
    const shape = kids().pop()!;
    kids().push({ id: "b", type: "boolean", transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, size: { width: 1, height: 1 }, operands: [shape], op: "union" } as unknown as Node);
    expect(st.addShapeText(id)).toBeNull();
  });
});
