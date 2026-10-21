// Print colours a user enters: explicit CMYK values and spot colours (schema
// `Color.cmyk`, `Color.spot`). Print exports write them as given; the screen
// shows them through the design's colour profile (page panel; else the
// default, else the bundled one), so a C73 M25 Y7 K0 blue looks on screen
// like it prints on that paper rather than like a naive formula.

import type { Color } from "@hc/schema";
import { cmykToRgb } from "@hc/color";
import type { CmykConverter } from "./cms";
import { BUILTIN_PROFILE_ID, profileBytes } from "./profiles";

export type Cmyk4 = { c: number; m: number; y: number; k: number };

// One converter per profile, loaded once; `ready` is the screen proof in use.
const converters = new Map<string, Promise<CmykConverter | null>>();
let proofId = BUILTIN_PROFILE_ID;
let ready: CmykConverter | null = null;

function converterFor(id: string): Promise<CmykConverter | null> {
  let c = converters.get(id);
  if (!c) {
    c = (async () => {
      try {
        const { createCmykConverter } = await import("./cms");
        return await createCmykConverter(await profileBytes(id), "relative");
      } catch {
        converters.delete(id); // try again next time
        return null;
      }
    })();
    converters.set(id, c);
  }
  return c;
}

/** Loads the screen proof (the current profile) once; null when it cannot. */
export async function loadScreenProof(): Promise<CmykConverter | null> {
  const id = proofId;
  const c = (await converterFor(id)) ?? (id !== BUILTIN_PROFILE_ID ? await converterFor(BUILTIN_PROFILE_ID) : null);
  if (id === proofId) ready = c;
  return c;
}

/** Shows print colours through `id` from now on (the design's colour
 *  profile); the bundled profile when that one cannot be loaded. */
export async function setScreenProofProfile(id: string): Promise<CmykConverter | null> {
  proofId = id;
  return loadScreenProof();
}

/** The screen sRGB (0..1) of CMYK values (0..1): through the profile once it
 *  is loaded, else the plain formula. */
export function cmykToScreen(v: Cmyk4): { r: number; g: number; b: number } {
  if (ready) {
    const px = ready.proof(Uint8Array.from([v.c, v.m, v.y, v.k].map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255))), 1, false);
    return { r: px[0] / 255, g: px[1] / 255, b: px[2] / 255 };
  }
  const c = cmykToRgb(v);
  return { r: c.srgb.r, g: c.srgb.g, b: c.srgb.b };
}

/** The CMYK the bundled profile makes of a screen colour (the starting point
 *  when someone switches a colour to exact CMYK); the plain formula until the
 *  profile is loaded. */
export function estimateCmyk(srgb: { r: number; g: number; b: number }): Cmyk4 {
  if (ready) {
    const [c, m, y, k] = ready.cmyk(srgb.r, srgb.g, srgb.b);
    return { c, m, y, k };
  }
  const k = 1 - Math.max(srgb.r, srgb.g, srgb.b);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 1 };
  return { c: (1 - srgb.r - k) / (1 - k), m: (1 - srgb.g - k) / (1 - k), y: (1 - srgb.b - k) / (1 - k), k };
}

/** A colour printed as exactly these CMYK values. */
export function cmykColor(v: Cmyk4, alpha = 1): Color {
  return { srgb: { ...cmykToScreen(v), a: alpha }, cmyk: { ...v } };
}

/** A colour printed as the spot colour `name` (its own plate); `fallback` is
 *  how it looks, and what a file without that plate prints. */
export function spotColor(name: string, fallback: Cmyk4, alpha = 1): Color {
  return { srgb: { ...cmykToScreen(fallback), a: alpha }, spot: { name, fallback: { ...fallback } } };
}

/** The spot colours a design uses (each name once, in order found): what a
 *  print file of it should carry as plates. */
export function spotNamesOf(doc: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const spot = o.spot as { name?: unknown } | undefined;
    if (o.srgb && spot && typeof spot.name === "string" && spot.name && !out.includes(spot.name)) out.push(spot.name);
    for (const k in o) if (k !== "srgb") walk(o[k]);
  };
  walk(doc);
  return out;
}

/** "C73 M25 Y7 K0", or the spot colour's name. */
export function printColorLabel(c: Color): string | null {
  if (c.spot?.name) return c.spot.name;
  if (c.cmyk) return `C${Math.round(c.cmyk.c * 100)} M${Math.round(c.cmyk.m * 100)} Y${Math.round(c.cmyk.y * 100)} K${Math.round(c.cmyk.k * 100)}`;
  return null;
}
