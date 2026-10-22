import { describe, expect, it } from "vitest";
import { createBlankDesign, type Node } from "@hc/schema";
import { createScene, defaultViewport, renderScene, type CanvasLike } from "../index";

// Records the rectangles of every path and every fill; any other context call
// is accepted and ignored.
function recorder() {
  const log = { rects: [] as number[][], fillRects: [] as number[][], fills: 0 };
  const target: Record<string, unknown> = {
    rect: (...a: number[]) => log.rects.push(a),
    fillRect: (...a: number[]) => log.fillRects.push(a),
    fill: () => { log.fills++; },
    measureText: () => ({ width: 0 }),
  };
  const ctx = new Proxy(target, {
    get: (t, k) => (k in t ? t[k as string] : () => undefined),
    set: (t, k, v) => { t[k as string] = v; return true; },
  }) as unknown as CanvasLike;
  return { ctx, log };
}

describe("QR modules", () => {
  it("are drawn at their exact cells as runs in one fill", () => {
    const d = createBlankDesign();
    // 3 modules plus the 8-module quiet zone in 110 px: every cell is 10 px.
    d.pages[0].children = [{
      id: "q", type: "qr", value: "x", ecLevel: "M",
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, size: { width: 110, height: 110 }, opacity: 1, blendMode: "normal",
      foreground: { srgb: { r: 0, g: 0, b: 0, a: 1 } }, background: { srgb: { r: 1, g: 1, b: 1, a: 1 } },
      modules: [[true, true, true], [true, false, true], [false, false, false]],
    } as unknown as Node];
    const { ctx, log } = recorder();
    renderScene(createScene(d), ctx, defaultViewport(800, 600));
    // Besides the page, the QR's background is the only fillRect; the modules are three runs.
    expect(log.fillRects.filter((r) => r[2] === 110)).toEqual([[0, 0, 110, 110]]);
    expect(log.rects).toEqual([[40, 40, 30, 10], [40, 50, 10, 10], [60, 50, 10, 10]]);
    expect(log.fills).toBe(1);
  });
});
