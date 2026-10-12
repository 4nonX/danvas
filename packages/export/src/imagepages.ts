// A design made of page images: one full-bleed image per page at its own pixel
// size. This is how a Canva design that offers no PowerPoint export for every
// page arrives (it looks exactly like the Canva page, but is not editable).
//
// Pure and host-neutral: the caller measures the images (the browser through
// createImageBitmap, the server in Go) and passes their bytes, so the browser
// and the server-side import (backend/internal/pptxconv) build the very same
// file. Images are self-contained data: URL assets, as in the PPTX import.

import { createBlankDesign, createNode, type DesignFile, type Node } from "@hc/schema";
import { bytesToDataUrl } from "./base64";

export interface PageImage {
  bytes: Uint8Array;
  /** MIME type of the bytes; "image/png" when empty. */
  mime: string;
  width: number;
  height: number;
}

export function imagePagesDesign(title: string, images: PageImage[]): DesignFile {
  if (!images.length) throw new Error("the export has no pages");
  for (const im of images) {
    if (!(im.width > 0 && im.height > 0)) throw new Error("a page image has no size");
  }
  const file = createBlankDesign({ title, width: images[0].width, height: images[0].height });
  const assets: { id: string; kind: string; url: string; mime: string; checksum: string }[] = [];
  file.pages = [];
  for (let i = 0; i < images.length; i++) {
    const { width, height } = images[i];
    const mime = images[i].mime || "image/png";
    const assetId = `canva-page-${i + 1}`;
    assets.push({ id: assetId, kind: "image", url: bytesToDataUrl(images[i].bytes, mime), mime, checksum: "" });
    const image = createNode("image", {
      id: `canva-image-${i + 1}`,
      name: `Page ${i + 1}`,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      size: { width, height },
      source: { assetId, naturalWidth: width, naturalHeight: height },
      fit: "stretch",
    } as Partial<Node>);
    file.pages.push({ id: `canva-page-${i + 1}`, width, height, children: [image] } as never);
  }
  (file as { assets?: unknown[] }).assets = assets;
  return file;
}
