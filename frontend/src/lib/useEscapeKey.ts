// Escape closes the topmost of the overlays that use this hook (print dialog,
// proof, output check, publish, website, magic resize). It listens before the
// page does and stops the key there, so an overlay opened over another (the
// proof over the download menu) closes alone instead of taking the menu with
// it. ui/Modal has its own Escape handling; this is for the overlays built
// without it.

import { useEffect, useRef } from "react";

const stack: (() => void)[] = [];
let listening = false;

function onKey(e: KeyboardEvent) {
  if (e.key !== "Escape" || e.defaultPrevented || !stack.length) return;
  e.stopPropagation();
  e.preventDefault();
  stack[stack.length - 1]();
}

/** While `active`, Escape calls `onEscape` (when this is the topmost such overlay). */
export function useEscapeKey(onEscape: () => void, active = true): void {
  const latest = useRef(onEscape);
  useEffect(() => {
    latest.current = onEscape;
  });
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const entry = () => latest.current();
    stack.push(entry);
    if (!listening) {
      document.addEventListener("keydown", onKey, true);
      listening = true;
    }
    return () => {
      const i = stack.lastIndexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}
