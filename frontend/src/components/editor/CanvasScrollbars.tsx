// Scrollbars for the canvas. The canvas pans and zooms itself (no native
// scrolling), so these are drawn over it: the vertical one spans the stack of
// pages, the horizontal one the widest page, each with what lies outside the
// pages included. Dragging a thumb pans; a click on the track moves by most of
// a screen towards the click. A bar hides while everything fits in view.

import { useRef, useState } from "react";
import { useEditor } from "@/store/editor";
import { pageOffsets, pageGap } from "@/lib/pageLayout";
import { scrollThumb } from "@/lib/viewPrefs";

const THICK = 8; // thumb thickness in px
const EDGE = 2; // gap to the canvas edge
const MARGIN_PX = 80; // room past the content, in screen px

export function CanvasScrollbars({ inset }: { inset: number }) {
  const viewport = useEditor((s) => s.viewport);
  const size = useEditor((s) => s.viewportSize);
  useEditor((s) => s.rev);
  const [dragging, setDragging] = useState<"x" | "y" | null>(null);
  const drag = useRef<{ axis: "x" | "y"; client: number; start: number; per: number } | null>(null);

  const st = useEditor.getState();
  const doc = st.doc;
  if (!doc.pages.length || !size.width || !size.height) return null;

  // What there is to scroll over: every page with what sticks out of it.
  const offs = pageOffsets(doc);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  doc.pages.forEach((p, i) => {
    const b = st.pageContentBounds(i) ?? { x: 0, y: 0, width: p.width, height: p.height };
    x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x + b.width);
    y0 = Math.min(y0, offs[i] + b.y); y1 = Math.max(y1, offs[i] + b.y + b.height);
  });
  y1 += pageGap; // the "add page" row below the last page

  const zoom = viewport.zoom || 1;
  const margin = MARGIN_PX / zoom;
  const trackX = size.width - inset - 2 * EDGE - THICK - EDGE;
  const trackY = size.height - inset - 2 * EDGE - THICK - EDGE;
  const h = scrollThumb(x0, x1, viewport.panX, size.width / zoom, trackX, margin);
  const v = scrollThumb(y0, y1, viewport.panY, size.height / zoom, trackY, margin);

  // Thumb drag: page units per screen px, fixed for the whole drag so the
  // range growing under the pointer does not make the thumb run away.
  function begin(e: React.PointerEvent, axis: "x" | "y", t: NonNullable<typeof h>, track: number, visible: number) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const per = (t.range - visible) / Math.max(1, track - t.size);
    drag.current = { axis, client: axis === "x" ? e.clientX : e.clientY, start: axis === "x" ? viewport.panX : viewport.panY, per };
    setDragging(axis);
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const delta = ((d.axis === "x" ? e.clientX : e.clientY) - d.client) * d.per;
    useEditor.getState().setViewport(d.axis === "x" ? { panX: d.start + delta } : { panY: d.start + delta });
  };
  const end = () => { drag.current = null; setDragging(null); };

  // Track click: most of a screen towards the click.
  function page(e: React.PointerEvent, axis: "x" | "y", t: NonNullable<typeof h>) {
    if (e.target !== e.currentTarget) return;
    e.stopPropagation();
    const r = (e.currentTarget as Element).getBoundingClientRect();
    const at = axis === "x" ? e.clientX - r.left : e.clientY - r.top;
    const dir = at < t.offset ? -1 : 1;
    const visible = (axis === "x" ? size.width : size.height) / zoom;
    useEditor.getState().setViewport(axis === "x" ? { panX: viewport.panX + dir * visible * 0.9 } : { panY: viewport.panY + dir * visible * 0.9 });
  }

  const thumb = (active: boolean) =>
    `absolute rounded-full transition-colors ${active ? "bg-neutral-500/70" : "bg-neutral-400/45 hover:bg-neutral-500/60"}`;

  return (
    <>
      {v && (
        <div
          data-oc="scrollbar-y"
          className="absolute z-[11]"
          style={{ right: EDGE, top: inset + EDGE, width: THICK, height: trackY }}
          onPointerDown={(e) => page(e, "y", v)}
        >
          <div
            className={thumb(dragging === "y")}
            style={{ left: 0, width: THICK, top: v.offset, height: v.size }}
            onPointerDown={(e) => begin(e, "y", v, trackY, size.height / zoom)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          />
        </div>
      )}
      {h && (
        <div
          data-oc="scrollbar-x"
          className="absolute z-[11]"
          style={{ bottom: EDGE, left: inset + EDGE, height: THICK, width: trackX }}
          onPointerDown={(e) => page(e, "x", h)}
        >
          <div
            className={thumb(dragging === "x")}
            style={{ top: 0, height: THICK, left: h.offset, width: h.size }}
            onPointerDown={(e) => begin(e, "x", h, trackX, size.width / zoom)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          />
        </div>
      )}
    </>
  );
}
