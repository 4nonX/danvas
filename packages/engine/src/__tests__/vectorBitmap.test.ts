// SVG images on screen come from a cached bitmap the provider makes, at a
// resolution never below what the draw needs; vector exports keep the SVG.
import { describe, expect, it } from "vitest";
import type { DesignFile, Node } from "@hc/schema";
import { createScene } from "../scene";
import { renderScene } from "../render2d";
import type { AssetProvider, Viewport } from "../types";

const SVG = { width: 100, height: 80, naturalWidth: 100, naturalHeight: 80, tag: "svg" };

function file(node: Partial<Node> = {}): DesignFile {
  return {
    schemaVersion: 29, id: "d", title: "t", assets: [], fonts: [], meta: {},
    pages: [{
      id: "p1", width: 400, height: 400,
      children: [{
        id: "img", type: "image",
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
        size: { width: 100, height: 80 }, opacity: 1, blendMode: "normal",
        source: { assetId: "flower", naturalWidth: 100, naturalHeight: 80 },
        fit: "fill",
        ...node,
      }],
    }],
  } as unknown as DesignFile;
}

/** A canvas stand-in: every method a no-op, drawImage recorded, scale `s`. */
function ctxWith(s: number, opts: { canvas?: boolean } = {}) {
  const draws: unknown[][] = [];
  const target: Record<string | symbol, unknown> = {
    drawImage: (...args: unknown[]) => { draws.push(args); },
    getTransform: () => ({ a: s, b: 0, c: 0, d: s, e: 0, f: 0 }),
    measureText: () => ({ width: 0 }),
  };
  if (opts.canvas !== false) target.canvas = {};
  const ctx = new Proxy(target, { get: (t, p) => (p in t ? t[p] : p === "canvas" ? undefined : () => {}), set: (t, p, v) => { t[p] = v; return true; } });
  return { ctx, draws };
}

function provider(vector = true) {
  const asked: [number, number][] = [];
  const p: AssetProvider = {
    image: () => SVG,
    status: () => "ready",
    onChange: () => () => {},
    raster: (_id, w, h) => { asked.push([w, h]); return vector ? { width: w, height: h, tag: "bitmap" } : null; },
  };
  return { p, asked };
}

const vp = (zoom: number): Viewport => ({ zoom, panX: 0, panY: 0, dpr: 1, width: 400, height: 400 });

describe("SVG images from a cached bitmap", () => {
  it("draws the bitmap, sized to the next power of two of what the screen needs", () => {
    const { p, asked } = provider();
    const { ctx, draws } = ctxWith(3);
    renderScene(createScene(file()), ctx as never, vp(1), { assets: p });
    // Three device pixels per source pixel: a bitmap at four times the size.
    expect(asked).toEqual([[400, 320]]);
    const d = draws.find((a) => (a[0] as { tag?: string }).tag);
    expect((d![0] as { tag: string }).tag).toBe("bitmap");
    // The whole source, in the bitmap's own pixels.
    expect(d!.slice(1, 5)).toEqual([0, 0, 400, 320]);
  });

  it("keeps the crop: the same part of the picture, in the bitmap's pixels", () => {
    const cropped = file({ crop: { x: 0.5, y: 0.25, width: 0.5, height: 0.5 } } as Partial<Node>);
    const { p } = provider();
    const withBitmap = ctxWith(1);
    renderScene(createScene(cropped), withBitmap.ctx as never, vp(1), { assets: p });
    const plain = ctxWith(1);
    renderScene(createScene(cropped), plain.ctx as never, vp(1), { assets: { image: () => SVG, status: () => "ready", onChange: () => () => {} } });
    const b = withBitmap.draws.find((a) => (a[0] as { tag?: string }).tag === "bitmap")!;
    const d = plain.draws.find((a) => (a[0] as { tag?: string }).tag === "svg")!;
    const k = (b[0] as { width: number }).width / 100;
    (b.slice(1, 5) as number[]).forEach((v, i) => expect(v / k).toBeCloseTo(d[i + 1] as number, 6));
    // Where it lands on the page is unchanged.
    expect(b.slice(5)).toEqual(d.slice(5));
  });

  it("draws the SVG itself where the provider has no bitmap (not a vector)", () => {
    const { p } = provider(false);
    const { ctx, draws } = ctxWith(2);
    renderScene(createScene(file()), ctx as never, vp(1), { assets: p });
    expect((draws[0][0] as { tag: string }).tag).toBe("svg");
  });

  it("leaves vector backends (PDF, EPS, SVG export) on the SVG: they have no canvas", () => {
    const { p, asked } = provider();
    const { ctx, draws } = ctxWith(2, { canvas: false });
    renderScene(createScene(file()), ctx as never, vp(1), { assets: p });
    expect(asked).toEqual([]);
    expect((draws[0][0] as { tag: string }).tag).toBe("svg");
  });

  it("works with providers that do not offer bitmaps at all", () => {
    const { ctx, draws } = ctxWith(2);
    const plain: AssetProvider = { image: () => SVG, status: () => "ready", onChange: () => () => {} };
    renderScene(createScene(file()), ctx as never, vp(1), { assets: plain });
    expect((draws[0][0] as { tag: string }).tag).toBe("svg");
  });

  it("asks for a smaller bitmap when a deep zoom would make it huge", () => {
    const { p, asked } = provider();
    const { ctx } = ctxWith(1000);
    renderScene(createScene(file()), ctx as never, vp(1), { assets: p });
    const [w, h] = asked[0];
    expect(w * h).toBeLessThanOrEqual(16_000_000);
  });
});
