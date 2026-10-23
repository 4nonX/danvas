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
  /** CMYK (0..1) to CIE L*a*b* (D50) as it prints on this condition's paper
   *  (absolute colorimetric): the value a print shop measures and matches. */
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
  // CMYK to Lab for the colour list, made on first use.
  let toLab: number | null = null, labProfile: number | null = null;
  const CHUNK = 1 << 16;
  // The way back for the soft proof, made on first use.
  const back: { relative?: number; absolute?: number } = {};
  const backTransform = (paperWhite: boolean) => {
    const key = paperWhite ? "absolute" : "relative";
    back[key] ??= lcms.cmsCreateTransform(
      out, L.TYPE_CMYK_8, srgb, L.TYPE_RGB_8,
      paperWhite ? L.INTENT_ABSOLUTE_COLORIMETRIC : L.INTENT_RELATIVE_COLORIMETRIC,
      paperWhite ? 0 : L.cmsFLAGS_BLACKPOINTCOMPENSATION,
    );
    return back[key]!;
  };
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
      if (toLab === null) {
        labProfile = lcms.cmsCreateLab4Profile(null);
        toLab = lcms.cmsCreateTransform(out, L.TYPE_CMYK_16, labProfile, L.TYPE_Lab_16, L.INTENT_ABSOLUTE_COLORIMETRIC, 0);
      }
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
      const t = backTransform(paperWhite);
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
      if (toLab !== null) lcms.cmsDeleteTransform(toLab);
      if (labProfile !== null) lcms.cmsCloseProfile(labProfile);
      if (back.relative) lcms.cmsDeleteTransform(back.relative);
      if (back.absolute) lcms.cmsDeleteTransform(back.absolute);
      lcms.cmsDeleteTransform(xf);
      lcms.cmsCloseProfile(srgb);
      lcms.cmsCloseProfile(out);
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
