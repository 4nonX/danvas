// Minimal typings for the parts of lcms-wasm (LittleCMS) that cms.ts uses.
declare module "lcms-wasm" {
  type Handle = number;
  export interface LcmsModule {
    cmsOpenProfileFromMem(data: Uint8Array, size: number): Handle;
    cmsCreate_sRGBProfile(): Handle;
    cmsCreateLab4Profile(whitePoint: null): Handle;
    cmsCloseProfile(profile: Handle): void;
    cmsGetColorSpaceASCII(profile: Handle): string | null;
    cmsGetProfileInfoASCII(profile: Handle, info: number, language: string, country: string): string;
    cmsCreateTransform(input: Handle, inputFormat: number, output: Handle, outputFormat: number, intent: number, flags: number): Handle;
    cmsDoTransform(transform: Handle, input: Uint8Array | Uint16Array, count: number): Uint8Array | Uint16Array;
    cmsDeleteTransform(transform: Handle): void;
  }
  export function instantiate(opts?: { locateFile?: (name: string) => string }): Promise<LcmsModule>;
  export const TYPE_RGB_8: number;
  export const TYPE_CMYK_8: number;
  export const TYPE_RGB_16: number;
  export const TYPE_CMYK_16: number;
  export const TYPE_Lab_16: number;
  export const INTENT_PERCEPTUAL: number;
  export const INTENT_RELATIVE_COLORIMETRIC: number;
  export const INTENT_ABSOLUTE_COLORIMETRIC: number;
  export const cmsFLAGS_BLACKPOINTCOMPENSATION: number;
  export const cmsInfoDescription: number;
}
