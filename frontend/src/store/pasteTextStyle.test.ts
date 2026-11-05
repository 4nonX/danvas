// Copy style from one text box to another: the formatting arrives, one undo
// takes all of it back, including a frame the bigger text made taller.
import { beforeEach, describe, expect, it } from "vitest";
import type { Node, TextNode } from "@hc/schema";
import { useEditor } from "./editor";

const run = (n: Node) => (n as unknown as TextNode).content[0].runs[0];

function twoTexts() {
  const st = useEditor.getState();
  st.addTextBox("source");
  st.addTextBox("target");
  const [source, target] = useEditor.getState().doc.pages[0].children as unknown as Node[];
  Object.assign(run(source).style, { fontFamily: "Georgia", fontStyle: "Bold", fontSize: 64 });
  (source as unknown as TextNode).content[0].style.align = "center";
  useEditor.setState({ undoStack: [], redoStack: [] });
  return { source, target };
}

beforeEach(() => {
  const doc = useEditor.getState().doc;
  doc.pages.splice(1);
  (doc.pages[0] as unknown as { children: Node[] }).children.length = 0;
  useEditor.setState({ activePage: 0, selection: [], undoStack: [], redoStack: [] });
});

describe("paste style from text to text", () => {
  it("carries font, size and alignment, and one undo and redo cover it", () => {
    const { source, target } = twoTexts();
    const before = structuredClone(target);
    const st = useEditor.getState();

    useEditor.setState({ selection: [source.id] });
    st.copyStyle();
    useEditor.setState({ selection: [target.id] });
    st.pasteStyle();

    expect(run(target).text).toBe("target");
    expect(run(target).style).toMatchObject({ fontFamily: "Georgia", fontStyle: "Bold", fontSize: 64 });
    expect((target as unknown as TextNode).content[0].style.align).toBe("center");
    expect(useEditor.getState().undoStack.length).toBe(1);

    st.undo();
    expect(target).toEqual(before);

    st.redo();
    expect(run(target).style).toMatchObject({ fontFamily: "Georgia", fontSize: 64 });
  });

  it("does not restyle a locked text", () => {
    const { source, target } = twoTexts();
    (target as unknown as { locked: boolean }).locked = true;
    const st = useEditor.getState();
    useEditor.setState({ selection: [source.id] });
    st.copyStyle();
    useEditor.setState({ selection: [target.id] });
    st.pasteStyle();
    expect(run(target).style.fontFamily).not.toBe("Georgia");
  });
});
