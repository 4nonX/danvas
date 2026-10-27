// A menu opened from a button. It is drawn at the top of the page, so no
// scroll area cuts it off, and placed beside its button inside the area the
// button belongs to: the nearest [data-menu-bounds] around it (the dashboard
// marks its content, so a menu never covers the sidebar), else the window.
// It opens below or above, whichever fits, and scrolls when neither does.
//
// Put it inside the (relatively positioned) element holding the button; that
// element is what it opens from.

import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { intersect, placeMenu, type Box } from "@/lib/placeMenu";

/** Marks a menu's element, so outside-click handlers can leave it alone. */
export const ANCHORED_MENU_ATTR = "data-anchored-menu";

export function insideAnchoredMenu(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${ANCHORED_MENU_ATTR}]`) !== null;
}

export function AnchoredMenu({ children, className, align = "end", matchWidth, role, onClick }: {
  children: ReactNode;
  /** Looks and width (for example `w-60`); the position is set here. */
  className?: string;
  align?: "start" | "end";
  /** As wide as the element it opens from. */
  matchWidth?: boolean;
  role?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const spot = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = menu.current;
    const anchorEl = spot.current?.parentElement;
    if (!el || !anchorEl) return;
    const place = () => {
      const a = anchorEl.getBoundingClientRect();
      const view: Box = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
      const area = anchorEl.closest("[data-menu-bounds]")?.getBoundingClientRect();
      const bounds = area ? intersect(area, view) : view;
      // The button scrolled out of its area: the menu goes with it.
      const gone = a.bottom < bounds.top || a.top > bounds.bottom || a.right < bounds.left || a.left > bounds.right;
      el.style.visibility = gone ? "hidden" : "";
      if (matchWidth) el.style.width = `${a.width}px`;
      el.style.maxHeight = "";
      const p = placeMenu(a, { width: el.offsetWidth, height: el.scrollHeight }, bounds, {
        align,
        rtl: getComputedStyle(anchorEl).direction === "rtl",
      });
      el.style.left = `${p.left}px`;
      el.style.top = `${p.top}px`;
      if (p.maxHeight !== undefined) el.style.maxHeight = `${p.maxHeight}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const ro = new ResizeObserver(place);
    ro.observe(el);
    ro.observe(anchorEl);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      ro.disconnect();
    };
  }, [align, matchWidth]);

  const style: CSSProperties = { position: "fixed", left: 0, top: 0, overflowY: "auto" };
  return (
    <>
      <span ref={spot} hidden />
      {typeof document !== "undefined" &&
        createPortal(
          <div ref={menu} {...{ [ANCHORED_MENU_ATTR]: "" }} role={role} style={style} className={`z-50 ${className ?? ""}`} onClick={onClick}>
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
