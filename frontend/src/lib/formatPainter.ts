// The format painter's second step: once the selection moves from the copied
// element to another one, paste the copied style onto it, once.

import { useEditor } from "@/store/editor";

/** Waits for the selection to differ from `source` (the selection the style
 *  was copied from), then pastes the style and calls `onDone`. Returns the
 *  unsubscribe. It stops listening BEFORE it pastes: the paste writes to the
 *  store, which notifies its subscribers synchronously, so a subscriber still
 *  listening would paste again on its own write, and again, until the stack
 *  overflows (which crashed the editor). */
export function pasteOnNextSelection(source: string, onDone: () => void): () => void {
  let fired = false;
  const unsub = useEditor.subscribe((s) => {
    if (fired) return;
    const key = s.selection.join("|");
    if (!key || key === source) return;
    fired = true;
    unsub();
    onDone();
    useEditor.getState().pasteStyle();
  });
  return () => { fired = true; unsub(); };
}
