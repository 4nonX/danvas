// Resolve color-system colors to CSS color strings for the Canvas2D path. The
// Color's canonical sRGB is used on screen; explicit cmyk/spot drive print
// export. ICC soft-proofing is a render-time transform layered on later.

import type { Color, Fill } from "@hc/schema";
import type { PrintColor } from "./types";

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function rgba(r: number, g: number, b: number, a: number): string {
  const c = (n: number) => Math.round(clamp01(n) * 255);
  return `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${clamp01(a)})`;
}

export function colorToCss(color: Color): string {
  const s = color.srgb;
  const css = rgba(s.r, s.g, s.b, s.a);
  printSink?.(css, printColorOf(color));
  return css;
}

/** The print values a colour carries: a spot colour (with its fallback
 *  CMYK) before explicit CMYK; null when it has neither. */
export function printColorOf(color: Color): PrintColor | null {
  const q = (c: { c: number; m: number; y: number; k: number }): [number, number, number, number] => [clamp01(c.c), clamp01(c.m), clamp01(c.y), clamp01(c.k)];
  if (color.spot?.name && color.spot.fallback) return { spot: { name: color.spot.name, cmyk: q(color.spot.fallback) } };
  if (color.cmyk) return { cmyk: q(color.cmyk) };
  return null;
}

// Set by renderScene for a context that takes print colours (synchronous, so
// one render at a time; restored afterwards for a nested one).
let printSink: ((css: string, print: PrintColor | null) => void) | null = null;

/** Runs `fn` with colour notes going to `sink` (the print export context). */
export function withPrintSink<T>(sink: ((css: string, print: PrintColor | null) => void) | null, fn: () => T): T {
  const prev = printSink;
  printSink = sink;
  try {
    return fn();
  } finally {
    printSink = prev;
  }
}

/** A flat CSS color for a fill (gradients fall back to a representative stop;
 *  real gradient/image painting is a GPU/2d-path enhancement). */
export function fillToCss(fill: Fill): string {
  switch (fill.type) {
    case "solid":
      return colorToCss(fill.color);
    case "gradient":
      if (fill.stops.length > 0) return colorToCss(fill.stops[0].color);
      if (fill.mesh && fill.mesh.points.length > 0) return colorToCss(fill.mesh.points[0].color);
      return "rgba(0, 0, 0, 0)";
    case "pattern":
    case "image":
      return "rgba(0, 0, 0, 0)"; // drawn as media/placeholder elsewhere
    default:
      return "rgba(0, 0, 0, 0)";
  }
}
