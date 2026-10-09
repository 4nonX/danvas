// Edge handles of an image move its frame, not its picture: dragging the left
// handle in hides more of the left of the picture (or reveals it again, up to
// the edge of the image file) while the picture keeps its size and its place
// on the page. Corners still scale picture and frame together.
//
// Pure math over the image node. The picture's visible part is the crop
// (normalized to the source file) after the fit mode; only fits that fill the
// frame ("cover", "stretch") are handled, since only there the frame edge IS
// the picture edge. Flips live in the transform's scale sign, so the frame's
// local left is always the source's left.

import { fitRect, fromTransform } from "@hc/engine";
import type { CropRect, ImageNode, Size, Transform } from "@hc/schema";

export type EdgeHandle = "n" | "s" | "e" | "w";

export function isEdgeHandle(h: string): h is EdgeHandle {
  return h === "n" || h === "s" || h === "e" || h === "w";
}

/** The image state an edge crop starts from. */
export interface EdgeCropStart {
  transform: Transform;
  size: Size;
  /** Visible part of the source file, normalized 0..1 (after fit). */
  visible: CropRect;
  /** Frame units per source pixel, per axis (equal for "cover"). */
  kx: number;
  ky: number;
  naturalWidth: number;
  naturalHeight: number;
  fit: "cover" | "stretch";
}

type ImageLike = Pick<ImageNode, "transform" | "size" | "source" | "crop" | "fit" | "focalPoint">;

/** The start state, or null when the frame cannot be cropped by its edges:
 *  a fit that leaves empty space ("contain", "none"), or a source whose
 *  natural size is not known yet. */
export function edgeCropStart(node: ImageLike): EdgeCropStart | null {
  if (node.fit !== "cover" && node.fit !== "stretch") return null;
  const nw = node.source?.naturalWidth ?? 0;
  const nh = node.source?.naturalHeight ?? 0;
  const { width: w, height: h } = node.size;
  if (!(nw > 0 && nh > 0 && w > 0 && h > 0)) return null;
  const c = node.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const fr = fitRect(nw * c.width, nh * c.height, w, h, node.fit, node.focalPoint);
  const visible: CropRect = {
    x: c.x + fr.source.x * c.width,
    y: c.y + fr.source.y * c.height,
    width: fr.source.width * c.width,
    height: fr.source.height * c.height,
  };
  if (!(visible.width > 0 && visible.height > 0)) return null;
  return {
    transform: { ...node.transform },
    size: { ...node.size },
    visible,
    kx: w / (visible.width * nw),
    ky: h / (visible.height * nh),
    naturalWidth: nw,
    naturalHeight: nh,
    fit: node.fit,
  };
}

/** Smallest frame side, in frame units. */
const MIN_SIDE = 1;

/**
 * Move one edge of the frame to `wanted` (the frame size the drag asks for on
 * that axis, opposite edge fixed). Returns the new frame, its transform (the
 * opposite edge stays put on the page) and the crop that keeps the picture's
 * scale and place. The edge stops at the image file's border.
 */
export function edgeCrop(
  start: EdgeCropStart,
  handle: EdgeHandle,
  wanted: number,
): { size: Size; transform: Transform; crop: CropRect } {
  const v = start.visible;
  const horizontal = handle === "e" || handle === "w";
  const k = horizontal ? start.kx : start.ky;
  const natural = horizontal ? start.naturalWidth : start.naturalHeight;
  const pos = horizontal ? v.x : v.y; // visible start in the source
  const len = horizontal ? v.width : v.height; // visible length in the source
  const old = horizontal ? start.size.width : start.size.height;
  // Moving the far edge (e/s) keeps the visible start; the near edge (w/n)
  // keeps the visible end. Either way the edge may grow only to the file.
  const growsAtStart = handle === "w" || handle === "n";
  const maxLen = growsAtStart ? pos + len : 1 - pos;
  const maxSide = maxLen * k * natural;
  const side = Math.min(Math.max(Number.isFinite(wanted) ? wanted : old, MIN_SIDE), maxSide);
  const newLen = side / (k * natural);
  const newPos = growsAtStart ? pos + len - newLen : pos;
  const crop: CropRect = horizontal
    ? { x: newPos, y: v.y, width: newLen, height: v.height }
    : { x: v.x, y: newPos, width: v.width, height: newLen };
  const size: Size = horizontal ? { width: side, height: start.size.height } : { width: start.size.width, height: side };
  // The near edge moves the frame's origin along its own (rotated, scaled)
  // local axis by the change in size; the far edge leaves it where it is.
  const t = start.transform;
  let transform: Transform = { ...t };
  if (growsAtStart) {
    const m = fromTransform(t);
    const d = old - side;
    transform = horizontal
      ? { ...t, x: t.x + m.a * d, y: t.y + m.b * d }
      : { ...t, x: t.x + m.c * d, y: t.y + m.d * d };
  }
  return { size, transform, crop };
}
