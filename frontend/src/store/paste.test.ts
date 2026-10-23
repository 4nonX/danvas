// Where a paste lands: on another page at the very spot it had on its own
// page; on the page of the original next to it (so it does not hide behind
// it); after a cut, in place.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBlankDesign, createNode, type Node } from "@hc/schema";

vi.mock("@/lib/i18n", () => ({ tr: (k: string) => k }));

const { useEditor } = await import("./editor");

function shape(id: string, x: number, y: number): Node {
  return createNode("shape", { id, transform: { x, y, scaleX: 1, scaleY: 1, rotation: 0 }, size: { width: 10, height: 10 } } as Partial<Node>);
}
const st = () => useEditor.getState();
const pos = (page: number) => st().doc.pages[page].children.map((n) => [n.transform.x, n.transform.y]);

beforeEach(() => {
  const doc = createBlankDesign({ title: "t", width: 800, height: 600 });
  doc.pages.push({ ...structuredClone(doc.pages[0]), id: "p2", children: [] });
  doc.pages[0].children.push(shape("a", 120, 340));
  st().loadDoc(doc);
});

describe("paste position", () => {
  it("lands at the same spot on another page", () => {
    st().setActivePage(0);
    st().select(["a"]);
    st().copySelection();
    st().setActivePage(1);
    st().paste();
    expect(pos(1)).toEqual([[120, 340]]);
  });

  it("is offset next to the original on the same page", () => {
    st().select(["a"]);
    st().copySelection();
    st().paste();
    expect(pos(0)).toEqual([[120, 340], [144, 364]]);
  });

  it("goes back in place after a cut, and the clipboard text form does the same", () => {
    st().select(["a"]);
    st().cutSelection();
    st().paste();
    expect(pos(0)).toEqual([[120, 340]]);
    // From the clipboard text (another tab): onto the other page, same spot.
    st().setActivePage(1);
    st().pasteNodes([shape("a", 120, 340)]);
    expect(pos(1)).toEqual([[120, 340]]);
  });
});
