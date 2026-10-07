// Colour management for print exports: sRGB (how every design is authored)
// to the CMYK of a printing condition, through its ICC output profile, with
// LittleCMS (lcms-wasm). Loaded on first use only.

/** How out-of-gamut colours are brought into the press gamut. */
export type RenderingIntent = "relative" | "perceptual";

export interface CmykConverter {
  /** The profile's own name, e.g. "PSO Coated v3". */
  readonly description: string;
  /** The ICC bytes, for embedding in the exported file. */
  readonly icc: Uint8Array;
  /** One sRGB colour (0..1) to CMYK (0..1). Cached per colour. */
  cmyk(r: number, g: number, b: number): [number, number, number, number];
  /** RGBA pixels (straight alpha) composited on paper white, to interleaved
   *  CMYK bytes (0..255 = 0..100 % ink). */
  pixels(rgba: Uint8Array | Uint8ClampedArray, count: number): Uint8Array;
  dispose(): void;
}

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

/** Throws when the bytes are not a usable CMYK output profile. */
export async function createCmykConverter(icc: Uint8Array, intent: RenderingIntent = "relative"): Promise<CmykConverter> {
  const { lcms, L } = await loadLcms();
  const out = lcms.cmsOpenProfileFromMem(icc, icc.byteLength);
  if (!out) throw new Error("not a readable ICC profile");
  if (lcms.cmsGetColorSpaceASCII(out) !== "CMYK") {
    lcms.cmsCloseProfile(out);
    throw new Error("not a CMYK profile");
  }
  const description = lcms.cmsGetProfileInfoASCII(out, L.cmsInfoDescription, "en", "US").trim();
  const srgb = lcms.cmsCreate_sRGBProfile();
  // Black point compensation maps sRGB black to the press's deepest black
  // instead of clipping shadow detail.
  const xf = lcms.cmsCreateTransform(
    srgb, L.TYPE_RGB_8, out, L.TYPE_CMYK_8,
    intent === "perceptual" ? L.INTENT_PERCEPTUAL : L.INTENT_RELATIVE_COLORIMETRIC,
    L.cmsFLAGS_BLACKPOINTCOMPENSATION,
  );
  if (!xf) {
    lcms.cmsCloseProfile(srgb);
    lcms.cmsCloseProfile(out);
    throw new Error("the profile has no usable colour tables");
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
    dispose() {
      lcms.cmsDeleteTransform(xf);
      lcms.cmsCloseProfile(srgb);
      lcms.cmsCloseProfile(out);
    },
  };
}
