// Replace object: swap a placed image or vector graphic (a logo, an icon, an
// imported SVG) for another one, keeping its place in the design.
//
// Sizing works on what is VISIBLE, not on the boxes: logo files often carry
// transparent margins of very different widths, and a vector group's box can
// be larger than its paths. Both the old and the new object are rendered once,
// off screen and without effects, and measured by their non-transparent
// pixels; a solid plate behind the content (logo files exported with a
// background rectangle, white JPG canvases) is recognised by a uniform edge
// and left out. Then:
//   - photo replaces photo (both opaque images): the new image fills the old
//     frame exactly, cropped by "cover", so the layout does not move;
//   - otherwise the new content gets the old content's visual weight: equal
//     visible area ("optical"), limited so it never grows past 1.5x the old
//     visible width or height; a similar aspect ratio simply matches;
//   - "contain" and "cover" are the explicit alternatives.
// The new content stays where the old one stood: centred on it, or flush with
// the edge of the page or group the old one was flush with.

import { createNode, type AssetRef, type DesignFile, type Node, type Transform } from "@hc/schema";
import { createScene, fromTransform, renderScene, type CanvasLike, type Viewport } from "@hc/engine";
import { imageAssets } from "@/lib/assetProvider";
import { flattenSvgToNodes, prepareSvgFonts } from "@/lib/svgFlatten";

export type ReplaceMode = "auto" | "optical" | "contain" | "cover";

/** A rectangle in a node's local (unscaled) coordinates. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Visible {
  box: Box;
  /** The content covers its box without transparent pixels (a photo). */
  opaque: boolean;
}

/** Node types the toolbar offers to replace. */
export function isReplaceable(node: Node | null | undefined): boolean {
  return !!node && (node.type === "image" || node.type === "group" || node.type === "path");
}

// --- measuring ------------------------------------------------------------------

const MEASURE_PX = 640;

function assetIdsOf(node: Node, out: string[] = []): string[] {
  if (node.type === "image") out.push((node as unknown as { source: { assetId: string } }).source.assetId);
  for (const c of (node as unknown as { children?: Node[] }).children ?? []) assetIdsOf(c, out);
  return out;
}

/** Resolves once every image the node draws has loaded (or failed), or after
 *  a timeout: a broken asset must not hang the replace. */
export function whenImagesReady(node: Node, assets: AssetRef[], timeoutMs = 10000): Promise<void> {
  const ids = assetIdsOf(node);
  for (const id of ids) {
    const ref = assets.find((a) => a.id === id);
    if (ref?.url) imageAssets.register(id, ref.url);
  }
  const ready = () => ids.every((id) => imageAssets.status(id) !== "loading");
  if (ready()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { off(); clearTimeout(timer); resolve(); };
    const off = imageAssets.onChange(() => { if (ready()) done(); });
    const timer = setTimeout(done, timeoutMs);
  });
}

/** The visible content of a node in its own local, unscaled coordinates,
 *  measured by rendering it alone (no transform, opacity or effects) and
 *  reading the non-transparent pixels. Null when nothing is visible. */
export function measureVisible(node: Node, doc: DesignFile): Visible | null {
  const w = Math.max(1e-6, node.size.width);
  const h = Math.max(1e-6, node.size.height);
  // Children of a group may overflow its box: measure with a margin.
  const pad = node.type === "image" ? 0 : 0.5 * Math.max(w, h);
  const pw = w + 2 * pad;
  const ph = h + 2 * pad;
  const zoom = MEASURE_PX / Math.max(pw, ph);
  const cw = Math.max(1, Math.round(pw * zoom));
  const ch = Math.max(1, Math.round(ph * zoom));

  const clone = JSON.parse(JSON.stringify(node)) as Node & { effects?: unknown[] };
  clone.transform = { x: pad, y: pad, scaleX: 1, scaleY: 1, rotation: 0 } as Transform;
  clone.opacity = 1;
  clone.hidden = false;
  clone.effects = [];
  const page = { ...doc.pages[0], id: "replace-measure", width: pw, height: ph, children: [clone] } as DesignFile["pages"][number];
  delete (page as { background?: unknown }).background;
  const mdoc = { ...doc, pages: [page] } as DesignFile;

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const vp: Viewport = { zoom, panX: 0, panY: 0, dpr: 1, width: cw, height: ch };
  renderScene(createScene(mdoc, 0), ctx as unknown as CanvasLike, vp, { assets: imageAssets, skipBackground: true, cull: false });
  const data = ctx.getImageData(0, 0, cw, ch).data;

  let x0 = cw, y0 = ch, x1 = -1, y1 = -1;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (data[(y * cw + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;

  // A plate behind the content: logo files are often exported with a solid
  // background rectangle (or a white JPG canvas) filling the whole artboard.
  // When the edge of the visible area is one opaque colour, that colour is
  // background, and the content is measured inside it.
  const at = (x: number, y: number) => (y * cw + x) * 4;
  const edge: number[] = [];
  for (let x = x0; x <= x1; x++) edge.push(at(x, y0), at(x, y1));
  for (let y = y0 + 1; y < y1; y++) edge.push(at(x0, y), at(x1, y));
  const c0 = edge[0];
  const near = (i: number) =>
    data[i + 3] >= 250 &&
    Math.abs(data[i] - data[c0]) + Math.abs(data[i + 1] - data[c0 + 1]) + Math.abs(data[i + 2] - data[c0 + 2]) <= 24;
  const plate = data[c0 + 3] >= 250 && edge.filter(near).length >= 0.95 * edge.length;
  let bx0 = x0, by0 = y0, bx1 = x1, by1 = y1;
  if (plate) {
    let ix0 = x1 + 1, iy0 = y1 + 1, ix1 = -1, iy1 = -1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = at(x, y);
        if (data[i + 3] > 8 && !near(i)) {
          if (x < ix0) ix0 = x;
          if (x > ix1) ix1 = x;
          if (y < iy0) iy0 = y;
          if (y > iy1) iy1 = y;
        }
      }
    }
    if (ix1 >= 0) { bx0 = ix0; by0 = iy0; bx1 = ix1; by1 = iy1; }
  }

  let solid = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (data[at(x, y) + 3] >= 250) solid++;
  const area = (x1 - x0 + 1) * (y1 - y0 + 1);
  return {
    box: { x: bx0 / zoom - pad, y: by0 / zoom - pad, w: (bx1 - bx0 + 1) / zoom, h: (by1 - by0 + 1) / zoom },
    // A picture on a plate is a logo, not a photo.
    opaque: !plate && solid / area > 0.98,
  };
}

// --- placement --------------------------------------------------------------------

type Anchor = "start" | "center" | "end";

export interface PlacementInput {
  /** The old node's transform and size. */
  transform: Transform;
  size: { width: number; height: number };
  /** Its visible content (local, unscaled). */
  visible: Box;
  /** The bounds of the page or group it sits in, in that parent's space. */
  parent: { width: number; height: number };
}

/** Which mode "auto" resolves to for these two objects. */
export function autoMode(oldIsPhoto: boolean, newIsPhoto: boolean): Exclude<ReplaceMode, "auto"> {
  return oldIsPhoto && newIsPhoto ? "cover" : "optical";
}

/** Uniform scale for the new content (local units -> parent units). */
export function scaleFor(mode: Exclude<ReplaceMode, "auto">, oldW: number, oldH: number, newW: number, newH: number): number {
  const contain = Math.min(oldW / newW, oldH / newH);
  const cover = Math.max(oldW / newW, oldH / newH);
  if (mode === "contain") return contain;
  if (mode === "cover") return cover;
  // Optical: the same visible area. A similar aspect ratio (within 10 %)
  // comes out as a near-exact match by itself; a very different one is
  // limited so it never exceeds 1.5x the old visible width or height.
  const equalArea = Math.sqrt((oldW * oldH) / (newW * newH));
  return Math.min(equalArea, (1.5 * oldW) / newW, (1.5 * oldH) / newH);
}

function anchorsOf(p: PlacementInput): { ax: Anchor; ay: Anchor } {
  const t = p.transform;
  if (t.rotation !== 0 || t.scaleX <= 0 || t.scaleY <= 0) return { ax: "center", ay: "center" };
  const left = t.x + p.visible.x * t.scaleX;
  const top = t.y + p.visible.y * t.scaleY;
  const right = left + p.visible.w * t.scaleX;
  const bottom = top + p.visible.h * t.scaleY;
  const tol = 0.015 * Math.max(p.parent.width, p.parent.height);
  const ax: Anchor = Math.abs(left) <= tol ? "start" : Math.abs(right - p.parent.width) <= tol ? "end" : "center";
  const ay: Anchor = Math.abs(top) <= tol ? "start" : Math.abs(bottom - p.parent.height) <= tol ? "end" : "center";
  return { ax, ay };
}

const pick = (a: Anchor, start: number, size: number) => (a === "start" ? start : a === "end" ? start + size : start + size / 2);

/** The transform that puts content with local visible box `nv` (scaled
 *  uniformly by `s`) where the old content stood. Rotation is kept; flips of
 *  the old object are kept as well. */
export function placementFor(p: PlacementInput, nv: Box, s: number): Transform {
  const t = p.transform;
  const { ax, ay } = anchorsOf(p);
  const sx = s * Math.sign(t.scaleX || 1);
  const sy = s * Math.sign(t.scaleY || 1);
  const rot = t.rotation;
  // The old anchor point in parent space.
  const mOld = fromTransform(t);
  const ox = pick(ax, p.visible.x, p.visible.w);
  const oy = pick(ay, p.visible.y, p.visible.h);
  const target = { x: mOld.a * ox + mOld.c * oy + mOld.e, y: mOld.b * ox + mOld.d * oy + mOld.f };
  // The same anchor on the new content, through the new linear part.
  const nx = pick(ax, nv.x, nv.w);
  const ny = pick(ay, nv.y, nv.h);
  const mNew = fromTransform({ x: 0, y: 0, scaleX: sx, scaleY: sy, rotation: rot } as Transform);
  return {
    ...t,
    x: target.x - (mNew.a * nx + mNew.c * ny),
    y: target.y - (mNew.b * nx + mNew.d * ny),
    scaleX: sx,
    scaleY: sy,
    rotation: rot,
  };
}

// --- building the new node ------------------------------------------------------

/** What replaces the object: a workspace asset, read as SVG or as an image. */
export interface ReplacementSource {
  url: string;
  name: string;
}

export interface Prepared {
  node: Node;
  assets: AssetRef[];
  /** True for a raster image (photo-like when also opaque). */
  isImage: boolean;
}

/** Load a replacement: an SVG becomes an editable vector group (like placing
 *  a logo), anything else an image node at its natural pixel size. */
export async function prepareReplacement(src: ReplacementSource): Promise<Prepared> {
  let text = "";
  try {
    const res = await fetch(src.url, { credentials: "include" });
    if (res.ok && /svg|xml|text/i.test(res.headers.get("content-type") ?? "")) text = await res.text();
  } catch {
    /* fall back to loading it as an image */
  }
  if (/<svg[\s>]/i.test(text)) {
    await prepareSvgFonts(text);
    const { nodes } = flattenSvgToNodes(text, { fallbackFill: true });
    const vb = /viewBox\s*=\s*"([^"]+)"/i.exec(text)?.[1]?.trim().split(/[\s,]+/).map(Number);
    const w = (vb && vb[2]) || 24;
    const h = (vb && vb[3]) || 24;
    const group = createNode("group", {
      name: src.name,
      children: nodes,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      size: { width: w, height: h },
    } as Partial<Node>);
    return { node: group, assets: [], isImage: false };
  }
  const assetId = `asset-${crypto.randomUUID()}`;
  imageAssets.register(assetId, src.url);
  await whenImagesReady({ type: "image", source: { assetId } } as unknown as Node, []);
  const img = imageAssets.image(assetId) as { naturalWidth?: number; naturalHeight?: number } | null;
  const nw = img?.naturalWidth || 0;
  const nh = img?.naturalHeight || 0;
  if (!nw || !nh) throw new Error("image could not be loaded");
  const node = createNode("image", {
    name: src.name,
    source: { assetId, naturalWidth: nw, naturalHeight: nh },
    fit: "contain",
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    size: { width: nw, height: nh },
  } as Partial<Node>);
  const ref: AssetRef = { id: assetId, kind: "image", url: src.url, mime: "image/*", checksum: "" };
  return { node, assets: [ref], isImage: true };
}

/** Properties of the old object the replacement keeps: how it is shown, not
 *  what it shows (alt text, crop and source belong to the old content). */
const KEPT = ["opacity", "blendMode", "effects", "constraints", "link", "animations", "animation", "interaction", "decorative", "aspectLocked"] as const;

/** The finished replacement node for `mode`, ready to swap in. */
export function finishReplacement(
  old: Node,
  oldVisible: Visible,
  prepared: Prepared,
  newVisible: Visible,
  parent: { width: number; height: number },
  mode: ReplaceMode,
): { node: Node; mode: Exclude<ReplaceMode, "auto"> } {
  const oldIsPhoto = old.type === "image" && oldVisible.opaque;
  const newIsPhoto = prepared.isImage && newVisible.opaque;
  const m = mode === "auto" ? autoMode(oldIsPhoto, newIsPhoto) : mode;
  const node = JSON.parse(JSON.stringify(prepared.node)) as Node;
  const rec = node as unknown as Record<string, unknown>;
  const src = old as unknown as Record<string, unknown>;
  for (const k of KEPT) {
    if (src[k] !== undefined) rec[k] = JSON.parse(JSON.stringify(src[k]));
    else delete rec[k];
  }
  if (m === "cover" && oldIsPhoto && prepared.isImage) {
    // Photo for photo: the frame stays exactly; the image is cropped to fill it.
    node.transform = { ...old.transform };
    node.size = { ...old.size };
    (node as unknown as { fit: string }).fit = "cover";
    return { node, mode: m };
  }
  const t = old.transform;
  const ow = oldVisible.box.w * Math.abs(t.scaleX);
  const oh = oldVisible.box.h * Math.abs(t.scaleY);
  const s = scaleFor(m, ow, oh, newVisible.box.w, newVisible.box.h);
  node.transform = placementFor({ transform: t, size: old.size, visible: oldVisible.box, parent }, newVisible.box, s);
  return { node, mode: m };
}
