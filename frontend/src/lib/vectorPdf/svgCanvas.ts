// The SVG backend of VectorCanvas (pdfCanvas.ts): the engine draws a page into
// it exactly as it draws to the screen, and it writes the result as SVG.
//   - paths, fills, strokes, clips, transparency, blend modes -> SVG elements
//   - linear/radial gradients -> <linearGradient>/<radialGradient>
//   - text -> glyph outlines from the real font files, so the file looks the
//     same on every machine, with or without the fonts installed
//   - images -> embedded PNG data
// Effects SVG cannot match exactly (shadows, CSS filters, conic gradients)
// become image patches rendered by the browser, like in the vector PDF.
// All coordinates are device space (page px * zoom); the root viewBox maps
// them back to the page size.

import { mul, type ClipPath, type GradientProxy, type Mat, type Rgba, type Seg, VectorCanvas, type VectorCanvasOptions } from "./pdfCanvas";

/** SVG number: at most two decimals (device space is already fine-grained). */
function n(v: number): string {
  if (!Number.isFinite(v)) return "0";
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
}

function pathData(path: Seg[]): string {
  let d = "";
  for (const s of path) {
    if (s.op === "M") d += `M${n(s.x)} ${n(s.y)}`;
    else if (s.op === "L") d += `L${n(s.x)} ${n(s.y)}`;
    else if (s.op === "C") d += `C${n(s.x1)} ${n(s.y1)} ${n(s.x2)} ${n(s.y2)} ${n(s.x)} ${n(s.y)}`;
    else d += "Z";
  }
  return d;
}

function hex(c: Rgba): string {
  const h = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

function matrix(m: Mat): string {
  const k = (v: number) => String(+v.toPrecision(7));
  return `matrix(${k(m.a)} ${k(m.b)} ${k(m.c)} ${k(m.d)} ${n(m.e)} ${n(m.f)})`;
}

/** "ColorDodge" -> "color-dodge"; "Normal" -> none. */
function blendStyle(blend: string | null): string {
  if (!blend || blend === "Normal") return "";
  return ` style="mix-blend-mode:${blend.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}"`;
}

function opacity(attr: string, a: number): string {
  return a < 0.999 ? ` ${attr}="${+a.toFixed(4)}"` : "";
}

function pngDataUrl(width: number, height: number, rgba: Uint8ClampedArray): string {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return c.toDataURL("image/png");
}

export interface SvgCanvasOptions extends VectorCanvasOptions {
  /** Prefix for element ids (unique per page when files are combined). */
  idPrefix?: string;
}

export class SvgCanvas extends VectorCanvas {
  private body: string[] = [];
  private defs: string[] = [];
  /** Groups (clips) opened in each save frame, closed on its restore. */
  private open: number[] = [0];
  private nextId = 0;
  private imageIds = new WeakMap<object, string>();

  constructor(protected readonly o: SvgCanvasOptions) {
    super(o);
  }

  private id(kind: string): string {
    return `${this.o.idPrefix ?? ""}${kind}${this.nextId++}`;
  }

  /** The page as a standalone SVG document of `width` x `height` (page units). */
  document(width: number, height: number, title?: string): string {
    const close = "</g>".repeat(this.open.reduce((a, b) => a + b, 0));
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${n(width)}" height="${n(height)}" viewBox="0 0 ${this.o.width} ${this.o.height}">` +
      (title ? `<title>${esc(title)}</title>` : "") +
      (this.defs.length ? `<defs>${this.defs.join("")}</defs>` : "") +
      this.body.join("") + close +
      "</svg>"
    );
  }

  protected emitSave(): void {
    this.open.push(0);
  }
  protected emitRestore(): void {
    const k = this.open.length > 1 ? this.open.pop()! : 0;
    if (k) this.body.push("</g>".repeat(k));
  }

  protected emitFill(path: Seg[], rule: CanvasFillRule, c: Rgba, alpha: number, blend: string): void {
    const fr = rule === "evenodd" ? ` fill-rule="evenodd"` : "";
    this.body.push(`<path d="${pathData(path)}" fill="${hex(c)}"${opacity("fill-opacity", alpha)}${fr}${blendStyle(blend)}/>`);
  }

  protected emitGradientFill(path: Seg[], rule: CanvasFillRule, g: GradientProxy, ctm: Mat, alpha: number, blend: string): void {
    const id = this.id("g");
    const stops = [...g.stops].sort((a, b) => a.offset - b.offset).map((s) => {
      const c = this.color(s.color);
      return `<stop offset="${+s.offset.toFixed(5)}" stop-color="${hex(c)}"${opacity("stop-opacity", c.a)}/>`;
    }).join("");
    const a = g.args;
    const geom = g.kind === "linear"
      ? `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${a[0]}" y1="${a[1]}" x2="${a[2]}" y2="${a[3]}"`
      : `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" fx="${a[0]}" fy="${a[1]}" fr="${a[2]}" cx="${a[3]}" cy="${a[4]}" r="${a[5]}"`;
    this.defs.push(`${geom} gradientTransform="${matrix(ctm)}">${stops}</${g.kind === "linear" ? "linear" : "radial"}Gradient>`);
    const fr = rule === "evenodd" ? ` fill-rule="evenodd"` : "";
    this.body.push(`<path d="${pathData(path)}" fill="url(#${id})"${opacity("fill-opacity", alpha)}${fr}${blendStyle(blend)}/>`);
  }

  protected emitStroke(path: Seg[], c: Rgba, alpha: number, blend: string): void {
    const s = this.s;
    const k = Math.sqrt(Math.abs(s.ctm.a * s.ctm.d - s.ctm.b * s.ctm.c)) || 1;
    let attrs = ` stroke="${hex(c)}" stroke-width="${n(s.lineWidth * k)}"`;
    if (s.lineCap !== "butt") attrs += ` stroke-linecap="${s.lineCap}"`;
    if (s.lineJoin !== "miter") attrs += ` stroke-linejoin="${s.lineJoin}"`;
    else if (s.miterLimit !== 4) attrs += ` stroke-miterlimit="${n(s.miterLimit)}"`;
    if (s.dash.length) {
      attrs += ` stroke-dasharray="${s.dash.map((d) => n(d * k)).join(" ")}"`;
      if (s.dashOffset) attrs += ` stroke-dashoffset="${n(s.dashOffset * k)}"`;
    }
    this.body.push(`<path d="${pathData(path)}" fill="none"${attrs}${opacity("stroke-opacity", alpha)}${blendStyle(blend)}/>`);
  }

  protected emitClip(path: Seg[], rule: CanvasFillRule): void {
    const id = this.id("c");
    const cr = rule === "evenodd" ? ` clip-rule="evenodd"` : "";
    // An empty path clips everything away, as on a canvas.
    this.defs.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${path.length ? pathData(path) : "M0 0Z"}"${cr}/></clipPath>`);
    this.body.push(`<g clip-path="url(#${id})">`);
    this.open[this.open.length - 1]++;
  }

  protected emitImage(source: object | null, width: number, height: number, rgba: Uint8ClampedArray, place: Mat, alpha: number, blend: string | null, clip?: ClipPath): void {
    // A reused image is embedded once and referenced from each placement.
    let id = source ? this.imageIds.get(source) : undefined;
    if (!id) {
      id = this.id("i");
      this.defs.push(`<image id="${id}" width="${width}" height="${height}" preserveAspectRatio="none" xlink:href="${pngDataUrl(width, height, rgba)}"/>`);
      if (source) this.imageIds.set(source, id);
    }
    // `place` maps the unit square; the image element spans width x height.
    const m = mul(place, { a: 1 / width, b: 0, c: 0, d: 1 / height, e: 0, f: 0 });
    const use = `<use xlink:href="#${id}" transform="${matrix(m)}"${opacity("opacity", alpha)}${blendStyle(blend)}/>`;
    if (clip) {
      const cid = this.id("c");
      const cr = clip.rule === "evenodd" ? ` clip-rule="evenodd"` : "";
      this.defs.push(`<clipPath id="${cid}" clipPathUnits="userSpaceOnUse"><path d="${pathData(clip.path)}"${cr}/></clipPath>`);
      this.body.push(`<g clip-path="url(#${cid})">${use}</g>`);
    } else {
      this.body.push(use);
    }
  }
}
