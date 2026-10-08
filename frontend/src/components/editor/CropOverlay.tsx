// crop overlay, Canva-style. Double-click an image (or "Crop") to enter.
//  - The crop FRAME (bright, white outline) has edge/corner handles: drag them
//    to trim the visible area. The image stays fixed on the page meanwhile.
//  - The full IMAGE shows faintly around the frame and has its own corner
//    handles: drag them to scale the image behind the frame (no slider).
//  - Drag inside the frame to move the image behind it.
//  - Click outside, press Enter or "Done" to apply; Esc or "Cancel" discards.
// Applying sets the crop (normalized to the source) and, when the frame moved
// or resized, the element's new box, in one undo step. The image always covers
// the frame, so the crop aspect matches the box and "cover" reproduces it.
//
// Every other element (groups, vector shapes, text, rotated or scaled images)
// crops to a clipping group (BoxCropOverlay): the frame's edges trim,
// dragging inside moves the frame over the content, and the parts outside
// stay visible but dimmed (the canvas draws the element unclipped while it
// is being cropped).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import type { CropRect, Fill, ImageNode, ImageSource, Transform } from "@hc/schema";
import { locate, worldMatrix } from "@hc/editor";
import { fromTransform } from "@hc/engine";
import { useEditor } from "@/store/editor";
import { imageAssets } from "@/lib/assetProvider";
import type { CanvasApi } from "@/lib/useEditorCanvas";
import { tr } from "@/lib/i18n";

type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
type Corner = "ne" | "nw" | "se" | "sw";
const FRAME_HANDLES: { edge: Edge; cursor: string; left: string; top: string }[] = [
  { edge: "nw", cursor: "nwse-resize", left: "0%", top: "0%" },
  { edge: "n", cursor: "ns-resize", left: "50%", top: "0%" },
  { edge: "ne", cursor: "nesw-resize", left: "100%", top: "0%" },
  { edge: "e", cursor: "ew-resize", left: "100%", top: "50%" },
  { edge: "se", cursor: "nwse-resize", left: "100%", top: "100%" },
  { edge: "s", cursor: "ns-resize", left: "50%", top: "100%" },
  { edge: "sw", cursor: "nesw-resize", left: "0%", top: "100%" },
  { edge: "w", cursor: "ew-resize", left: "0%", top: "50%" },
];
const IMAGE_CORNERS: { corner: Corner; cursor: string; left: string; top: string }[] = [
  { corner: "nw", cursor: "nwse-resize", left: "0%", top: "0%" },
  { corner: "ne", cursor: "nesw-resize", left: "100%", top: "0%" },
  { corner: "se", cursor: "nwse-resize", left: "100%", top: "100%" },
  { corner: "sw", cursor: "nesw-resize", left: "0%", top: "100%" },
];
/** Smallest frame side while edge-cropping, in screen px. */
const MIN_SIDE = 8;

type Rect = { x: number; y: number; w: number; h: number };

export function CropOverlay({ api, id }: { api: CanvasApi; id: string }) {
  const doc = useEditor((s) => s.doc);
  const node = locate(doc, id)?.node;
  const wm = worldMatrix(doc, id);
  const imageLike = node?.type === "image" || (node?.type === "shape" && (node as unknown as { fills?: Fill[] }).fills?.[0]?.type === "image");
  // The image crop pans the source inside an axis-aligned box; a rotated or
  // scaled image crops like any other element instead of not at all.
  const axisAligned = !!wm && Math.abs(wm.a - 1) < 1e-6 && Math.abs(wm.d - 1) < 1e-6 && Math.abs(wm.b) < 1e-6 && Math.abs(wm.c) < 1e-6;
  return imageLike && axisAligned ? <ImageCropOverlay api={api} id={id} /> : <BoxCropOverlay api={api} id={id} />;
}

function ImageCropOverlay({ api, id }: { api: CanvasApi; id: string }) {
  // Track edits/pan/zoom so the frame stays glued to the node.
  useEditor((s) => s.rev);
  useEditor((s) => s.viewport);
  const setCropping = useEditor((s) => s.setCropping);
  const doc = useEditor.getState().doc;
  const loc = locate(doc, id);
  const wm = worldMatrix(doc, id);
  // The overlay positions an axis-aligned <img> in screen space, so it only
  // matches the render when the node's FULL world matrix (including any parent
  // group) is an unrotated, unscaled, unflipped translation.
  const axisAligned =
    !!wm && Math.abs(wm.a - 1) < 1e-6 && Math.abs(wm.d - 1) < 1e-6 && Math.abs(wm.b) < 1e-6 && Math.abs(wm.c) < 1e-6;

  // The croppable content: an image node's own source/crop, or a shape's
  // image fill (fills[0]) - both use the same normalized-crop model, and
  // setImageCrop routes the result to whichever one the node carries.
  let node: { size: { width: number; height: number }; transform: { x: number; y: number } } | null = null;
  let src: ImageSource | null = null;
  let nodeCrop: CropRect | undefined;
  if (loc?.node.type === "image") {
    const img = loc.node as unknown as ImageNode;
    node = img;
    src = img.source;
    nodeCrop = img.crop;
  } else if (loc?.node.type === "shape") {
    const fill = (loc.node as unknown as { fills?: Fill[] }).fills?.[0];
    if (fill?.type === "image") {
      node = loc.node as unknown as { size: { width: number; height: number }; transform: { x: number; y: number } };
      src = fill.source;
      nodeCrop = fill.crop;
    }
  }
  const url = src ? imageAssets.url(src.assetId) : null;
  const zoom = api.viewport().zoom;

  // The element's ORIGINAL box in screen space; everything below is measured
  // from its top-left.
  const ftl = wm ? api.toScreen({ x: wm.e, y: wm.f }) : { x: 0, y: 0 };
  const fw = node ? node.size.width * zoom : 0;
  const fh = node ? node.size.height * zoom : 0;

  // A shape fill's recorded natural size can lag the asset load; fall back to
  // the loaded element's real dimensions.
  const el = src ? (imageAssets.image(src.assetId) as { naturalWidth?: number; naturalHeight?: number } | null) : null;
  const natW = (src ? src.naturalWidth : 0) || el?.naturalWidth || 1;
  const natH = (src ? src.naturalHeight : 0) || el?.naturalHeight || 1;

  // Source image placement, relative to the ORIGINAL box top-left.
  const [t, setT] = useState(() => {
    const crop = nodeCrop;
    if (crop && crop.width > 0) {
      const scale = fw / (crop.width * natW);
      return { scale, offX: -crop.x * natW * scale, offY: -crop.y * natH * scale };
    }
    const s = Math.max(fw / natW, fh / natH);
    return { scale: s, offX: (fw - natW * s) / 2, offY: (fh - natH * s) / 2 };
  });
  // The crop frame, relative to the ORIGINAL box top-left (starts as the box).
  const [fr, setFr] = useState<Rect>({ x: 0, y: 0, w: fw, h: fh });

  // Synced after commit (not during render) for the pointer handlers below.
  const tRef = useRef(t);
  const frRef = useRef(fr);
  useLayoutEffect(() => { tRef.current = t; frRef.current = fr; });

  const coverScale = (f: Rect) => Math.max(f.w / natW, f.h / natH);
  /** Keep the image covering the frame (no empty strips inside the crop). */
  const clampPan = (offX: number, offY: number, scale: number, f: Rect) => {
    const iw = natW * scale;
    const ih = natH * scale;
    return {
      offX: Math.min(f.x, Math.max(f.x + f.w - iw, offX)),
      offY: Math.min(f.y, Math.max(f.y + f.h - ih, offY)),
    };
  };

  /** Run one pointer drag: `move(dx, dy)` on every move, cleanup on release. */
  function startDrag(e: React.PointerEvent, move: (dx: number, dy: number) => void) {
    e.stopPropagation();
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const onMove = (ev: PointerEvent) => move(ev.clientX - x0, ev.clientY - y0);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Drag inside the frame: move the image behind it.
  function onPanDown(e: React.PointerEvent) {
    const start = { ...tRef.current };
    startDrag(e, (dx, dy) => {
      const next = clampPan(start.offX + dx, start.offY + dy, start.scale, frRef.current);
      setT((p) => ({ ...p, ...next }));
    });
  }

  // Frame handle: trim the visible area; never past the image.
  function onFrameHandleDown(edge: Edge, e: React.PointerEvent) {
    const start = { ...frRef.current };
    startDrag(e, (dx, dy) => {
      const cur = tRef.current;
      const ix0 = cur.offX;
      const iy0 = cur.offY;
      const ix1 = cur.offX + natW * cur.scale;
      const iy1 = cur.offY + natH * cur.scale;
      let x0 = start.x;
      let y0 = start.y;
      let x1 = start.x + start.w;
      let y1 = start.y + start.h;
      if (edge.includes("w")) x0 = Math.min(x1 - MIN_SIDE, Math.max(ix0, x0 + dx));
      if (edge.includes("e")) x1 = Math.max(x0 + MIN_SIDE, Math.min(ix1, x1 + dx));
      if (edge.includes("n")) y0 = Math.min(y1 - MIN_SIDE, Math.max(iy0, y0 + dy));
      if (edge.includes("s")) y1 = Math.max(y0 + MIN_SIDE, Math.min(iy1, y1 + dy));
      setFr({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    });
  }

  // Image corner handle: scale the image about the opposite corner, keeping
  // its aspect, never smaller than what still covers the frame.
  function onImageCornerDown(corner: Corner, e: React.PointerEvent) {
    const start = { ...tRef.current };
    const w0 = natW * start.scale;
    const h0 = natH * start.scale;
    const sx = corner.includes("e") ? 1 : -1;
    const sy = corner.includes("s") ? 1 : -1;
    // The anchor (opposite corner) stays put while scaling.
    const ax = sx > 0 ? start.offX : start.offX + w0;
    const ay = sy > 0 ? start.offY : start.offY + h0;
    startDrag(e, (dx, dy) => {
      const f = frRef.current;
      const ratio = Math.max((w0 + sx * dx) / w0, (h0 + sy * dy) / h0);
      const scale = Math.max(coverScale(f), start.scale * ratio);
      const iw = natW * scale;
      const ih = natH * scale;
      const offX = sx > 0 ? ax : ax - iw;
      const offY = sy > 0 ? ay : ay - ih;
      setT({ scale, ...clampPan(offX, offY, scale, f) });
    });
  }

  function apply() {
    const f = frRef.current;
    const cur = tRef.current;
    const crop = {
      x: Math.max(0, (f.x - cur.offX) / cur.scale / natW),
      y: Math.max(0, (f.y - cur.offY) / cur.scale / natH),
      width: Math.min(1, f.w / cur.scale / natW),
      height: Math.min(1, f.h / cur.scale / natH),
    };
    const moved = Math.abs(f.x) > 0.5 || Math.abs(f.y) > 0.5 || Math.abs(f.w - fw) > 0.5 || Math.abs(f.h - fh) > 0.5;
    const frame = moved && node
      ? {
          // Axis-aligned (checked above): screen px / zoom = page px, applied
          // to the node's own (parent-space) transform.
          x: node.transform.x + f.x / zoom,
          y: node.transform.y + f.y / zoom,
          width: f.w / zoom,
          height: f.h / zoom,
        }
      : undefined;
    useEditor.getState().setImageCrop(id, crop, frame);
    setCropping(null);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCropping(null);
      else if (e.key === "Enter") apply();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Exit crop mode if the image isn't axis-aligned (e.g. inside a rotated group
  // selected via the layers panel); the overlay can't represent it.
  useEffect(() => {
    if (node && wm && !axisAligned) setCropping(null);
  }, [node, wm, axisAligned, setCropping]);

  if (!node || !wm || !url || !axisAligned) return null;

  const iw = natW * t.scale;
  const ih = natH * t.scale;
  const handle = "pointer-events-auto absolute z-20 border border-neutral-400 bg-white shadow-sm";

  return (
    <>
      {/* Click anywhere outside the image applies the crop, like Canva. It also
          keeps clicks from reaching other elements while cropping. */}
      <div className="absolute inset-0 z-10" onPointerDown={(e) => { e.stopPropagation(); apply(); }} />

      {/* The full image, faint, for context; its corners scale it. */}
      <div
        className="pointer-events-none absolute z-10"
        style={{ left: ftl.x + t.offX, top: ftl.y + t.offY, width: iw, height: ih }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" draggable={false} className="h-full w-full max-w-none select-none opacity-20" />
        <div className="absolute inset-0 outline outline-1 outline-dashed outline-neutral-400/70" />
        {IMAGE_CORNERS.map((c) => (
          <div
            key={c.corner}
            aria-label={tr("editor.crop_image")}
            onPointerDown={(e) => onImageCornerDown(c.corner, e)}
            className={`${handle} h-3 w-3 rounded-full`}
            style={{ left: c.left, top: c.top, cursor: c.cursor, transform: "translate(-50%, -50%)", touchAction: "none" }}
          />
        ))}
      </div>

      {/* The crop frame: bright image inside, drag to move the image. */}
      <div
        onPointerDown={onPanDown}
        className="absolute z-10 cursor-move overflow-hidden outline outline-2 outline-white"
        style={{ left: ftl.x + fr.x, top: ftl.y + fr.y, width: fr.w, height: fr.h, boxShadow: "0 0 0 1px rgba(0,0,0,0.35)" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt=""
          draggable={false}
          className="pointer-events-none absolute max-w-none select-none"
          style={{ left: t.offX - fr.x, top: t.offY - fr.y, width: iw, height: ih }}
        />
        {/* Rule-of-thirds guides. */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/3 top-0 h-full w-px bg-white/40" />
          <div className="absolute left-2/3 top-0 h-full w-px bg-white/40" />
          <div className="absolute left-0 top-1/3 h-px w-full bg-white/40" />
          <div className="absolute left-0 top-2/3 h-px w-full bg-white/40" />
        </div>
      </div>
      {/* Frame handles: drag to trim the visible area. */}
      <div className="pointer-events-none absolute z-20" style={{ left: ftl.x + fr.x, top: ftl.y + fr.y, width: fr.w, height: fr.h }}>
        {FRAME_HANDLES.map((h) => (
          <div
            key={h.edge}
            aria-label={tr("editor.crop")}
            onPointerDown={(e) => onFrameHandleDown(h.edge, e)}
            className={`${handle} rounded-sm ${h.edge.length === 2 ? "h-3.5 w-3.5" : h.edge === "n" || h.edge === "s" ? "h-2 w-6" : "h-6 w-2"}`}
            style={{ left: h.left, top: h.top, cursor: h.cursor, transform: "translate(-50%, -50%)", touchAction: "none" }}
          />
        ))}
      </div>

      {/* Done/Cancel pinned to the top of the canvas, never over the design. */}
      <div
        className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-neutral-200 bg-surface px-2 py-1.5 shadow-lg"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="px-1 text-xs text-neutral-500">{tr("editor.crop_image")}</span>
        {/* text-surface, not text-white: neutral-900 flips light in dark mode,
            so the label must flip with it to stay readable. */}
        <button onClick={apply} className="flex items-center gap-1 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-surface hover:bg-neutral-700">
          <Check size={14} /> {tr("editor.done")}
        </button>
        <button onClick={() => setCropping(null)} className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100">
          <X size={14} /> {tr("editor.cancel")}
        </button>
      </div>
    </>
  );
}

/** Crop for every element the image crop cannot show (groups, vectors, text,
 *  rotated or scaled images, ...): the frame becomes the box of a clipping
 *  group (store.cropBox). Everything here is in the element's OWN coordinates
 *  and mapped to the screen through its full transform, so scale, rotation
 *  and flips need no special case. Content stays fixed on the page. */
function BoxCropOverlay({ api, id }: { api: CanvasApi; id: string }) {
  useEditor((s) => s.rev);
  useEditor((s) => s.viewport);
  const setCropping = useEditor((s) => s.setCropping);
  const doc = useEditor.getState().doc;
  const loc = locate(doc, id);
  const wm = worldMatrix(doc, id);
  const node = loc?.node as { size: { width: number; height: number }; children?: { transform: Transform; size: { width: number; height: number } }[] } | undefined;
  const zoom = api.viewport().zoom;
  const W = node?.size.width ?? 0;
  const H = node?.size.height ?? 0;

  // Element-local -> screen.
  const o = wm ? api.toScreen({ x: wm.e, y: wm.f }) : { x: 0, y: 0 };
  const M = wm ? { a: wm.a * zoom, b: wm.b * zoom, c: wm.c * zoom, d: wm.d * zoom } : { a: 1, b: 0, c: 0, d: 1 };
  const det = M.a * M.d - M.b * M.c;
  const toScreen = (x: number, y: number) => ({ x: o.x + M.a * x + M.c * y, y: o.y + M.b * x + M.d * y });
  /** A screen-space drag delta in element-local units. */
  const toLocal = (dx: number, dy: number) => ({ x: (M.d * dx - M.c * dy) / det, y: (-M.b * dx + M.a * dy) / det });
  const minSide = MIN_SIDE / Math.sqrt(Math.abs(det) || 1);

  // Everything the crop may reveal (local units): the box itself plus, for a
  // group, every child's box through its own transform.
  let cx0 = 0, cy0 = 0, cx1 = W, cy1 = H;
  for (const c of node?.children ?? []) {
    const m = fromTransform(c.transform);
    for (const [px, py] of [[0, 0], [c.size.width, 0], [0, c.size.height], [c.size.width, c.size.height]]) {
      const x = m.a * px + m.c * py + m.e, y = m.b * px + m.d * py + m.f;
      cx0 = Math.min(cx0, x); cy0 = Math.min(cy0, y); cx1 = Math.max(cx1, x); cy1 = Math.max(cy1, y);
    }
  }
  const content: Rect = { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 };

  const [fr, setFr] = useState<Rect>({ x: 0, y: 0, w: W, h: H });
  // The latest frame for the Enter key handler (registered once).
  const frRef = useRef(fr);
  useLayoutEffect(() => { frRef.current = fr; });

  function startDrag(e: React.PointerEvent, move: (dx: number, dy: number) => void) {
    e.stopPropagation();
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const onMove = (ev: PointerEvent) => {
      const l = toLocal(ev.clientX - x0, ev.clientY - y0);
      move(l.x, l.y);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Edge/corner: trim, never past the content.
  function onFrameHandleDown(edge: Edge, e: React.PointerEvent) {
    const start = { ...fr };
    const c = content;
    startDrag(e, (dx, dy) => {
      let x0 = start.x, y0 = start.y, x1 = start.x + start.w, y1 = start.y + start.h;
      if (edge.includes("w")) x0 = Math.min(x1 - minSide, Math.max(c.x, x0 + dx));
      if (edge.includes("e")) x1 = Math.max(x0 + minSide, Math.min(c.x + c.w, x1 + dx));
      if (edge.includes("n")) y0 = Math.min(y1 - minSide, Math.max(c.y, y0 + dy));
      if (edge.includes("s")) y1 = Math.max(y0 + minSide, Math.min(c.y + c.h, y1 + dy));
      setFr({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    });
  }

  // Inside the frame: move the frame over the content.
  function onMoveDown(e: React.PointerEvent) {
    const start = { ...fr };
    const c = content;
    startDrag(e, (dx, dy) => {
      const x = Math.min(c.x + c.w - start.w, Math.max(c.x, start.x + dx));
      const y = Math.min(c.y + c.h - start.h, Math.max(c.y, start.y + dy));
      setFr({ ...start, x, y });
    });
  }

  function apply() {
    const f = frRef.current;
    useEditor.getState().cropBox(id, { x: f.x, y: f.y, width: f.w, height: f.h });
    setCropping(null);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCropping(null);
      else if (e.key === "Enter") apply();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A degenerate transform (zero scale) has nothing to crop.
  useEffect(() => {
    if (!node || !wm || Math.abs(det) < 1e-9) setCropping(null);
  }, [node, wm, det, setCropping]);

  if (!node || !wm || Math.abs(det) < 1e-9) return null;

  const quad = (r: Rect) => [toScreen(r.x, r.y), toScreen(r.x + r.w, r.y), toScreen(r.x + r.w, r.y + r.h), toScreen(r.x, r.y + r.h)];
  const pts = (q: { x: number; y: number }[]) => q.map((p) => `${p.x},${p.y}`).join(" ");
  const frameQ = quad(fr);
  const lines = [1 / 3, 2 / 3].flatMap((t) => [
    [toScreen(fr.x + fr.w * t, fr.y), toScreen(fr.x + fr.w * t, fr.y + fr.h)],
    [toScreen(fr.x, fr.y + fr.h * t), toScreen(fr.x + fr.w, fr.y + fr.h * t)],
  ]);
  const handle = "pointer-events-auto absolute z-20 border border-neutral-400 bg-white shadow-sm";
  const pct = (v: string) => parseFloat(v) / 100;

  return (
    <>
      {/* Click outside applies, like the image crop. */}
      <div className="absolute inset-0 z-10" onPointerDown={(e) => { e.stopPropagation(); apply(); }} />
      <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible">
        {/* Everything outside the frame is dimmed, hidden content included. */}
        <path
          d={`M-100000 -100000H100000V100000H-100000Z M${frameQ.map((p) => `${p.x} ${p.y}`).join("L")}Z`}
          fillRule="evenodd"
          fill="rgba(255,255,255,0.7)"
        />
        {/* The content's full extent, for orientation. */}
        <polygon points={pts(quad(content))} fill="none" stroke="rgba(115,115,115,0.7)" strokeDasharray="4 3" />
        {lines.map(([p, q], i) => <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="rgba(255,255,255,0.4)" />)}
        <polygon points={pts(frameQ)} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={4} />
        {/* The frame: drag inside it to move it over the content. */}
        <polygon
          points={pts(frameQ)}
          fill="transparent"
          stroke="white"
          strokeWidth={2}
          style={{ pointerEvents: "all", cursor: "move" }}
          onPointerDown={onMoveDown}
        />
      </svg>
      {FRAME_HANDLES.map((h) => {
        const p = toScreen(fr.x + fr.w * pct(h.left), fr.y + fr.h * pct(h.top));
        return (
          <div
            key={h.edge}
            aria-label={tr("editor.crop")}
            onPointerDown={(e) => onFrameHandleDown(h.edge, e)}
            className={`${handle} rounded-sm ${h.edge.length === 2 ? "h-3.5 w-3.5" : "h-3 w-3"}`}
            style={{ left: p.x, top: p.y, cursor: h.cursor, transform: "translate(-50%, -50%)", touchAction: "none" }}
          />
        );
      })}
      <div
        className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-neutral-200 bg-surface px-2 py-1.5 shadow-lg"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="px-1 text-xs text-neutral-500">{tr("editor.crop")}</span>
        <button onClick={apply} className="flex items-center gap-1 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-surface hover:bg-neutral-700">
          <Check size={14} /> {tr("editor.done")}
        </button>
        <button onClick={() => setCropping(null)} className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100">
          <X size={14} /> {tr("editor.cancel")}
        </button>
      </div>
    </>
  );
}
