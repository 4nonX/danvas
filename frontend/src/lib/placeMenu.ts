// Where a menu opened from a button goes: below the button, or above it when
// only that fits, and sideways no further than its bounds (the area it
// belongs to, for example the dashboard's content beside the sidebar). When
// neither below nor above fits, it takes the larger side and scrolls.

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface MenuPlacement {
  left: number;
  top: number;
  /** Set when the menu has to scroll to stay inside its bounds. */
  maxHeight?: number;
}

export function placeMenu(
  anchor: Box,
  menu: { width: number; height: number },
  bounds: Box,
  { align = "end", rtl = false, gap = 4, margin = 8 }: { align?: "start" | "end"; rtl?: boolean; gap?: number; margin?: number } = {},
): MenuPlacement {
  const minX = bounds.left + margin;
  const maxX = bounds.right - margin;
  const minY = bounds.top + margin;
  const maxY = bounds.bottom - margin;

  // "end" lines the menu's end edge up with the button's, so it opens
  // towards the content; in right-to-left that is the left edge.
  const alignRight = (align === "end") !== rtl;
  let left = alignRight ? anchor.right - menu.width : anchor.left;
  left = Math.min(left, maxX - menu.width);
  left = Math.max(left, minX);

  const below = maxY - (anchor.bottom + gap);
  const above = anchor.top - gap - minY;
  if (menu.height <= below) return { left, top: anchor.bottom + gap };
  if (menu.height <= above) return { left, top: anchor.top - gap - menu.height };
  if (below >= above) return { left, top: anchor.bottom + gap, maxHeight: Math.max(0, below) };
  const h = Math.max(0, above);
  return { left, top: anchor.top - gap - h, maxHeight: h };
}

/** The part of `a` inside `b`. */
export function intersect(a: Box, b: Box): Box {
  return { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
}
