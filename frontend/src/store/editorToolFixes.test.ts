// Tools that did less than their label said: Group on later pages, Delete
// inside a group, the panel's text field, Auto W, Flip when rotated, Add page.
import { applyToPoint, fromTransform } from "@hc/engine";
import type { Node, TextNode } from "@hc/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { useEditor } from "./editor";

const st = () => useEditor.getState();
const kids = (page = 0) => st().doc.pages[page].children as unknown as Node[];
const select = (ids: string[]) => useEditor.setState({ selection: ids });
const childrenOf = (n: Node) => (n as unknown as { children: Node[] }).children;
const text = (n: Node) => n as unknown as TextNode;
const place = (n: Node, x: number, y: number, width = 100, height = 40) => {
  n.transform = { ...n.transform, x, y };
  n.size = { width, height };
};
/** Where a point of a child inside a group lands on the page. */
const onPage = (group: Node, child: Node) => {
  const inGroup = applyToPoint(fromTransform(child.transform), { x: 0, y: 0 });
  return applyToPoint(fromTransform(group.transform), inGroup);
};
const centerOf = (n: Node) => applyToPoint(fromTransform(n.transform), { x: n.size.width / 2, y: n.size.height / 2 });

function twoTextsGrouped() {
  st().addTextBox("a");
  st().addTextBox("b");
  const [a, b] = kids();
  place(a, 100, 100);
  place(b, 400, 300);
  select([a.id, b.id]);
  st().group();
  return kids()[0];
}

beforeEach(() => {
  const doc = st().doc;
  doc.pages.splice(1);
  const first = doc.pages[0] as unknown as { children: Node[]; bleed?: number; printMarks?: unknown };
  first.children.length = 0;
  delete first.bleed;
  delete first.printMarks;
  useEditor.setState({ activePage: 0, selection: [], undoStack: [], redoStack: [] });
});

describe("Group", () => {
  it("works on a later page, and undo and redo work there", () => {
    st().addPage();
    expect(st().activePage).toBe(1);
    st().addTextBox("a");
    st().addTextBox("b");
    const ids = kids(1).map((n) => n.id);
    select(ids);
    st().group();
    expect(kids(1).map((n) => n.type)).toEqual(["group"]);
    expect(childrenOf(kids(1)[0]).map((n) => n.id)).toEqual(ids);
    st().undo();
    expect(kids(1).map((n) => n.id)).toEqual(ids);
    st().redo();
    expect(kids(1).map((n) => n.type)).toEqual(["group"]);
  });
});

describe("Delete inside a group", () => {
  it("removes the child, keeps the other in place, and fits the group", () => {
    const g = twoTextsGrouped();
    const [a, b] = childrenOf(g);
    const bBefore = onPage(g, b);
    select([a.id]);
    st().deleteSelection();
    expect(childrenOf(kids()[0]).map((n) => n.id)).toEqual([b.id]);
    expect(onPage(kids()[0], b)).toEqual(bBefore);
    expect(kids()[0].size).toEqual({ width: 100, height: 40 });
    expect(st().selection).toEqual([]);
  });

  it("undo puts child, order and group box back", () => {
    const g = twoTextsGrouped();
    const [a, b] = childrenOf(g);
    const before = structuredClone(g);
    select([a.id]);
    st().deleteSelection();
    st().undo();
    expect(kids()[0]).toEqual(before);
    expect(childrenOf(kids()[0]).map((n) => n.id)).toEqual([a.id, b.id]);
    expect(st().selection).toEqual([a.id]);
  });

  it("removes a group left empty, and undo brings it back", () => {
    const g = twoTextsGrouped();
    const before = structuredClone(g);
    select(childrenOf(g).map((n) => n.id));
    st().deleteSelection();
    expect(kids()).toEqual([]);
    st().undo();
    expect(kids()[0]).toEqual(before);
  });

  it("keeps locked children and everything in a locked group", () => {
    const g = twoTextsGrouped();
    const [a, b] = childrenOf(g);
    (a as { locked?: boolean }).locked = true;
    select([a.id]);
    st().deleteSelection();
    expect(childrenOf(kids()[0])).toHaveLength(2);
    (a as { locked?: boolean }).locked = false;
    (g as { locked?: boolean }).locked = true;
    select([b.id]);
    st().deleteSelection();
    expect(childrenOf(kids()[0])).toHaveLength(2);
  });

  it("Cut removes it too, and a top-level delete still works", () => {
    const g = twoTextsGrouped();
    select([childrenOf(g)[0].id]);
    st().cutSelection();
    expect(childrenOf(kids()[0])).toHaveLength(1);
    select([kids()[0].id]);
    st().deleteSelection();
    expect(kids()).toEqual([]);
  });

  it("does not delete a child twice when its group is selected too", () => {
    const g = twoTextsGrouped();
    select([g.id, childrenOf(g)[0].id]);
    st().deleteSelection();
    expect(kids()).toEqual([]);
    st().undo();
    expect(childrenOf(kids()[0])).toHaveLength(2);
  });
});

describe("Text field in the panel", () => {
  it("leaves formatting and history alone when the words are the same", () => {
    st().addTextBox("one two");
    const n = kids()[0];
    const s = text(n).content[0].runs[0].style;
    text(n).content[0].runs = [{ text: "one ", style: { ...s } }, { text: "two", style: { ...s, fontSize: 99, link: "https://x.test" } }];
    useEditor.setState({ undoStack: [] });
    st().setText(n.id, "one two");
    expect(text(n).content[0].runs).toHaveLength(2);
    expect(text(n).content[0].runs[1].style.link).toBe("https://x.test");
    expect(st().undoStack).toHaveLength(0);
  });

  it("still applies new words", () => {
    st().addTextBox("old");
    const n = kids()[0];
    st().setText(n.id, "new\nlines");
    expect(text(kids()[0]).content.map((p) => p.runs[0].text)).toEqual(["new", "lines"]);
  });
});

describe("Auto W", () => {
  const longText = "a long line of text that needs a much wider box than this";

  it("grows the box to the text when switched on, and undo restores it", () => {
    st().addTextBox(longText);
    const n = kids()[0];
    place(n, 10, 20, 50, 40);
    text(n).box.width = 50;
    st().setTextBoxMode(n.id, "autoWidth");
    expect(n.size.width).toBeGreaterThan(50);
    expect(text(n).box.width).toBe(n.size.width);
    expect(n.transform.x).toBe(10);
    st().undo();
    expect(n.size.width).toBe(50);
    expect(text(n).box.width).toBe(50);
    expect(text(n).box.mode).not.toBe("autoWidth");
  });

  it("keeps the center of centered text and the right edge of right aligned text", () => {
    for (const [align, factor] of [["center", 0.5], ["right", 1]] as const) {
      st().addTextBox(longText);
      const n = kids().at(-1)!;
      place(n, 500, 20, 50, 40);
      text(n).box.width = 50;
      text(n).content[0].style.align = align;
      st().setTextBoxMode(n.id, "autoWidth");
      expect(n.transform.x + n.size.width * factor).toBeCloseTo(500 + 50 * factor, 6);
    }
  });

  it("follows a size change and new words, and undo follows back", () => {
    st().addTextBox(longText);
    const n = kids()[0];
    st().setTextBoxMode(n.id, "autoWidth");
    const w = n.size.width;
    st().setTextStyle(n.id, { fontSize: 200 });
    const big = n.size.width;
    expect(big).toBeGreaterThan(w);
    st().undo();
    expect(n.size.width).toBe(w);
    st().setText(n.id, "short");
    expect(n.size.width).toBeLessThan(w);
  });

  it("does not touch the width of other boxes", () => {
    st().addTextBox(longText);
    const n = kids()[0];
    place(n, 0, 0, 50, 40);
    text(n).box.width = 50;
    st().setTextStyle(n.id, { fontSize: 200 });
    expect(n.size.width).toBe(50);
  });
});

describe("Flip", () => {
  function rotated(rotation: number) {
    st().addTextBox("a");
    const n = kids().at(-1)!;
    place(n, 300, 300, 200, 80);
    n.transform.rotation = rotation;
    return n;
  }

  it.each([0, 30, 90, 180, 270])("mirrors in place at %i degrees, on both axes", (rotation) => {
    for (const axis of ["h", "v"] as const) {
      const n = rotated(rotation);
      const c = centerOf(n);
      // A corner of the box, as a marker for what the mirror does to it.
      const p = applyToPoint(fromTransform(n.transform), { x: 0, y: 0 });
      select([n.id]);
      st().flipSelection(axis);
      const after = centerOf(n);
      expect(after.x).toBeCloseTo(c.x, 6);
      expect(after.y).toBeCloseTo(c.y, 6);
      const q = applyToPoint(fromTransform(n.transform), { x: 0, y: 0 });
      expect(q.x).toBeCloseTo(axis === "h" ? 2 * c.x - p.x : p.x, 6);
      expect(q.y).toBeCloseTo(axis === "v" ? 2 * c.y - p.y : p.y, 6);
    }
  });

  it("flipping twice and undo give the original back", () => {
    const n = rotated(90);
    const before = { ...n.transform };
    select([n.id]);
    st().flipSelection("h");
    st().undo();
    expect(n.transform).toEqual(before);
    st().flipSelection("h");
    st().flipSelection("h");
    expect(n.transform.x).toBeCloseTo(before.x, 6);
    expect(n.transform.y).toBeCloseTo(before.y, 6);
    expect(n.transform.scaleX).toBe(before.scaleX);
    expect(Math.abs(n.transform.rotation)).toBe(90);
  });

  it("mirrors several objects about their common center, rotated ones too", () => {
    const a = rotated(0);
    const b = rotated(90);
    place(a, 0, 0, 100, 100);
    place(b, 400, 0, 100, 100);
    const ca = centerOf(a), cb = centerOf(b);
    select([a.id, b.id]);
    st().flipSelection("h");
    // The two swap sides: the sum of their centers stays.
    expect(centerOf(a).x + centerOf(b).x).toBeCloseTo(ca.x + cb.x, 6);
    expect(centerOf(a).x).toBeGreaterThan(centerOf(b).x);
    expect(b.transform.rotation).toBe(-90);
  });
});

describe("Add page", () => {
  it("keeps the bleed and crop marks of the current page, and undo removes the page", () => {
    const first = st().doc.pages[0] as unknown as { bleed?: number; printMarks?: unknown };
    first.bleed = 9;
    first.printMarks = { enabled: true };
    st().addPage();
    const second = st().doc.pages[1] as unknown as { bleed?: number; printMarks?: unknown };
    expect(second.bleed).toBe(9);
    expect(second.printMarks).toEqual({ enabled: true });
    expect(second.printMarks).not.toBe(first.printMarks);
    st().undo();
    expect(st().doc.pages).toHaveLength(1);
  });

  it("adds nothing to a page without print settings", () => {
    st().addPage();
    const second = st().doc.pages[1] as unknown as Record<string, unknown>;
    expect("bleed" in second).toBe(false);
    expect("printMarks" in second).toBe(false);
  });
});
