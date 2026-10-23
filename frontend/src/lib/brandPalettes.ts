// A brand's palettes (the colour groups on the Brand page, e.g. "Main brand",
// "Website", "Function colours"): add, rename, reorder and delete them, add a
// colour to one, move a colour between them. Pure: each returns the new
// palette list for one kit update. Designs keep their colours whatever
// happens here.

import type { BrandPalette, BrandSwatch } from "@hc/sdk";

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export function addPalette(palettes: readonly BrandPalette[], name: string): { palettes: BrandPalette[]; id: string } {
  const id = newId("p");
  return { palettes: [...palettes, { id, name: name.trim(), colors: [] }], id };
}

export function renamePalette(palettes: readonly BrandPalette[], id: string, name: string): BrandPalette[] {
  return palettes.map((p) => (p.id === id ? { ...p, name: name.trim() } : p));
}

/** One step up (-1) or down (1); unchanged at the ends. */
export function movePalette(palettes: readonly BrandPalette[], id: string, by: -1 | 1): BrandPalette[] {
  const i = palettes.findIndex((p) => p.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= palettes.length) return [...palettes];
  const out = [...palettes];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export function deletePalette(palettes: readonly BrandPalette[], id: string): BrandPalette[] {
  return palettes.filter((p) => p.id !== id);
}

/** The colour at the end of the palette `to` (the first palette, made when
 *  there is none, when `to` is not one). */
export function addColor(palettes: readonly BrandPalette[], to: string | null, color: Omit<BrandSwatch, "id">, fallbackName: string): BrandPalette[] {
  const swatch: BrandSwatch = { id: newId("s"), ...color };
  if (!palettes.length) return [{ id: newId("p"), name: fallbackName, colors: [swatch] }];
  const target = palettes.some((p) => p.id === to) ? to : palettes[0].id;
  return palettes.map((p) => (p.id === target ? { ...p, colors: [...p.colors, swatch] } : p));
}

/** Take a colour out of its palette and put it at the end of `to`. */
export function moveColor(palettes: readonly BrandPalette[], colorId: string, to: string): BrandPalette[] {
  const swatch = palettes.flatMap((p) => p.colors).find((c) => c.id === colorId);
  if (!swatch || !palettes.some((p) => p.id === to)) return [...palettes];
  if (palettes.find((p) => p.id === to)!.colors.some((c) => c.id === colorId)) return [...palettes];
  return palettes.map((p) => {
    const rest = p.colors.filter((c) => c.id !== colorId);
    return p.id === to ? { ...p, colors: [...rest, swatch] } : rest.length === p.colors.length ? p : { ...p, colors: rest };
  });
}
