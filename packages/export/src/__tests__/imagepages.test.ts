import { afterEach, describe, expect, it } from "vitest";
import { validate } from "@hc/schema";
import { bytesToBase64, imagePagesDesign } from "../index";

const png = (n: number) => new Uint8Array([137, 80, 78, 71, n]);

describe("imagePagesDesign", () => {
  it("makes one full-bleed image page per page image, at its own size, and validates", () => {
    const file = imagePagesDesign("Card", [
      { bytes: png(1), mime: "image/png", width: 1080, height: 1350 },
      { bytes: png(2), mime: "", width: 1920, height: 1080 },
    ]);
    expect(file.title).toBe("Card");
    expect(file.pages.map((p) => [p.width, p.height])).toEqual([[1080, 1350], [1920, 1080]]);
    const assets = (file as { assets?: { id: string; url: string; mime: string }[] }).assets ?? [];
    expect(assets.map((a) => a.url.slice(0, 22))).toEqual(["data:image/png;base64,", "data:image/png;base64,"]);
    expect(assets[1].mime).toBe("image/png"); // empty MIME falls back
    const img = file.pages[1].children[0] as unknown as { type: string; size: { width: number }; source: { assetId: string } };
    expect(img.type).toBe("image");
    expect(img.size.width).toBe(1920);
    expect(img.source.assetId).toBe(assets[1].id);
    expect(validate(file).ok).toBe(true);
  });

  it("refuses an export without pages or a page without a size", () => {
    expect(() => imagePagesDesign("x", [])).toThrow();
    expect(() => imagePagesDesign("x", [{ bytes: png(1), mime: "image/png", width: 0, height: 10 }])).toThrow();
  });
});

describe("bytesToBase64", () => {
  afterEach(() => {
    delete (globalThis as { __hostBytesToBase64?: unknown }).__hostBytesToBase64;
  });

  it("encodes like btoa, across chunk boundaries", () => {
    const data = new Uint8Array(0x8000 * 2 + 7).map((_, i) => (i * 31) % 256);
    expect(bytesToBase64(data)).toBe(Buffer.from(data).toString("base64"));
  });

  it("uses a host encoder when one is provided", () => {
    (globalThis as { __hostBytesToBase64?: (d: Uint8Array) => string }).__hostBytesToBase64 = (d) => `host:${d.length}`;
    expect(bytesToBase64(new Uint8Array(3))).toBe("host:3");
  });
});
