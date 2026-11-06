// @vitest-environment jsdom
// The provider makes and keeps bitmaps for SVG assets only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sdk", () => ({ resolveAssetUrl: (u: string) => u }));

let drawn = 0;
beforeEach(() => {
  drawn = 0;
  // An image that "loads" as soon as it gets a source.
  vi.stubGlobal("Image", function LoadingImage() {
    const el = document.createElement("img");
    Object.defineProperty(el, "src", {
      set(v: string) { el.setAttribute("src", v); queueMicrotask(() => el.onload?.(new Event("load"))); },
      get() { return el.getAttribute("src") ?? ""; },
    });
    return el;
  });
  HTMLCanvasElement.prototype.getContext = function () {
    return { drawImage: () => { drawn++; } } as unknown as CanvasRenderingContext2D;
  } as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => vi.unstubAllGlobals());

async function provider() {
  vi.resetModules();
  return (await import("./assetProvider")).imageAssets;
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("SVG bitmaps", () => {
  it("is not offered to the engine for now (1.9.9 froze Firefox), so SVGs draw as in 1.9.8", async () => {
    const p = await provider();
    expect("raster" in p).toBe(false);
  });

  it("makes one for an SVG, keeps it, and makes another only for a new size", async () => {
    const p = await provider();
    p.registerAll([{ id: "a", url: "/api/v1/assets/a/content", kind: "image", mime: "image/svg+xml" }]);
    await settle();
    const first = p.vectorRaster("a", 200, 100) as HTMLCanvasElement;
    expect(first).toBeInstanceOf(HTMLCanvasElement);
    expect([first.width, first.height]).toEqual([200, 100]);
    expect(p.vectorRaster("a", 200, 100)).toBe(first);
    expect(drawn).toBe(1);
    expect(p.vectorRaster("a", 400, 200)).not.toBe(first);
    expect(drawn).toBe(2);
  });

  it("knows an SVG by its kind, its type or its file name", async () => {
    const p = await provider();
    p.registerAll([
      { id: "k", url: "/x/k", kind: "svg" },
      { id: "n", url: "/files/flower.svg?v=2", kind: "image" },
    ]);
    p.register("d", "data:image/svg+xml;base64,AAAA");
    await settle();
    for (const id of ["k", "n", "d"]) expect(p.vectorRaster(id, 10, 10)).not.toBeNull();
  });

  it("makes none for a photo, a missing asset or one still loading", async () => {
    const p = await provider();
    p.registerAll([{ id: "photo", url: "/x/p.jpg", kind: "image", mime: "image/jpeg" }]);
    expect(p.vectorRaster("photo", 10, 10)).toBeNull();
    await settle();
    expect(p.vectorRaster("photo", 10, 10)).toBeNull();
    expect(p.vectorRaster("nope", 10, 10)).toBeNull();
    expect(drawn).toBe(0);
  });

  it("forgets an asset's bitmaps when it gets a new file", async () => {
    const p = await provider();
    p.register("a", "/x/a.svg");
    await settle();
    const before = p.vectorRaster("a", 50, 50);
    p.register("a", "/x/a-new.svg");
    await settle();
    expect(p.vectorRaster("a", 50, 50)).not.toBe(before);
  });
});
