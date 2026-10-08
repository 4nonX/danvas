// @vitest-environment jsdom
// Uploaded SVGs are served from extension-less URLs (/api/v1/assets/<id>/content).
// The vector exports learn which images are SVG from the design's asset list
// and draw those at the size they cover on the page, not their small
// intrinsic pixel size.
import { beforeAll, describe, expect, it } from "vitest";
import { PdfCanvas, PdfResources } from "./pdfCanvas";

// jsdom has no canvas: a stand-in that hands back opaque pixels of the asked size.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    let fill = "#000000";
    return {
      get fillStyle() { return fill; },
      set fillStyle(v: string) { fill = v; },
      drawImage() {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }),
    } as unknown as CanvasRenderingContext2D;
  } as typeof HTMLCanvasElement.prototype.getContext;
});

const URL_ = "https://danvas.example/api/v1/assets/a1/content";
const svgImage = { src: URL_, naturalWidth: 40, naturalHeight: 40 } as unknown as CanvasImageSource;

function embeddedSize(vectorSources?: Set<string>) {
  const resources = new PdfResources();
  // Device space at 6.25 x the page (600 dpi for a 96 dpi design).
  const c = new PdfCanvas({ width: 5000, height: 5000, faces: new Map(), resources, vectorSources });
  c.setTransform(6.25, 0, 0, 6.25, 0, 0);
  c.drawImage(svgImage, 100, 100, 400, 400);
  const img = resources.images[0];
  return [img.width, img.height];
}

describe("SVG images in vector exports", () => {
  it("draws an SVG asset at the size it covers on the page", () => {
    expect(embeddedSize(new Set([URL_]))).toEqual([2500, 2500]);
  });

  it("keeps a raster image at its own pixel size", () => {
    expect(embeddedSize()).toEqual([40, 40]);
  });
});
