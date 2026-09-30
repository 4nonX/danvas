// Images attached to the AI chat.
//
// The chat's attachments were documents only: text the outline is grounded
// in. An image dropped there was refused, and one dragged in from Uploads or
// Stock was ignored outright. An attached image is now two things at once: a
// reference the assistant can look at (with a provider that reads images,
// its description and its palette ground the next generation the way a
// document does) and a picture it can place on a page when asked
// (placeAttachedImage). Reading happens here, in the browser: the image is
// drawn small once, for the vision call and for the palette, and a file from
// disk is uploaded to the workspace only when it is placed.

import { extractPalette, toHex } from "@hc/color";

export interface AiImageAttachment {
  id: string;
  name: string;
  /** What the thumbnail shows and what a placement uses: an object URL for a
   *  file from disk (until it is uploaded), else the asset or stock URL the
   *  in-app drag carried. */
  url: string;
  /** The file, when it came from disk; becomes a workspace upload when placed. */
  file?: File;
  width: number;
  height: number;
  /** A small PNG of the image (longest edge 768) for the vision call; empty
   *  when the pixels could not be read (a cross-origin picture). */
  preview: string;
  /** Dominant colours as hexes, most present first. */
  palette: string[];
  /** The vision model's reading of the image; absent until it arrives, and
   *  for good when the provider cannot see. */
  description?: string;
  /** True once the vision call finished, described or not. */
  read?: boolean;
  /** Stock provenance carried by an in-app drag, so a placed picture keeps
   *  its credit the way a canvas drop does. */
  provenance?: Record<string, unknown>;
}

/** How many images one chat may carry at once. */
export const maxAiImages = 4;

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i;

/** Whether a dropped or picked file is an image the chat can attach. */
export function isImageFile(f: { name: string; type?: string }): boolean {
  return (f.type ?? "").startsWith("image/") || IMAGE_FILE.test(f.name);
}

/** The picker's accept entry for images, beside the document list. */
export const attachableImageAccept = "image/*";

const PREVIEW_EDGE = 768;

export type ImageAttachmentSource = { file: File } | { url: string; name: string; provenance?: Record<string, unknown> };

/** A file name for a URL an in-app drag carried: its last path segment, or
 *  "image" for a data or blob URL. */
export function nameFromUrl(url: string): string {
  if (/^(data|blob):/i.test(url)) return "image";
  try {
    const path = new URL(url, "http://x").pathname;
    const last = path.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(last) || "image";
  } catch {
    return "image";
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  return new Promise((res, rej) => {
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("image unreadable"));
    img.src = url;
  });
}

/** Load an image (a file, or a URL an in-app drag carried) and read what the
 *  chat keeps of it: its size, a small preview, its palette. Throws when the
 *  image cannot be loaded at all; a picture whose pixels cannot be read (a
 *  cross-origin URL) still attaches, with no preview and no palette. */
export async function readImageAttachment(src: ImageAttachmentSource): Promise<AiImageAttachment> {
  const fromDisk = "file" in src ? src : null;
  const fromUrl = "file" in src ? null : src;
  const file = fromDisk?.file;
  const url = file ? URL.createObjectURL(file) : fromUrl!.url;
  const img = await loadImage(url);
  const width = img.naturalWidth || 1;
  const height = img.naturalHeight || 1;
  const scale = Math.min(1, PREVIEW_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  let preview = "";
  let palette: string[] = [];
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    palette = paletteOf({ width: data.width, height: data.height, data: data.data });
    preview = canvas.toDataURL("image/png");
  } catch {
    // A tainted canvas: the picture still attaches, as a picture to place.
  }
  return {
    id: `img-${Math.random().toString(36).slice(2, 10)}`,
    name: file?.name ?? fromUrl?.name ?? "image",
    url,
    file,
    width,
    height,
    preview,
    palette,
    ...(fromUrl?.provenance ? { provenance: fromUrl.provenance } : {}),
  };
}

/** The dominant colours of a bitmap as hexes, most present first. */
export function paletteOf(bmp: { width: number; height: number; data: Uint8ClampedArray | number[] }, count = 6): string[] {
  try {
    return extractPalette(bmp, count).map((c) => toHex(c).toUpperCase());
  } catch {
    return [];
  }
}

/** The grounding source an attached image contributes, once the provider has
 *  read it: what it shows and the colours it is made of. Null until then, so
 *  an unread picture grounds nothing rather than a bare file name. */
export function imageSource(img: AiImageAttachment): { name: string; text: string } | null {
  const description = img.description?.trim();
  if (!description) return null;
  const colours = img.palette.length ? ` Dominant colours: ${img.palette.join(", ")}.` : "";
  return {
    name: `Image: ${img.name}`,
    text: `An image the user attached as a reference (${img.width} by ${img.height} px).${colours}\nWhat it shows: ${description}`,
  };
}

/** The palette a generation takes when the workspace has no brand palette:
 *  the most recently attached image's, primary first. */
export function referencePalette(images: AiImageAttachment[]): string[] {
  for (let i = images.length - 1; i >= 0; i--) {
    if (images[i].palette.length) return images[i].palette.slice(0, 3);
  }
  return [];
}

/** The note the planner reads when images are attached: what they are and
 *  which tools act on them. The user's words alone rarely say "attached". */
export function imageAttachmentsNote(images: AiImageAttachment[]): string {
  if (!images.length) return "";
  const names = images.map((im) => im.name).join(", ");
  const read = images.some((im) => im.description);
  return (
    `[Note: the user attached ${images.length} image${images.length === 1 ? "" : "s"} in the chat (${names}). ` +
    `To put one on the page, plan placeAttachedImage (name: which one, pageIndex: optional). ` +
    (read
      ? `To create or restyle a design from or about them, plan generateDesign or generateTheme; the executor grounds the outline in what the images show.]`
      : `The provider has not read them, so they can only be placed.]`)
  );
}

/** The attached image a step names ("the logo", "photo.jpg"), matched on any
 *  part of the file name, else the most recently attached one. */
export function pickAttachedImage(images: AiImageAttachment[], name?: string): AiImageAttachment | null {
  if (!images.length) return null;
  const wanted = (name ?? "").trim().toLowerCase();
  if (wanted) {
    const stem = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]+$/i, "");
    const hit = images.find((im) => im.name.toLowerCase() === wanted || stem(im.name) === stem(wanted))
      ?? images.find((im) => im.name.toLowerCase().includes(wanted) || wanted.includes(stem(im.name)));
    if (hit) return hit;
  }
  return images[images.length - 1];
}
