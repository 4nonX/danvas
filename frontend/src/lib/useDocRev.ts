// The document's change counter for side panels and dialogs, at a pace a person
// can read: at most once per frame, and while something is being dragged,
// resized or rotated about seven times a second, with the final state always
// shown when the gesture ends. Before, every panel re-rendered on every single
// change (every pointer move of a drag), all at once, which is what made the
// editor stutter on large designs and freeze in slower browsers.
//
// The canvas and the overlays drawn on it (selection box, handles, crop and
// path editors) stay on the exact counter: they must move with the content in
// the same frame.

import { useEffect, useState } from "react";
import { useEditor } from "@/store/editor";

/** While a gesture runs, panels update at this interval instead of every frame. */
export const GESTURE_PANEL_MS = 150;

export function useDocRev(): number {
  const [rev, setRev] = useState(() => useEditor.getState().rev);
  useEffect(() => {
    let frame = 0;
    let timer = 0;
    const show = () => {
      frame = 0;
      timer = 0;
      setRev(useEditor.getState().rev);
    };
    const unsub = useEditor.subscribe((s, prev) => {
      const ended = !!prev.transforming && !s.transforming;
      if (s.rev === prev.rev && !ended) return;
      if (ended) {
        // The gesture is over: show its final state at the next frame.
        if (timer) { window.clearTimeout(timer); timer = 0; }
        if (!frame) frame = requestAnimationFrame(show);
        return;
      }
      if (frame || timer) return;
      if (s.transforming) timer = window.setTimeout(show, GESTURE_PANEL_MS);
      else frame = requestAnimationFrame(show);
    });
    // A change between the first render and this subscription.
    if (useEditor.getState().rev !== rev) frame = requestAnimationFrame(show);
    return () => {
      unsub();
      if (frame) cancelAnimationFrame(frame);
      if (timer) window.clearTimeout(timer);
    };
    // Subscribes once; `rev` only seeds the catch-up check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return rev;
}
