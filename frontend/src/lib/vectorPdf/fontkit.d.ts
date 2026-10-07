// Minimal typings for the parts of fontkit HyCanvas uses (vector PDF glyph
// outlines, workspace font metadata).
declare module "fontkit" {
  export interface PathCommand {
    command: "moveTo" | "lineTo" | "quadraticCurveTo" | "bezierCurveTo" | "closePath";
    args: number[];
  }
  export interface Glyph {
    id: number;
    path: { commands: PathCommand[] };
    advanceWidth: number;
    /** The characters this glyph stands for (several for a ligature). */
    codePoints: number[];
  }
  export interface GlyphPosition {
    xAdvance: number;
    yAdvance: number;
    xOffset: number;
    yOffset: number;
  }
  export interface GlyphRun {
    glyphs: Glyph[];
    positions: GlyphPosition[];
  }
  export interface Font {
    unitsPerEm: number;
    postscriptName: string | null;
    bbox: { minX: number; minY: number; maxX: number; maxY: number };
    capHeight: number;
    ascent: number;
    descent: number;
    variationAxes: Record<string, { min: number; default: number; max: number }>;
    hasGlyphForCodePoint(codePoint: number): boolean;
    layout(text: string, features?: Record<string, boolean> | string[]): GlyphRun;
    getVariation(settings: Record<string, number>): Font;
    // Naming and style metadata (workspace font upload).
    getName(key: string): string | null;
    familyName: string;
    subfamilyName: string;
    italicAngle: number;
    "OS/2"?: { usWeightClass: number; fsSelection: { italic: boolean } };
  }
  export function create(buffer: Uint8Array, postscriptName?: string): Font | { fonts: Font[] };
}
