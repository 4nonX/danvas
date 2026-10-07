// How large to render an image before tracing it. The raster is sized only
// from the image's own visible source pixels: a few times upsampled (so the
// traced edges can sit between pixels), never below the source resolution
// unless the image alone exceeds the memory budget, and within the browser's
// canvas limits. No fixed minimum or maximum side, so tiny icons, huge logos
// and extreme aspect ratios are all treated the same relative to their pixels.

/** Render pixels budget for one trace (memory/time bound). */
export const PIXEL_BUDGET = 8e6;
/** Upsampling range: at most this many render pixels per source pixel. */
export const MAX_UPSAMPLE = 4;
/** Hard per-side canvas limit (browsers fail beyond ~16k). */
export const MAX_CANVAS_SIDE = 16384;

export interface RasterPlan {
  /** Render pixels per node unit (the engine viewport zoom). */
  zoom: number;
  /** Raster size. */
  width: number;
  height: number;
  /** Render pixels per source pixel (1 = source resolution). */
  upsample: number;
}

/** `nodeW/nodeH`: the node's size in document units; `srcW/srcH`: the
 *  visible source pixels (natural size times the crop fraction). */
export function planRaster(nodeW: number, nodeH: number, srcW: number, srcH: number): RasterPlan {
  const w = Math.max(1e-6, nodeW), h = Math.max(1e-6, nodeH);
  const sw = Math.max(1, srcW), sh = Math.max(1, srcH);
  // Source pixels per node unit (geometric mean covers non-uniform "fill").
  const srcPerUnit = Math.sqrt((sw / w) * (sh / h));
  let up = Math.min(MAX_UPSAMPLE, Math.sqrt(PIXEL_BUDGET / (sw * sh)));
  let zoom = srcPerUnit * up;
  zoom = Math.min(zoom, MAX_CANVAS_SIDE / w, MAX_CANVAS_SIDE / h);
  up = zoom / srcPerUnit;
  return {
    zoom,
    width: Math.max(1, Math.round(w * zoom)),
    height: Math.max(1, Math.round(h * zoom)),
    upsample: up,
  };
}
