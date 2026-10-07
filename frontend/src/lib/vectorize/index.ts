// Vectorize an image node.
//
// SVG sources are already vectors: their shapes are converted 1:1
// (svgFlatten) and placed with the same crop/fit mapping the engine uses to
// draw the image, so the result is exact, not approximated.
//
// Raster sources are traced: the node is rendered exactly as it shows (crop,
// fit, alpha mask, adjustments) through the regular engine at a raster sized
// from its own source pixels (plan.ts), traced (trace.ts), and returned as
// colour layers of Bézier contours in the node's local space (0..w, 0..h).

import type { DesignFile, Node } from "@hc/schema";
import { createScene, fitRect, renderScene, type CanvasLike, type Viewport } from "@hc/engine";
import { imageAssets } from "@/lib/assetProvider";
import { resolveAssetUrl } from "@/lib/sdk";
import { flattenSvgToNodes } from "@/lib/svgFlatten";
import { traceImage, type TraceLayer, type TraceOptions } from "./trace";
import { planRaster } from "./plan";
import { upsampleBicubic } from "./resample";
import { ENHANCE_FACTOR, ENHANCE_MAX_PIXELS, enhanceWith, loadEnhancer } from "./enhance";

export type { TraceLayer } from "./trace";

/** Above this mean colour error the image is photographic rather than flat. */
export const PHOTO_ERROR = 9;

export interface VectorizeOptions {
  colors: number | "auto";
  detail: number;
  removeBackground: boolean;
  /** Enlarge with the learned upscaler instead of bicubic (enhance.ts). */
  enhance: boolean;
}

/** Why an asked-for Enhance did not run: the model could not load in this
 *  browser, or the image already has enough pixels of its own. */
export type EnhanceSkip = "unavailable" | "large";

export type VectorizeResult =
  | { kind: "traced"; layers: TraceLayer[]; width: number; height: number; photoLike: boolean; enhanced: boolean; enhanceSkip?: EnhanceSkip }
  | { kind: "svg"; nodes: Node[]; width: number; height: number };

type ImageLike = {
  source?: { assetId?: string; naturalWidth?: number; naturalHeight?: number };
  crop?: { x: number; y: number; width: number; height: number };
  fit?: string;
  focalPoint?: { x: number; y: number };
};

function assetIsSvg(doc: DesignFile, assetId: string): boolean {
  const ref = (doc as unknown as { assets?: { id: string; mime?: string; url?: string }[] }).assets?.find((a) => a.id === assetId);
  const url = ref?.url ?? imageAssets.url(assetId) ?? "";
  return /svg/i.test(ref?.mime ?? "") || /^data:image\/svg/i.test(url) || /\.svg(\?|#|$)/i.test(url);
}

/** SVG user-space box from viewBox, else width/height. */
function svgBox(svg: string): { x: number; y: number; w: number; h: number } | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  const vb = /viewBox\s*=\s*["']([^"']+)["']/i.exec(root)?.[1]?.trim().split(/[\s,]+/).map(Number);
  if (vb && vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) return { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
  const w = parseFloat(/\bwidth\s*=\s*["']([\d.]+)/i.exec(root)?.[1] ?? "");
  const h = parseFloat(/\bheight\s*=\s*["']([\d.]+)/i.exec(root)?.[1] ?? "");
  return w > 0 && h > 0 ? { x: 0, y: 0, w, h } : null;
}

/** Exact conversion of an SVG image: its shapes, mapped the way the engine
 *  maps the image (crop + fit), clipped to the node box when cropped. */
async function svgToVectorNodes(node: Node, url: string): Promise<Node[] | null> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return null;
  const svg = await res.text();
  const box = svgBox(svg);
  if (!box) return null;
  const { nodes } = flattenSvgToNodes(svg, { fallbackFill: true });
  if (!nodes.length) return null;
  const img = node as unknown as ImageLike;
  const w = node.size.width, h = node.size.height;
  const crop = img.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  // Same math as drawImageNode, with the SVG's user box as "source pixels".
  const fr = fitRect(box.w * crop.width, box.h * crop.height, w, h, (img.fit ?? "cover") as never, img.focalPoint);
  const sx = (crop.x + fr.source.x * crop.width) * box.w;
  const sy = (crop.y + fr.source.y * crop.height) * box.h;
  const sw = fr.source.width * crop.width * box.w;
  const sh = fr.source.height * crop.height * box.h;
  const kx = fr.dest.width / sw, ky = fr.dest.height / sh;
  const inner = {
    type: "group",
    id: crypto.randomUUID(),
    name: "SVG",
    transform: { x: fr.dest.x - (sx + box.x) * kx, y: fr.dest.y - (sy + box.y) * ky, scaleX: kx, scaleY: ky, rotation: 0 },
    size: { width: box.w, height: box.h },
    opacity: 1,
    children: nodes,
  } as unknown as Node;
  const cropped = sw < box.w - 1e-6 || sh < box.h - 1e-6 || fr.dest.x < -1e-6 || fr.dest.y < -1e-6 || fr.dest.width > w + 1e-6 || fr.dest.height > h + 1e-6;
  if (!cropped) return [inner];
  // Cropped or cover-fitted: clip to the node box like the image did.
  return [{
    type: "frame",
    id: crypto.randomUUID(),
    name: "SVG",
    clip: true,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    size: { width: w, height: h },
    opacity: 1,
    children: [inner],
  } as unknown as Node];
}

export async function vectorizeImageNode(
  doc: DesignFile,
  node: Node,
  opts: VectorizeOptions,
  onProgress?: (p: number) => void,
): Promise<VectorizeResult> {
  const w = node.size.width, h = node.size.height;
  const img = node as unknown as ImageLike;
  const assetId = img.source?.assetId;

  if (assetId && assetIsSvg(doc, assetId)) {
    const url = imageAssets.url(assetId);
    const nodes = url ? await svgToVectorNodes(node, resolveAssetUrl(url)).catch(() => null) : null;
    if (nodes) {
      onProgress?.(1);
      return { kind: "svg", nodes, width: w, height: h };
    }
  }

  // Visible source pixels: the loaded image's real size times the crop.
  const el = assetId ? (imageAssets.image(assetId) as { naturalWidth?: number; naturalHeight?: number } | null) : null;
  const natW = el?.naturalWidth || img.source?.naturalWidth;
  const natH = el?.naturalHeight || img.source?.naturalHeight;
  if (!natW || !natH) throw new Error("image not loaded yet");
  const plan = planRaster(w, h, natW * (img.crop?.width ?? 1), natH * (img.crop?.height ?? 1));

  // A one-node document: the node at the origin, upright, fully opaque.
  const clone = structuredClone(node) as Node & { opacity: number; effects?: unknown[]; blendMode?: string };
  clone.transform = { ...clone.transform, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  clone.opacity = 1;
  delete clone.effects;
  clone.blendMode = "normal" as never;
  const page = { ...doc.pages[0], id: "vectorize", width: w, height: h, children: [clone] } as DesignFile["pages"][number];
  delete (page as { background?: unknown }).background;
  const tmp = { ...doc, pages: [page] } as DesignFile;

  // Render at the source resolution and enlarge here with a bicubic filter:
  // the canvas would enlarge bilinearly, whose faceted edges make traced
  // straight lines wavy. Images beyond the budget render downsampled.
  const up = plan.upsample > 1 ? plan.upsample : 1;
  let baseZoom = plan.zoom / up;
  // At 1:1 the render is also aligned to the source pixel grid. A crop or
  // fit offset is usually fractional, and half a pixel off the grid every
  // 1 px line would be resampled into two half-strength pixels, which then
  // fade out of the trace.
  let panX = 0, panY = 0;
  if (up > 1) {
    const cw = natW * (img.crop?.width ?? 1), ch = natH * (img.crop?.height ?? 1);
    const fr = fitRect(cw, ch, w, h, (img.fit ?? "cover") as never, img.focalPoint);
    const zx = (fr.source.width * cw) / fr.dest.width, zy = (fr.source.height * ch) / fr.dest.height;
    if (Math.abs(zx - zy) <= 1e-3 * zx) {
      baseZoom = zx;
      const sx = ((img.crop?.x ?? 0) + fr.source.x * (img.crop?.width ?? 1)) * natW;
      const sy = ((img.crop?.y ?? 0) + fr.source.y * (img.crop?.height ?? 1)) * natH;
      const mod1 = (v: number) => v - Math.floor(v);
      panX = -(1 - mod1(fr.dest.x * baseZoom - sx)) / baseZoom;
      panY = -(1 - mod1(fr.dest.y * baseZoom - sy)) / baseZoom;
    }
  }
  const bw = Math.max(1, Math.ceil((w - panX) * baseZoom));
  const bh = Math.max(1, Math.ceil((h - panY) * baseZoom));
  const canvas = document.createElement("canvas");
  canvas.width = bw;
  canvas.height = bh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  ctx.imageSmoothingQuality = "high";
  const vp: Viewport = { zoom: baseZoom, panX, panY, dpr: 1, width: bw, height: bh };
  renderScene(createScene(tmp, 0), ctx as unknown as CanvasLike, vp, { assets: imageAssets, skipBackground: true });
  const base = ctx.getImageData(0, 0, bw, bh).data;

  // Enlarge: learned upscaler when asked and worthwhile, else bicubic.
  let big: Raster | null = up > 1 ? null : { data: base, width: bw, height: bh };
  let enhanced = false;
  let enhanceSkip: EnhanceSkip | undefined;
  const ENHANCE_SHARE = 0.7;
  if (!big && opts.enhance) {
    if (up < 2 || bw * bh > ENHANCE_MAX_PIXELS) enhanceSkip = "large";
    else {
      const four = await enhancedRaster(`${JSON.stringify(clone)}|${natW}x${natH}|${bw}x${bh}|${panX},${panY}`, base, bw, bh, (p) => onProgress?.(p * ENHANCE_SHARE));
      if (four) {
        enhanced = true;
        big = up === ENHANCE_FACTOR ? four : upsampleBicubic(four.data, four.width, four.height, up / ENHANCE_FACTOR);
      } else enhanceSkip = "unavailable";
    }
  }
  big ??= upsampleBicubic(base, bw, bh, up);
  const zoom = baseZoom * (big.width / bw);

  const traceOpts: TraceOptions = { colors: opts.colors, detail: opts.detail, scale: up, removeBackground: opts.removeBackground };
  const result = await traceImage(big.data, big.width, big.height, traceOpts, {
    onProgress: onProgress && (enhanced ? (p) => onProgress(ENHANCE_SHARE + p * (1 - ENHANCE_SHARE)) : onProgress),
    yieldFn: () => new Promise((r) => setTimeout(r, 0)),
  });
  // Render pixels -> node units.
  const k = 1 / zoom;
  const toNode = (p: { x: number; y: number }) => ({ x: p.x * k + panX, y: p.y * k + panY });
  const layers = result.layers.map((l) => ({
    color: l.color,
    contours: l.contours.map((c) => c.map((a) => ({ ...a, ...toNode(a), cIn: a.cIn && toNode(a.cIn), cOut: a.cOut && toNode(a.cOut) }))),
  }));
  return { kind: "traced", layers, width: w, height: h, photoLike: result.meanError > PHOTO_ERROR, enhanced, enhanceSkip };
}

// The panel re-traces on every option change; the enhanced raster depends
// only on the rendered image, so the last few are kept instead of running the
// model again.
type Raster = { data: Uint8ClampedArray; width: number; height: number };
const enhancedCache = new Map<string, { job: Promise<Raster | null>; progress: (p: number) => void }>();

function enhancedRaster(key: string, base: Uint8ClampedArray, w: number, h: number, onProgress: (p: number) => void) {
  const hit = enhancedCache.get(key);
  if (hit) {
    // A run still in flight reports its progress to the newest caller.
    hit.progress = onProgress;
    enhancedCache.delete(key);
    enhancedCache.set(key, hit);
    return hit.job;
  }
  const entry = { progress: onProgress, job: null as unknown as Promise<Raster | null> };
  entry.job = loadEnhancer()
    .then((run) => enhanceWith(run, base, w, h, (p) => entry.progress(p)))
    .catch((e: unknown) => {
      console.warn("vectorize: enhance unavailable", e);
      enhancedCache.delete(key);
      return null;
    });
  enhancedCache.set(key, entry);
  while (enhancedCache.size > 3) enhancedCache.delete(enhancedCache.keys().next().value!);
  return entry.job;
}
