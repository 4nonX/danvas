// Print bleed: the page background reaches into the bleed, and the editor's
// page clip takes it in, so artwork that runs off the edge shows up to the
// bleed line and no further.

import { describe, expect, it } from "vitest";
import { createScene } from "../scene";
import { pageBleed, renderScene } from "../render2d";
import type { DesignFile, Node } from "@hc/schema";

const rect = (x: number, w: number): Node => ({
  id: "r", type: "shape", shape: "rect",
  transform: { x, y: 10, scaleX: 1, scaleY: 1, rotation: 0 },
  size: { width: w, height: 50 }, opacity: 1, blendMode: "normal",
  fills: [{ type: "solid", color: { srgb: { r: 1, g: 0, b: 0, a: 1 } } }],
} as unknown as Node);

const fileWith = (bleed: number | undefined, node: Node): DesignFile => ({
  schemaVersion: 28, id: "d", title: "t", assets: [], fonts: [], meta: {},
  pages: [{ id: "p1", width: 400, height: 200, bleed, background: { type: "solid", color: { srgb: { r: 1, g: 1, b: 1, a: 1 } } }, children: [node] }],
} as unknown as DesignFile);

function record(bleed: number | undefined, node: Node, clipToPage: boolean) {
  const fills: number[][] = [];
  const rects: number[][] = [];
  let clips = 0;
  const noop = () => {};
  const ctx = new Proxy({ canvas: { width: 400, height: 200 }, measureText: () => ({ width: 0 }), createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }), createPattern: () => null } as Record<string, unknown>, {
    get: (t, k) => {
      if (k === "fillRect") return (...a: number[]) => { fills.push(a); };
      if (k === "rect") return (...a: number[]) => { rects.push(a); };
      if (k === "clip") return () => { clips++; };
      return k in t ? t[k as string] : noop;
    },
    set: (t, k, v) => { t[k as string] = v; return true; },
  });
  renderScene(createScene(fileWith(bleed, node), 0), ctx as never, { zoom: 1, panX: 0, panY: 0, dpr: 1, width: 400, height: 200 }, { clipToPage } as never);
  return { fills, rects, clips };
}

describe("print bleed", () => {
  it("reads only a positive number", () => {
    expect(pageBleed({})).toBe(0);
    expect(pageBleed({ bleed: -3 })).toBe(0);
    expect(pageBleed({ bleed: Number.NaN })).toBe(0);
    expect(pageBleed({ bleed: 11.5 })).toBe(11.5);
  });

  it("draws the page background into the bleed", () => {
    expect(record(10, rect(10, 50), false).fills[0]).toEqual([-10, -10, 420, 220]);
    expect(record(undefined, rect(10, 50), false).fills[0].map((v) => v + 0)).toEqual([0, 0, 400, 200]);
  });

  it("clips overflow at the bleed line instead of the page edge", () => {
    const off = record(10, rect(-30, 80), true);
    expect(off.clips).toBeGreaterThan(0);
    expect(off.rects).toContainEqual([-10, -10, 420, 220]);
  });

  it("needs no clip for an element that stays within the bleed", () => {
    expect(record(10, rect(-8, 80), true).clips).toBe(0);
    expect(record(undefined, rect(-8, 80), true).clips).toBeGreaterThan(0);
  });
});
