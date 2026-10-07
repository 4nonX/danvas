// "Enhance before tracing": a learned 4x upscaler for flat artwork
// (Real-ESRGAN realesr-animevideov3, BSD-3-Clause, see
// tools/esr-convert/README.md) replaces the bicubic enlargement. It rebuilds
// crisp edges, round small details and continuous thin lines from a small
// anti-aliased source, which the tracer then follows.
//
// The model (public/models) and the onnxruntime-web runtime (WebGPU, falling
// back to CPU; the bundler emits its wasm with the app's static assets) are
// served by this app, never a CDN, and loaded on first use only.
//
// Transparent artwork runs the model on its alpha channel only: the shapes
// come from the model, the colours from the bicubic image (the model invents
// slight hue shifts on thin strokes, and the art's colours are flat anyway).
// Opaque images run it on RGB.

import { upsampleBicubic } from "./resample";

export const ENHANCE_FACTOR = 4;
/** Largest source raster (pixels) enhanced; beyond it the 4x result would not
 *  fit the trace budget anyway and the image has detail of its own. */
export const ENHANCE_MAX_PIXELS = 1_000_000;

// Fixed tile size keeps one input shape (no per-shape GPU recompiles); the
// pad covers the network's receptive field (17 stacked 3x3 convolutions).
const TILE = 96;
const PAD = 17;
const SIZE = TILE + 2 * PAD;

const MODEL_URL = "/models/realesr-animevideov3.onnx";

/** Runs the model on one 1x3xSxS tile (0..1, planar), returning 1x3x4Sx4S. */
export type TileRunner = (input: Float32Array, size: number) => Promise<Float32Array>;

let runner: Promise<TileRunner> | null = null;

/** Load (once) the model; rejects when it cannot run in this browser. */
export function loadEnhancer(): Promise<TileRunner> {
  runner ??= createRunner().catch((e: unknown) => {
    runner = null;
    throw e;
  });
  return runner;
}

async function createRunner(): Promise<TileRunner> {
  const ort = await import("onnxruntime-web/webgpu");
  // Its node-placement notes are warnings, not errors worth a console entry.
  ort.env.logLevel = "error";
  // Threads need a cross-origin isolated page; without it one thread.
  ort.env.wasm.numThreads = typeof crossOriginIsolated !== "undefined" && crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`enhance model: HTTP ${res.status}`);
  const model = new Uint8Array(await res.arrayBuffer());
  let session: Awaited<ReturnType<typeof ort.InferenceSession.create>> | null = null;
  if (typeof navigator !== "undefined" && "gpu" in navigator) {
    session = await ort.InferenceSession.create(model, { executionProviders: ["webgpu"], logSeverityLevel: 3 }).catch(() => null);
  }
  session ??= await ort.InferenceSession.create(model, { executionProviders: ["wasm"], logSeverityLevel: 3 });
  const s = session;
  return async (input, size) => {
    const out = await s.run({ input: new ort.Tensor("float32", input, [1, 3, size, size]) });
    return out.output.data as Float32Array;
  };
}

/** True when a noticeable part of the raster is (partly) transparent. */
export function hasTransparency(src: Uint8ClampedArray, w: number, h: number): boolean {
  const n = w * h;
  let t = 0;
  for (let i = 0; i < n; i++) if (src[i * 4 + 3] < 250) t++;
  return t > 0.01 * n;
}

/** Opaque copy whose transparent pixels take the colour of the nearest
 *  (mostly) opaque pixel, so colour interpolation never pulls in black. */
export function fillTransparentColor(src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const n = w * h;
  const out = new Uint8ClampedArray(src);
  const done = new Uint8Array(n);
  let queue: number[] = [];
  for (let i = 0; i < n; i++) if (src[i * 4 + 3] >= 128) { done[i] = 1; queue.push(i); }
  if (!queue.length) {
    for (let i = 0; i < n; i++) out[i * 4 + 3] = 255;
    return out;
  }
  // Breadth-first from the opaque pixels (4-neighbourhood).
  while (queue.length) {
    const next: number[] = [];
    for (const i of queue) {
      const x = i % w, y = (i - x) / w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j < 0 || done[j]) continue;
        done[j] = 1;
        out[j * 4] = out[i * 4]; out[j * 4 + 1] = out[i * 4 + 1]; out[j * 4 + 2] = out[i * 4 + 2];
        next.push(j);
      }
    }
    queue = next;
  }
  for (let i = 0; i < n; i++) out[i * 4 + 3] = 255;
  return out;
}

/** Enhance an RGBA raster 4x with the given tile runner. */
export async function enhanceWith(
  run: TileRunner,
  src: Uint8ClampedArray,
  w: number,
  h: number,
  onProgress?: (p: number) => void,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const F = ENHANCE_FACTOR;
  const W = w * F, H = h * F;
  const alphaMode = hasTransparency(src, w, h);
  const planes = [new Float32Array(W * H), new Float32Array(W * H), new Float32Array(W * H)];
  const input = new Float32Array(3 * SIZE * SIZE);
  const tilesX = Math.ceil(w / TILE), tilesY = Math.ceil(h / TILE);
  let done = 0;
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const x0 = tx * TILE - PAD, y0 = ty * TILE - PAD;
      // Edge pixels are repeated outside the image.
      for (let j = 0; j < SIZE; j++) {
        const sy = Math.min(h - 1, Math.max(0, y0 + j));
        for (let i = 0; i < SIZE; i++) {
          const sx = Math.min(w - 1, Math.max(0, x0 + i));
          const o = (sy * w + sx) * 4, t = j * SIZE + i;
          if (alphaMode) {
            const a = src[o + 3] / 255;
            input[t] = a; input[SIZE * SIZE + t] = a; input[2 * SIZE * SIZE + t] = a;
          } else {
            input[t] = src[o] / 255; input[SIZE * SIZE + t] = src[o + 1] / 255; input[2 * SIZE * SIZE + t] = src[o + 2] / 255;
          }
        }
      }
      const out = await run(input, SIZE);
      const OS = SIZE * F;
      // Keep only the tile's core (the padded margin overlaps neighbours).
      const cw = Math.min(TILE, w - tx * TILE) * F, ch = Math.min(TILE, h - ty * TILE) * F;
      for (let c = 0; c < 3; c++) {
        const plane = planes[c], base = c * OS * OS;
        for (let j = 0; j < ch; j++) {
          const srcRow = base + (PAD * F + j) * OS + PAD * F;
          const dstRow = (ty * TILE * F + j) * W + tx * TILE * F;
          plane.set(out.subarray(srcRow, srcRow + cw), dstRow);
        }
      }
      onProgress?.(++done / (tilesX * tilesY));
    }
  }
  const data = new Uint8ClampedArray(W * H * 4);
  if (alphaMode) {
    const colour = upsampleBicubic(fillTransparentColor(src, w, h), w, h, F).data;
    for (let i = 0; i < W * H; i++) {
      data[i * 4] = colour[i * 4]; data[i * 4 + 1] = colour[i * 4 + 1]; data[i * 4 + 2] = colour[i * 4 + 2];
      data[i * 4 + 3] = ((planes[0][i] + planes[1][i] + planes[2][i]) / 3) * 255;
    }
  } else {
    for (let i = 0; i < W * H; i++) {
      data[i * 4] = planes[0][i] * 255; data[i * 4 + 1] = planes[1][i] * 255; data[i * 4 + 2] = planes[2][i] * 255;
      data[i * 4 + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}
