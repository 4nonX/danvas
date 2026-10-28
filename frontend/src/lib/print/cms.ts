// Colour management for print exports: sRGB (how every design is authored)
// to the CMYK of a printing condition, through its ICC output profile, with
// LittleCMS (lcms-wasm). Loaded on first use only.

import { CodedError } from "../errors";

/** How out-of-gamut colours are brought into the press gamut. */
export type RenderingIntent = "relative" | "perceptual";

export interface CmykConverter {
  /** The profile's own name, e.g. "PSO Coated v3". */
  readonly description: string;
  /** The ICC bytes, for embedding in the exported file. */
  readonly icc: Uint8Array;
  /** One sRGB colour (0..1) to CMYK (0..1). Cached per colour. */
  cmyk(r: number, g: number, b: number): [number, number, number, number];
  /** CMYK (0..1) to CIE L*a*b* (D50) as it prints on this condition's paper
   *  (absolute colorimetric: the profile's A2B1 table with its media white
   *  point): the value a print shop measures and matches. */
  lab(c: number, m: number, y: number, k: number): [number, number, number];
  /** RGBA pixels (straight alpha) composited on paper white, to interleaved
   *  CMYK bytes (0..255 = 0..100 % ink). */
  pixels(rgba: Uint8Array | Uint8ClampedArray, count: number): Uint8Array;
  /** Soft proof: interleaved CMYK bytes back to screen RGBA through the same
   *  profile, as the press would print them. `paperWhite` simulates the
   *  paper's own colour (absolute colorimetric); otherwise paper white shows
   *  as screen white (relative). */
  proof(cmyk: Uint8Array, count: number, paperWhite: boolean): Uint8ClampedArray;
  dispose(): void;
}

/** The ICC tables every print value is computed from, each with its ICC v4
 *  floating-point alternative: into CMYK perceptual (B2A0) and relative
 *  colorimetric (B2A1), out of CMYK colorimetric (A2B1: Lab values and the
 *  soft proof), A2B0 as the ICC specification requires, and the media white
 *  point (wtpt) absolute colorimetric Lab rests on. Without one of them
 *  LittleCMS would quietly use another table, and the value would no longer
 *  be the one the profile defines; such a profile is refused instead. The
 *  server checks the same list on upload (printprofiles.requiredTables). */
const REQUIRED_TABLES: [string, string | null][] = [["A2B0", "D2B0"], ["A2B1", "D2B1"], ["B2A0", "B2D0"], ["B2A1", "B2D1"], ["wtpt", null]];

/** The required tables a profile lacks; a tag counts when its data lies
 *  inside the file. Empty for anything too short to have a tag table. */
export function missingTables(icc: Uint8Array): string[] {
  if (icc.byteLength < 132) return REQUIRED_TABLES.map((t) => t[0]);
  const view = new DataView(icc.buffer, icc.byteOffset, icc.byteLength);
  const have = new Set<string>();
  const n = view.getUint32(128);
  for (let i = 0; i < n && 132 + 12 * i + 12 <= icc.byteLength; i++) {
    const at = 132 + 12 * i;
    const off = view.getUint32(at + 4), len = view.getUint32(at + 8);
    if (len > 0 && off + len <= icc.byteLength) have.add(String.fromCharCode(icc[at], icc[at + 1], icc[at + 2], icc[at + 3]));
  }
  return REQUIRED_TABLES.filter(([a, b]) => !have.has(a) && !(b && have.has(b))).map((t) => t[0]);
}

const incomplete = (what: string) =>
  new CodedError("errors.api_print_profile_incomplete", `the profile lacks colour tables needed for exact print values: ${what}`, { tables: what });

type Lcms = Awaited<ReturnType<(typeof import("lcms-wasm"))["instantiate"]>>;

let lcmsPromise: Promise<{ lcms: Lcms; L: typeof import("lcms-wasm") }> | null = null;
// In the browser LittleCMS loads at runtime from public/vendor/lcms-wasm
// (not bundled: its Emscripten build has Node-only branches the bundler
// cannot resolve); it finds lcms.wasm next to itself. Node (tests) imports
// the package directly.
const LCMS_URL = "/vendor/lcms-wasm/lcms.js";

function loadLcms() {
  lcmsPromise ??= (async () => {
    const spec = typeof window === "undefined" ? "lcms-wasm" : LCMS_URL;
    const L = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ spec)) as typeof import("lcms-wasm");
    return { lcms: await L.instantiate(), L };
  })().catch((e: unknown) => {
    lcmsPromise = null;
    throw e;
  });
  return lcmsPromise;
}

/** Throws when the bytes are not a usable CMYK output profile, or one
 *  without every table print values are computed from (missingTables). */
export async function createCmykConverter(icc: Uint8Array, intent: RenderingIntent = "relative"): Promise<CmykConverter> {
  const missing = missingTables(icc);
  const { lcms, L } = await loadLcms();
  const out = lcms.cmsOpenProfileFromMem(icc, icc.byteLength);
  if (!out) throw new Error("not a readable ICC profile");
  if (lcms.cmsGetColorSpaceASCII(out) !== "CMYK") {
    lcms.cmsCloseProfile(out);
    throw new Error("not a CMYK profile");
  }
  if (missing.length) {
    lcms.cmsCloseProfile(out);
    throw incomplete(missing.join(", "));
  }
  const description = lcms.cmsGetProfileInfoASCII(out, L.cmsInfoDescription, "en", "US").trim();
  const srgb = lcms.cmsCreate_sRGBProfile();
  const labProfile = lcms.cmsCreateLab4Profile(null);
  // Every transform is made here, at once, and each is checked: LittleCMS
  // returns no handle (0) for tables that do not compute, and nothing is
  // ever worked out another way. Black point compensation maps sRGB black to
  // the press's deepest black instead of clipping shadow detail.
  const xf = lcms.cmsCreateTransform(
    srgb, L.TYPE_RGB_8, out, L.TYPE_CMYK_8,
    intent === "perceptual" ? L.INTENT_PERCEPTUAL : L.INTENT_RELATIVE_COLORIMETRIC,
    L.cmsFLAGS_BLACKPOINTCOMPENSATION,
  ) || 0;
  // CMYK to Lab for the colour list.
  const toLab = lcms.cmsCreateTransform(out, L.TYPE_CMYK_16, labProfile, L.TYPE_Lab_16, L.INTENT_ABSOLUTE_COLORIMETRIC, 0) || 0;
  // The way back for the soft proof.
  const back = {
    relative: lcms.cmsCreateTransform(out, L.TYPE_CMYK_8, srgb, L.TYPE_RGB_8, L.INTENT_RELATIVE_COLORIMETRIC, L.cmsFLAGS_BLACKPOINTCOMPENSATION) || 0,
    absolute: lcms.cmsCreateTransform(out, L.TYPE_CMYK_8, srgb, L.TYPE_RGB_8, L.INTENT_ABSOLUTE_COLORIMETRIC, 0) || 0,
  };
  const release = () => {
    for (const t of [xf, toLab, back.relative, back.absolute]) if (t) lcms.cmsDeleteTransform(t);
    lcms.cmsCloseProfile(labProfile);
    lcms.cmsCloseProfile(srgb);
    lcms.cmsCloseProfile(out);
  };
  if (!xf || !toLab || !back.relative || !back.absolute) {
    release();
    throw incomplete("the colour tables do not compute");
  }
  const cache = new Map<number, [number, number, number, number]>();
  const CHUNK = 1 << 16;
  return {
    description,
    icc,
    cmyk(r, g, b) {
      const R = Math.round(Math.min(1, Math.max(0, r)) * 255), G = Math.round(Math.min(1, Math.max(0, g)) * 255), B = Math.round(Math.min(1, Math.max(0, b)) * 255);
      const key = (R << 16) | (G << 8) | B;
      let v = cache.get(key);
      if (!v) {
        const o = lcms.cmsDoTransform(xf, new Uint8Array([R, G, B]), 1) as Uint8Array;
        v = [o[0] / 255, o[1] / 255, o[2] / 255, o[3] / 255];
        cache.set(key, v);
      }
      return v;
    },
    lab(c, m, y, k) {
      const v = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 65535);
      return decodeLab16(lcms.cmsDoTransform(toLab, new Uint16Array([v(c), v(m), v(y), v(k)]), 1) as Uint16Array);
    },
    pixels(rgba, count) {
      const out8 = new Uint8Array(count * 4);
      const rgb = new Uint8Array(Math.min(count, CHUNK) * 3);
      for (let start = 0; start < count; start += CHUNK) {
        const n = Math.min(CHUNK, count - start);
        for (let i = 0; i < n; i++) {
          const j = (start + i) * 4;
          const a = rgba[j + 3] / 255;
          // Composite on paper white: transparent areas print no ink.
          rgb[i * 3] = rgba[j] * a + 255 * (1 - a);
          rgb[i * 3 + 1] = rgba[j + 1] * a + 255 * (1 - a);
          rgb[i * 3 + 2] = rgba[j + 2] * a + 255 * (1 - a);
        }
        const o = lcms.cmsDoTransform(xf, n === rgb.length / 3 ? rgb : rgb.subarray(0, n * 3), n) as Uint8Array;
        out8.set(o.subarray(0, n * 4), start * 4);
      }
      return out8;
    },
    proof(cmyk, count, paperWhite) {
      const t = paperWhite ? back.absolute : back.relative;
      const rgba = new Uint8ClampedArray(count * 4);
      for (let start = 0; start < count; start += CHUNK) {
        const n = Math.min(CHUNK, count - start);
        const o = lcms.cmsDoTransform(t, cmyk.subarray(start * 4, (start + n) * 4), n) as Uint8Array;
        for (let i = 0; i < n; i++) {
          const j = (start + i) * 4;
          rgba[j] = o[i * 3];
          rgba[j + 1] = o[i * 3 + 1];
          rgba[j + 2] = o[i * 3 + 2];
          rgba[j + 3] = 255;
        }
      }
      return rgba;
    },
    dispose() {
      release();
    },
  };
}

/** ICC v4 16-bit Lab: L 0..65535 for 0..100, a and b 0..65535 for -128..127. */
function decodeLab16(o: Uint16Array): [number, number, number] {
  return [(o[0] / 65535) * 100, o[1] / 257 - 128, o[2] / 257 - 128];
}

export interface LabConverter {
  /** One sRGB colour (0..1) to CIE L*a*b* (D50). */
  fromSrgb(r: number, g: number, b: number): [number, number, number];
  dispose(): void;
}

/** sRGB to Lab (D50), for colours that are not printed through a profile. */
export async function createLabConverter(): Promise<LabConverter> {
  const { lcms, L } = await loadLcms();
  const srgb = lcms.cmsCreate_sRGBProfile();
  const lab = lcms.cmsCreateLab4Profile(null);
  const xf = lcms.cmsCreateTransform(srgb, L.TYPE_RGB_16, lab, L.TYPE_Lab_16, L.INTENT_RELATIVE_COLORIMETRIC, 0);
  const v = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 65535);
  return {
    fromSrgb(r, g, b) {
      return decodeLab16(lcms.cmsDoTransform(xf, new Uint16Array([v(r), v(g), v(b)]), 1) as Uint16Array);
    },
    dispose() {
      lcms.cmsDeleteTransform(xf);
      lcms.cmsCloseProfile(lab);
      lcms.cmsCloseProfile(srgb);
    },
  };
}
