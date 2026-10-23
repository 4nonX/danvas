// Brand graphics (F50): a kit's collections as named categories of graphics.
// Pure helpers over BrandKit["collections"]; every change returns a new
// collections array, saved as one kit update by the caller.

import type { BrandCollection } from "@hc/sdk";
import { tr } from "@/lib/i18n";

export type Collections = BrandCollection[];

/** The name a category shows: its own, else its kind's (collections made
 *  before categories had names). */
export function categoryName(c: BrandCollection): string {
  if (c.name?.trim()) return c.name.trim();
  return c.kind === "icons" ? tr("brand.kind_icons") : c.kind === "photos" ? tr("brand.kind_photos") : tr("brand.kind_graphics");
}

const newId = () => `c-${crypto.randomUUID()}`;

export function addCategory(cols: Collections, name: string): { collections: Collections; id: string } {
  const id = newId();
  return { collections: [...cols, { id, kind: "graphics", name: name.trim(), assetIds: [] }], id };
}

export function renameCategory(cols: Collections, id: string, name: string): Collections {
  return cols.map((c) => (c.id === id ? { ...c, name: name.trim() } : c));
}

export function deleteCategory(cols: Collections, id: string): Collections {
  return cols.filter((c) => c.id !== id);
}

/** Move a category one place up (-1) or down (+1). */
export function moveCategory(cols: Collections, id: string, by: -1 | 1): Collections {
  const i = cols.findIndex((c) => c.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= cols.length) return cols;
  const next = [...cols];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Add graphics to a category (each at most once in it). */
export function addGraphics(cols: Collections, id: string, assetIds: string[]): Collections {
  return cols.map((c) => (c.id === id ? { ...c, assetIds: [...c.assetIds, ...assetIds.filter((a, i) => !c.assetIds.includes(a) && assetIds.indexOf(a) === i)] } : c));
}

/** Take a graphic out of a category (the upload itself stays). */
export function removeGraphic(cols: Collections, id: string, assetId: string): Collections {
  return cols.map((c) => (c.id === id ? { ...c, assetIds: c.assetIds.filter((a) => a !== assetId) } : c));
}

/** Move a graphic to another category, at its end. */
export function moveGraphic(cols: Collections, from: string, to: string, assetId: string): Collections {
  if (from === to) return cols;
  return addGraphics(removeGraphic(cols, from, assetId), to, [assetId]);
}

/** Replace a graphic's file in place. */
export function replaceGraphic(cols: Collections, id: string, oldId: string, newAssetId: string): Collections {
  return cols.map((c) => (c.id === id ? { ...c, assetIds: c.assetIds.map((a) => (a === oldId ? newAssetId : a)) } : c));
}

/** A file name without its extension: the graphic's name. */
export function graphicName(filename: string | null | undefined): string {
  return (filename ?? "").replace(/\.[a-z0-9]+$/i, "").trim();
}

/** Keep the old extension when a graphic is renamed. */
export function renamedFilename(oldFilename: string | null | undefined, name: string): string {
  const ext = /\.[a-z0-9]+$/i.exec(oldFilename ?? "")?.[0] ?? "";
  return name.trim() + ext;
}

/** Drag payload of a brand graphic: JSON {url, svg, name}. */
export const BRAND_GRAPHIC_DRAG = "application/x-oc-brand-graphic";

export const GRAPHIC_TYPES = ["image/svg+xml", "image/png", "image/jpeg", "image/webp", "image/gif"];
export const GRAPHIC_ACCEPT = ".svg,.png,.jpg,.jpeg,.webp,.gif";

export function isGraphicFile(f: { name: string; type: string }): boolean {
  return GRAPHIC_TYPES.includes(f.type) || /\.(svg|png|jpe?g|webp|gif)$/i.test(f.name);
}

/** Whether an asset is an SVG (placed as editable shapes). */
export function isSvgAsset(a: { mimeType?: string | null; filename?: string | null }): boolean {
  return a.mimeType === "image/svg+xml" || /\.svg$/i.test(a.filename ?? "");
}
