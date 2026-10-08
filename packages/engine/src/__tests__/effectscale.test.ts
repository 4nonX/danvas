// Canvas shadows and CSS filters are measured in device pixels and ignore the
// transform. Effect lengths are authored in page units, so the renderer scales
// them by the transform: a shadow must look the same at every zoom, pixel
// ratio and export resolution (a 600 dpi PDF used to get a shadow 1/6 size).

import { describe, expect, it } from "vitest";
import { createScene } from "../scene";
import { deviceScale, renderScene, scaleFilterLengths } from "../render2d";
import type { DesignFile, Node } from "@hc/schema";

type M = [number, number, number, number, number, number];
const mul = (m: M, t: M): M => [
  m[0] * t[0] + m[2] * t[1], m[1] * t[0] + m[3] * t[1],
  m[0] * t[2] + m[2] * t[3], m[1] * t[2] + m[3] * t[3],
  m[0] * t[4] + m[2] * t[5] + m[4], m[1] * t[4] + m[3] * t[5] + m[5],
];

const shadowed: Node = {
  id: "s", type: "shape", shape: "rect",
  transform: { x: 10, y: 10, scaleX: 1, scaleY: 1, rotation: 0 },
  size: { width: 50, height: 50 }, opacity: 1, blendMode: "normal",
  fills: [{ type: "solid", color: { srgb: { r: 1, g: 0, b: 0, a: 1 } } }],
  effects: [{ kind: "shadow", type: "drop", color: { srgb: { r: 0, g: 0, b: 0, a: 0.5 } }, offsetX: 8, offsetY: 6, blur: 12, spread: 0 }],
} as unknown as Node;

const file = {
  schemaVersion: 19, id: "d", title: "t", assets: [], fonts: [], meta: {},
  pages: [{ id: "p1", width: 200, height: 100, children: [shadowed] }],
} as unknown as DesignFile;

/** The filters set while drawing, on a context that tracks its transform. */
function filtersAt(zoom: number): string[] {
  const filters: string[] = [];
  const noop = () => {};
  let m: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  const target: Record<string, unknown> = {
    canvas: { width: 200 * zoom, height: 100 * zoom },
    filter: "none",
    measureText: () => ({ width: 0 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => null,
    save: () => stack.push(m),
    restore: () => { m = stack.pop() ?? m; },
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => { m = [a, b, c, d, e, f]; },
    resetTransform: () => { m = [1, 0, 0, 1, 0, 0]; },
    transform: (a: number, b: number, c: number, d: number, e: number, f: number) => { m = mul(m, [a, b, c, d, e, f]); },
    translate: (x: number, y: number) => { m = mul(m, [1, 0, 0, 1, x, y]); },
    scale: (x: number, y: number) => { m = mul(m, [x, 0, 0, y, 0, 0]); },
    rotate: (r: number) => { m = mul(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]); },
    getTransform: () => ({ a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] }),
  };
  const ctx = new Proxy(target, {
    get: (t, k) => (k in t ? t[k as string] : noop),
    set: (t, k, v) => { if (k === "filter" && v !== "none") filters.push(v as string); t[k as string] = v; return true; },
  });
  renderScene(createScene(file, 0), ctx as never, { zoom, panX: 0, panY: 0, dpr: 1, width: 200 * zoom, height: 100 * zoom });
  return filters;
}

describe("effect lengths follow the transform", () => {
  it("scales px lengths in a filter string, leaving colours alone", () => {
    expect(scaleFilterLengths("drop-shadow(8px -6px 12.5px rgba(0, 0, 0, 0.5)) blur(.5px)", 2)).toBe("drop-shadow(16px -12px 25px rgba(0, 0, 0, 0.5)) blur(1px)");
    expect(scaleFilterLengths("blur(4px)", 1)).toBe("blur(4px)");
  });

  it("reads the device scale off the transform", () => {
    expect(deviceScale({ getTransform: () => ({ a: 3, b: 0, c: 0, d: 3, e: 5, f: 5 }) } as never)).toBe(3);
    expect(deviceScale({ getTransform: () => ({ a: 0, b: 2, c: -2, d: 0, e: 0, f: 0 }) } as never)).toBe(2); // rotated
    expect(deviceScale({} as never)).toBe(1); // no transform API: unscaled
  });

  it("draws a node's drop shadow at the same page size at zoom 1 and 3", () => {
    expect(filtersAt(1)).toEqual(["drop-shadow(8px 6px 12px rgba(0, 0, 0, 0.5))"]);
    expect(filtersAt(3)).toEqual(["drop-shadow(24px 18px 36px rgba(0, 0, 0, 0.5))"]);
  });
});
