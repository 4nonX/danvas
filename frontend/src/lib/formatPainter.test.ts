import { afterEach, describe, expect, it, vi } from "vitest";
import { useEditor } from "@/store/editor";
import { pasteOnNextSelection } from "./formatPainter";

const original = useEditor.getState().pasteStyle;
const subs: (() => void)[] = [];
afterEach(() => {
  subs.splice(0).forEach((u) => u());
  useEditor.setState({ pasteStyle: original, selection: [] });
});
const watch = (source: string, done: () => void) => { const u = pasteOnNextSelection(source, done); subs.push(u); return u; };

// Like the real paste: a document write (a new rev) that keeps the selection.
function stubPaste() {
  const paste = vi.fn(() => useEditor.setState((s) => ({ rev: s.rev + 1 })));
  useEditor.setState({ pasteStyle: paste });
  return paste;
}

describe("pasteOnNextSelection", () => {
  it("pastes once when the selection moves on, though the paste itself writes to the store", () => {
    useEditor.setState({ selection: ["a"] });
    const paste = stubPaste();
    const done = vi.fn();
    watch("a", done);

    useEditor.setState({ selection: ["b"] });
    expect(paste).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledTimes(1);

    // Later changes do not paste again.
    useEditor.setState({ selection: ["c"] });
    useEditor.setState((s) => ({ rev: s.rev + 1 }));
    expect(paste).toHaveBeenCalledTimes(1);
  });

  it("waits while the selection is empty or still the source", () => {
    useEditor.setState({ selection: ["a"] });
    const paste = stubPaste();
    watch("a", () => {});
    useEditor.setState({ selection: [] });
    useEditor.setState({ selection: ["a"] });
    useEditor.setState((s) => ({ rev: s.rev + 1 }));
    expect(paste).not.toHaveBeenCalled();
  });

  it("does nothing once cancelled", () => {
    useEditor.setState({ selection: ["a"] });
    const paste = stubPaste();
    const cancel = watch("a", () => {});
    cancel();
    useEditor.setState({ selection: ["b"] });
    expect(paste).not.toHaveBeenCalled();
  });
});
