// A Canvas2D-shaped drawing target that records vectors instead of pixels. The
// rendering engine draws a page into it exactly as it draws to the screen, so
// line breaks, positions, crops and grouping match the editor, while the output
// stays resolution independent. VectorCanvas holds everything format neutral
// (state, paths, text outlines, raster fallbacks); a backend writes the
// result: PdfCanvas below (vector PDF, EPS) and SvgCanvas (svgCanvas.ts).
// For PDF:
//   - paths, fills, strokes, clips, transparency and blend modes -> PDF vectors
//   - linear/radial gradients -> PDF shadings
//   - text -> vector glyph outlines from the real font files (fontSource.ts)
//   - images -> embedded at their full source resolution (SVG sources drawn at
//     device resolution)
// Whatever PDF cannot express (blurred shadows, CSS filters, conic or
// translucent gradients, text without a readable font file) is drawn for just
// that one operation on a scratch canvas at device resolution and embedded as
// an image patch, so nothing is ever dropped.
//
// Coordinates: "device" space is the engine's canvas space (page px * zoom,
// y down). Path points are stored in device space; the page content stream
// starts with one transform mapping device space to PDF points.

import type * as fontkit from "fontkit";
import { faceKeyOf, parseCanvasFont, type FaceRequest, type LoadedFace } from "./fontSource";

export type Mat = { a: number; b: number; c: number; d: number; e: number; f: number };
const IDENTITY: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function mul(m: Mat, t: Mat): Mat {
  return {
    a: m.a * t.a + m.c * t.b,
    b: m.b * t.a + m.d * t.b,
    c: m.a * t.c + m.c * t.d,
    d: m.b * t.c + m.d * t.d,
    e: m.a * t.e + m.c * t.f + m.e,
    f: m.b * t.e + m.d * t.f + m.f,
  };
}
function apply(m: Mat, x: number, y: number): [number, number] {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}
export function scaleOf(m: Mat): number {
  return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
}

/** PDF number: fixed point, no exponent notation. */
export function num(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const s = n.toFixed(4);
  return s.includes(".") ? s.replace(/\.?0+$/, "") || "0" : s;
}

export type Seg = { op: "M" | "L"; x: number; y: number } | { op: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number } | { op: "Z" };
export type Box = { x0: number; y0: number; x1: number; y1: number };

export function pathBox(path: Seg[]): Box | null {
  let b: Box | null = null;
  const add = (x: number, y: number) => {
    if (!b) b = { x0: x, y0: y, x1: x, y1: y };
    else { b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y); }
  };
  for (const s of path) {
    if (s.op === "Z") continue;
    if (s.op === "C") { add(s.x1, s.y1); add(s.x2, s.y2); }
    add(s.x, s.y);
  }
  return b;
}

function pathOps(path: Seg[]): string {
  const out: string[] = [];
  for (const s of path) {
    if (s.op === "M") out.push(`${num(s.x)} ${num(s.y)} m`);
    else if (s.op === "L") out.push(`${num(s.x)} ${num(s.y)} l`);
    else if (s.op === "C") out.push(`${num(s.x1)} ${num(s.y1)} ${num(s.x2)} ${num(s.y2)} ${num(s.x)} ${num(s.y)} c`);
    else out.push("h");
  }
  return out.join("\n");
}

/** Replay a device-space path on a real canvas (identity transform). */
function tracePath(ctx: CanvasRenderingContext2D, path: Seg[]): void {
  ctx.beginPath();
  for (const s of path) {
    if (s.op === "M") ctx.moveTo(s.x, s.y);
    else if (s.op === "L") ctx.lineTo(s.x, s.y);
    else if (s.op === "C") ctx.bezierCurveTo(s.x1, s.y1, s.x2, s.y2, s.x, s.y);
    else ctx.closePath();
  }
}

/** A canvas gradient as data, so it can become a PDF shading or, when PDF
 *  cannot express it, a real gradient on the fallback canvas. */
export class GradientProxy {
  stops: { offset: number; color: string }[] = [];
  constructor(
    readonly kind: "linear" | "radial" | "conic",
    readonly args: number[],
  ) {}
  addColorStop(offset: number, color: string): void {
    this.stops.push({ offset: Math.min(1, Math.max(0, offset)), color });
  }
  materialize(ctx: CanvasRenderingContext2D): CanvasGradient {
    const a = this.args;
    const g = this.kind === "linear"
      ? ctx.createLinearGradient(a[0], a[1], a[2], a[3])
      : this.kind === "radial"
        ? ctx.createRadialGradient(a[0], a[1], a[2], a[3], a[4], a[5])
        : ctx.createConicGradient(a[0], a[1], a[2]);
    for (const s of this.stops) g.addColorStop(s.offset, s.color);
    return g;
  }
}

export type Rgba = { r: number; g: number; b: number; a: number };

interface State {
  ctm: Mat;
  fillStyle: string | GradientProxy | unknown;
  strokeStyle: string | GradientProxy | unknown;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  miterLimit: number;
  dash: number[];
  dashOffset: number;
  globalAlpha: number;
  composite: string;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  letterSpacing: string;
  textRendering: string;
  fontKerning: CanvasFontKerning;
  direction: CanvasDirection;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  filter: string;
  clips: { path: Seg[]; rule: CanvasFillRule }[];
}

const BLEND: Record<string, string> = {
  "source-over": "Normal", multiply: "Multiply", screen: "Screen", overlay: "Overlay", darken: "Darken",
  lighten: "Lighten", "color-dodge": "ColorDodge", "color-burn": "ColorBurn", "hard-light": "HardLight",
  "soft-light": "SoftLight", difference: "Difference", exclusion: "Exclusion", hue: "Hue",
  saturation: "Saturation", color: "Color", luminosity: "Luminosity",
};

/** Raw image pixels waiting to be compressed into an image XObject. */
export interface PendingImage {
  name: string;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

/** Resources shared by every page of one PDF. */
export class PdfResources {
  images: PendingImage[] = [];
  extGStates = new Map<string, string>(); // key -> name
  shadings: { name: string; dict: string }[] = [];
  private imageIds = new WeakMap<object, string>();

  gs(fillAlpha: number, strokeAlpha: number, blend: string): string {
    const key = `${num(fillAlpha)}|${num(strokeAlpha)}|${blend}`;
    let name = this.extGStates.get(key);
    if (!name) {
      name = `GS${this.extGStates.size}`;
      this.extGStates.set(key, name);
    }
    return name;
  }

  extGStateDict(): string {
    const parts: string[] = [];
    for (const [key, name] of this.extGStates) {
      const [ca, CA, bm] = key.split("|");
      parts.push(`/${name} << /Type /ExtGState /ca ${ca} /CA ${CA} /BM /${bm} >>`);
    }
    return parts.join(" ");
  }

  addImage(source: object | null, width: number, height: number, rgba: Uint8ClampedArray): string {
    if (source) {
      const known = this.imageIds.get(source);
      if (known) return known;
    }
    const name = `Im${this.images.length}`;
    this.images.push({ name, width, height, rgba });
    if (source) this.imageIds.set(source, name);
    return name;
  }

  addShading(dict: string): string {
    const name = `Sh${this.shadings.length}`;
    this.shadings.push({ name, dict });
    return name;
  }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** Print colour output: vector colours and gradients written as CMYK. */
export interface ColorOut {
  /** sRGB 0..1 -> CMYK 0..1 through the output profile. */
  cmyk(r: number, g: number, b: number): [number, number, number, number];
  /** Pure black (text, lines, shapes) in black ink only (0/0/0/100), so it
   *  stays sharp on press instead of becoming a four-colour black. */
  blackOnly: boolean;
}

export interface VectorCanvasOptions {
  /** Device size of the page (engine canvas px). */
  width: number;
  height: number;
  /** Parsed fonts by face key; missing faces rasterize their text. */
  faces: Map<string, LoadedFace | null>;
  /** Collect pass: record the font faces text needs, draw nothing. */
  collect?: Map<string, FaceRequest>;
  /** Flatten transparency (for formats without it, e.g. EPS): a full-page
   *  device-resolution canvas, pre-filled with paper white, on which every
   *  operation is also drawn. Opaque operations stay vector; anything with
   *  opacity, a blend mode, an effect or soft edges becomes an opaque patch of
   *  this canvas, clipped to its outline, so the background it blends with is
   *  baked in exactly. */
  backdrop?: CanvasRenderingContext2D;
}

export interface PdfCanvasOptions extends VectorCanvasOptions {
  resources: PdfResources;
  /** Write colours as CMYK (default: DeviceRGB). */
  color?: ColorOut;
}

/** A clip outline in device space. */
export type ClipPath = { path: Seg[]; rule: CanvasFillRule };

/** Counters describing how a page was written (for tests and the UI). */
export interface PdfPageStats {
  vectorOps: number;
  textRuns: number;
  rasterPatches: number;
  images: number;
}

export abstract class VectorCanvas {
  protected s: State;
  private stack: State[] = [];
  private path: Seg[] = [];
  private measure: CanvasRenderingContext2D;
  private colorCtx: CanvasRenderingContext2D;
  private colorCache = new Map<string, Rgba>();
  private scratch: CanvasRenderingContext2D | null = null;
  readonly stats: PdfPageStats = { vectorOps: 0, textRuns: 0, rasterPatches: 0, images: 0 };
  // Engine capability probes: "filter" in ctx enables effect filters (which
  // this canvas rasterizes per operation); no `canvas` and no createPattern,
  // so the engine takes its non-layer / tiled-drawImage paths.
  imageSmoothingEnabled = true;
  imageSmoothingQuality: ImageSmoothingQuality = "high";

  constructor(protected readonly o: VectorCanvasOptions) {
    this.s = {
      ctm: IDENTITY, fillStyle: "#000000", strokeStyle: "#000000", lineWidth: 1, lineCap: "butt", lineJoin: "miter",
      miterLimit: 10, dash: [], dashOffset: 0, globalAlpha: 1, composite: "source-over", font: "10px sans-serif",
      textAlign: "start", textBaseline: "alphabetic", letterSpacing: "0px", textRendering: "auto", fontKerning: "auto",
      direction: "ltr", shadowColor: "rgba(0, 0, 0, 0)", shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, filter: "none", clips: [],
    };
    this.measure = makeCanvas(1, 1).getContext("2d")!;
    this.colorCtx = makeCanvas(1, 1).getContext("2d")!;
  }

  // --- backend ---------------------------------------------------------------
  // Everything below is written through these, in device space (y down).
  // Blend modes arrive as PDF names ("Normal", "Multiply", ...).
  protected abstract emitSave(): void;
  protected abstract emitRestore(): void;
  /** Fill with a solid colour (alpha already includes globalAlpha). */
  protected abstract emitFill(path: Seg[], rule: CanvasFillRule, c: Rgba, alpha: number, blend: string): void;
  /** Fill with a gradient whose geometry is in the space of `ctm`. */
  protected abstract emitGradientFill(path: Seg[], rule: CanvasFillRule, g: GradientProxy, ctm: Mat, alpha: number, blend: string): void;
  /** Stroke with a solid colour; line settings from the current state, the
   *  width and dashes scaled to device space with `scaleOf(ctm)`. */
  protected abstract emitStroke(path: Seg[], c: Rgba, alpha: number, blend: string): void;
  /** Intersect the clip with `path` until the matching restore. */
  protected abstract emitClip(path: Seg[], rule: CanvasFillRule): void;
  /** Place an image: `place` maps the unit square (rows top-down) to device
   *  space. `source` identifies a reusable image, null for one-off pixels.
   *  `blend` null: a plain, opaque patch (no graphics state). */
  protected abstract emitImage(source: object | null, width: number, height: number, rgba: Uint8ClampedArray, place: Mat, alpha: number, blend: string | null, clip?: ClipPath): void;

  // --- state ---------------------------------------------------------------
  save(): void {
    this.stack.push({ ...this.s, dash: [...this.s.dash], clips: [...this.s.clips] });
    this.emitSave();
  }
  restore(): void {
    const prev = this.stack.pop();
    if (!prev) return;
    this.s = prev;
    this.emitRestore();
  }
  setTransform(a: number | DOMMatrix2DInit, b?: number, c?: number, d?: number, e?: number, f?: number): void {
    if (typeof a === "object") this.s.ctm = { a: a.a ?? 1, b: a.b ?? 0, c: a.c ?? 0, d: a.d ?? 1, e: a.e ?? 0, f: a.f ?? 0 };
    else this.s.ctm = { a, b: b!, c: c!, d: d!, e: e!, f: f! };
  }
  resetTransform(): void { this.s.ctm = IDENTITY; }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.s.ctm = mul(this.s.ctm, { a, b, c, d, e, f });
  }
  translate(x: number, y: number): void { this.transform(1, 0, 0, 1, x, y); }
  scale(x: number, y: number): void { this.transform(x, 0, 0, y, 0, 0); }
  rotate(r: number): void { const c = Math.cos(r), s = Math.sin(r); this.transform(c, s, -s, c, 0, 0); }
  getTransform(): DOMMatrix {
    const m = this.s.ctm;
    return new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]);
  }

  get fillStyle() { return this.s.fillStyle as string; }
  set fillStyle(v: string) { this.s.fillStyle = v; }
  get strokeStyle() { return this.s.strokeStyle as string; }
  set strokeStyle(v: string) { this.s.strokeStyle = v; }
  get lineWidth() { return this.s.lineWidth; }
  set lineWidth(v: number) { if (Number.isFinite(v) && v > 0) this.s.lineWidth = v; }
  get lineCap() { return this.s.lineCap; }
  set lineCap(v: CanvasLineCap) { this.s.lineCap = v; }
  get lineJoin() { return this.s.lineJoin; }
  set lineJoin(v: CanvasLineJoin) { this.s.lineJoin = v; }
  get miterLimit() { return this.s.miterLimit; }
  set miterLimit(v: number) { this.s.miterLimit = v; }
  get lineDashOffset() { return this.s.dashOffset; }
  set lineDashOffset(v: number) { this.s.dashOffset = v; }
  setLineDash(seg: number[]): void { this.s.dash = seg.length % 2 ? [...seg, ...seg] : [...seg]; }
  getLineDash(): number[] { return [...this.s.dash]; }
  get globalAlpha() { return this.s.globalAlpha; }
  set globalAlpha(v: number) { if (Number.isFinite(v)) this.s.globalAlpha = Math.min(1, Math.max(0, v)); }
  get globalCompositeOperation() { return this.s.composite as GlobalCompositeOperation; }
  set globalCompositeOperation(v: GlobalCompositeOperation) { this.s.composite = v; }
  get font() { return this.s.font; }
  set font(v: string) { this.s.font = v; }
  get textAlign() { return this.s.textAlign; }
  set textAlign(v: CanvasTextAlign) { this.s.textAlign = v; }
  get textBaseline() { return this.s.textBaseline; }
  set textBaseline(v: CanvasTextBaseline) { this.s.textBaseline = v; }
  get letterSpacing() { return this.s.letterSpacing; }
  set letterSpacing(v: string) { this.s.letterSpacing = v; }
  get textRendering() { return this.s.textRendering; }
  set textRendering(v: string) { this.s.textRendering = v; }
  get fontKerning() { return this.s.fontKerning; }
  set fontKerning(v: CanvasFontKerning) { this.s.fontKerning = v; }
  get direction() { return this.s.direction; }
  set direction(v: CanvasDirection) { this.s.direction = v; }
  get shadowColor() { return this.s.shadowColor; }
  set shadowColor(v: string) { this.s.shadowColor = v; }
  get shadowBlur() { return this.s.shadowBlur; }
  set shadowBlur(v: number) { this.s.shadowBlur = v; }
  get shadowOffsetX() { return this.s.shadowOffsetX; }
  set shadowOffsetX(v: number) { this.s.shadowOffsetX = v; }
  get shadowOffsetY() { return this.s.shadowOffsetY; }
  set shadowOffsetY(v: number) { this.s.shadowOffsetY = v; }
  get filter() { return this.s.filter; }
  set filter(v: string) { this.s.filter = v || "none"; }

  createLinearGradient(x0: number, y0: number, x1: number, y1: number): GradientProxy {
    return new GradientProxy("linear", [x0, y0, x1, y1]);
  }
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): GradientProxy {
    return new GradientProxy("radial", [x0, y0, r0, x1, y1, r1]);
  }
  createConicGradient(angle: number, x: number, y: number): GradientProxy {
    return new GradientProxy("conic", [angle, x, y]);
  }

  // --- path ----------------------------------------------------------------
  private last: [number, number] | null = null;
  private start: [number, number] | null = null;

  beginPath(): void { this.path = []; this.last = null; this.start = null; }
  closePath(): void {
    if (!this.path.length) return;
    this.path.push({ op: "Z" });
    this.last = this.start;
  }
  private dev(x: number, y: number): [number, number] { return apply(this.s.ctm, x, y); }
  moveTo(x: number, y: number): void {
    const [dx, dy] = this.dev(x, y);
    this.path.push({ op: "M", x: dx, y: dy });
    this.last = this.start = [dx, dy];
  }
  lineTo(x: number, y: number): void {
    if (!this.last) { this.moveTo(x, y); return; }
    const [dx, dy] = this.dev(x, y);
    this.path.push({ op: "L", x: dx, y: dy });
    this.last = [dx, dy];
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    if (!this.last) this.moveTo(c1x, c1y);
    const [ax, ay] = this.dev(c1x, c1y);
    const [bx, by] = this.dev(c2x, c2y);
    const [dx, dy] = this.dev(x, y);
    this.path.push({ op: "C", x1: ax, y1: ay, x2: bx, y2: by, x: dx, y: dy });
    this.last = [dx, dy];
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    if (!this.last) this.moveTo(cx, cy);
    const [p0x, p0y] = this.last!;
    const [qx, qy] = this.dev(cx, cy);
    const [dx, dy] = this.dev(x, y);
    this.path.push({
      op: "C",
      x1: p0x + (2 / 3) * (qx - p0x), y1: p0y + (2 / 3) * (qy - p0y),
      x2: dx + (2 / 3) * (qx - dx), y2: dy + (2 / 3) * (qy - dy),
      x: dx, y: dy,
    });
    this.last = [dx, dy];
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
  }
  roundRect(x: number, y: number, w: number, h: number, radii: number | DOMPointInit | (number | DOMPointInit)[] = 0): void {
    const list = (Array.isArray(radii) ? radii : [radii]).map((r) => (typeof r === "number" ? r : r.x ?? 0));
    const [tl, tr, br, bl] = list.length === 1 ? [list[0], list[0], list[0], list[0]]
      : list.length === 2 ? [list[0], list[1], list[0], list[1]]
        : list.length === 3 ? [list[0], list[1], list[2], list[1]]
          : [list[0], list[1], list[2], list[3]];
    // Scale radii down so adjacent corners never overlap (canvas behavior).
    const f = Math.min(1, w / (tl + tr || 1), w / (bl + br || 1), h / (tl + bl || 1), h / (tr + br || 1));
    const r = [tl * f, tr * f, br * f, bl * f].map((v) => Math.max(0, v));
    const k = 0.5522847498;
    this.moveTo(x + r[0], y);
    this.lineTo(x + w - r[1], y);
    if (r[1]) this.bezierCurveTo(x + w - r[1] + r[1] * k, y, x + w, y + r[1] - r[1] * k, x + w, y + r[1]);
    this.lineTo(x + w, y + h - r[2]);
    if (r[2]) this.bezierCurveTo(x + w, y + h - r[2] + r[2] * k, x + w - r[2] + r[2] * k, y + h, x + w - r[2], y + h);
    this.lineTo(x + r[3], y + h);
    if (r[3]) this.bezierCurveTo(x + r[3] - r[3] * k, y + h, x, y + h - r[3] + r[3] * k, x, y + h - r[3]);
    this.lineTo(x, y + r[0]);
    if (r[0]) this.bezierCurveTo(x, y + r[0] - r[0] * k, x + r[0] - r[0] * k, y, x + r[0], y);
    this.closePath();
  }
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number, ccw = false): void {
    // Normalize the sweep like the canvas spec, then emit <=90deg cubic pieces.
    let sweep = end - start;
    const full = Math.PI * 2;
    if (!ccw && sweep < 0) sweep = (sweep % full) + full;
    if (ccw && sweep > 0) sweep = (sweep % full) - full;
    if (Math.abs(end - start) >= full) sweep = ccw ? -full : full;
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    const pt = (t: number): [number, number] => {
      const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
      return [x + ex * cos - ey * sin, y + ex * sin + ey * cos];
    };
    const d = (t: number): [number, number] => {
      const ex = -rx * Math.sin(t), ey = ry * Math.cos(t);
      return [ex * cos - ey * sin, ex * sin + ey * cos];
    };
    const [sx, sy] = pt(start);
    if (this.last) this.lineTo(sx, sy);
    else this.moveTo(sx, sy);
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
    const step = sweep / n;
    const k = (4 / 3) * Math.tan(step / 4);
    for (let i = 0; i < n; i++) {
      const t0 = start + i * step, t1 = t0 + step;
      const [p0x, p0y] = pt(t0), [p1x, p1y] = pt(t1);
      const [d0x, d0y] = d(t0), [d1x, d1y] = d(t1);
      this.bezierCurveTo(p0x + k * d0x, p0y + k * d0y, p1x - k * d1x, p1y - k * d1y, p1x, p1y);
    }
  }
  arc(x: number, y: number, r: number, start: number, end: number, ccw = false): void {
    this.ellipse(x, y, r, r, 0, start, end, ccw);
  }
  arcTo(x1: number, y1: number, x2: number, y2: number): void {
    // Rare in the engine; a corner instead of the tangent arc.
    this.lineTo(x1, y1);
    this.lineTo(x2, y2);
  }

  // --- paint helpers -------------------------------------------------------
  protected color(css: string): Rgba {
    let c = this.colorCache.get(css);
    if (c) return c;
    const ctx = this.colorCtx;
    ctx.fillStyle = "#000000";
    ctx.fillStyle = css;
    const v = String(ctx.fillStyle);
    if (v.startsWith("#")) {
      c = { r: parseInt(v.slice(1, 3), 16) / 255, g: parseInt(v.slice(3, 5), 16) / 255, b: parseInt(v.slice(5, 7), 16) / 255, a: 1 };
    } else {
      const m = /rgba?\(([^)]+)\)/.exec(v);
      const p = m ? m[1].split(",").map((x) => Number(x.trim())) : [0, 0, 0, 1];
      c = { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255, a: p[3] ?? 1 };
    }
    this.colorCache.set(css, c);
    return c;
  }

  private blendName(): string | null {
    return BLEND[this.s.composite] ?? null;
  }

  private effectActive(): boolean {
    if (this.s.filter && this.s.filter !== "none") return true;
    if (this.s.shadowBlur > 0 || this.s.shadowOffsetX || this.s.shadowOffsetY) {
      return this.color(this.s.shadowColor).a > 0;
    }
    return false;
  }

  /** Whether a paint style can be written as vector PDF. */
  private vectorPaint(style: unknown): boolean {
    if (typeof style === "string") return true;
    if (style instanceof GradientProxy) {
      if (style.kind === "conic" || style.stops.length === 0) return false;
      return style.stops.every((s) => this.color(s.color).a >= 0.999);
    }
    return false;
  }

  /** Fill a device-space path with the current fill style (vector). */
  private paintFill(path: Seg[], rule: CanvasFillRule, style: unknown): void {
    if (!path.length) return;
    const blend = this.blendName() ?? "Normal";
    if (typeof style === "string") {
      const c = this.color(style);
      const alpha = c.a * this.s.globalAlpha;
      if (alpha <= 0) return;
      if (this.o.backdrop) {
        this.onBackdrop((ctx) => { ctx.setTransform(1, 0, 0, 1, 0, 0); tracePath(ctx, path); ctx.fill(rule); });
        if (alpha < 0.999 || blend !== "Normal") { this.patch(pathBox(path), { path, rule }); return; }
      }
      this.emitFill(path, rule, c, alpha, blend);
    } else if (style instanceof GradientProxy) {
      if (this.s.globalAlpha <= 0) return;
      if (this.o.backdrop) {
        const m = this.s.ctm;
        this.onBackdrop((ctx) => { ctx.setTransform(1, 0, 0, 1, 0, 0); tracePath(ctx, path); ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f); ctx.fill(rule); });
        if (this.s.globalAlpha < 0.999 || blend !== "Normal") { this.patch(pathBox(path), { path, rule }); return; }
      }
      this.emitGradientFill(path, rule, style, this.s.ctm, this.s.globalAlpha, blend);
    }
    this.stats.vectorOps++;
  }

  private paintStroke(path: Seg[], style: unknown): void {
    if (!path.length) return;
    const blend = this.blendName() ?? "Normal";
    if (typeof style === "string") {
      const c = this.color(style);
      const alpha = c.a * this.s.globalAlpha;
      if (alpha <= 0) return;
      if (this.o.backdrop) {
        this.onBackdrop((ctx) => {
          const m = ctx.getTransform();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          tracePath(ctx, path);
          ctx.setTransform(m);
          ctx.stroke();
        });
        if (alpha < 0.999 || blend !== "Normal") {
          const box = pathBox(path);
          const half = (this.s.lineWidth * scaleOf(this.s.ctm)) / 2 + 2;
          this.patch(box && { x0: box.x0 - half, y0: box.y0 - half, x1: box.x1 + half, y1: box.y1 + half });
          return;
        }
      }
      this.emitStroke(path, c, alpha, blend);
    } else if (style instanceof GradientProxy) {
      // A gradient stroke: stroke-to-clip is not available in PDF without
      // outlining, so this is the one gradient case drawn as a patch.
      this.raster(pathBox(path), (ctx) => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        tracePath(ctx, path);
        ctx.setTransform(this.s.ctm.a, this.s.ctm.b, this.s.ctm.c, this.s.ctm.d, this.s.ctm.e, this.s.ctm.f);
        ctx.strokeStyle = style.materialize(ctx);
        ctx.stroke();
      }, this.s.lineWidth * scaleOf(this.s.ctm));
      return;
    }
    this.stats.vectorOps++;
  }

  // --- raster fallback -----------------------------------------------------
  private scratchCtx(): CanvasRenderingContext2D {
    if (!this.scratch) this.scratch = makeCanvas(this.o.width, this.o.height).getContext("2d", { willReadFrequently: true })!;
    return this.scratch;
  }

  private filterMargin(): number {
    let m = 0;
    for (const match of this.s.filter.matchAll(/blur\(\s*([\d.]+)px\s*\)/g)) m = Math.max(m, Number(match[1]) * 3);
    for (const match of this.s.filter.matchAll(/drop-shadow\(([^)]*)\)/g)) {
      const nums = (match[1].match(/-?[\d.]+px/g) ?? []).map((v) => Math.abs(parseFloat(v)));
      m = Math.max(m, (nums[0] ?? 0) + (nums[1] ?? 0) + (nums[2] ?? 0) * 3);
    }
    const shadow = this.color(this.s.shadowColor).a > 0 ? this.s.shadowBlur * 2 + Math.abs(this.s.shadowOffsetX) + Math.abs(this.s.shadowOffsetY) : 0;
    return Math.max(m * scaleOf(this.s.ctm), shadow) + 2;
  }

  /** Set a real canvas up with the full drawing state: clip, alpha,
   *  composite, shadow, filter, line and text settings, transform, styles. */
  private prepare(ctx: CanvasRenderingContext2D, composite: string): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const c of this.s.clips) {
      tracePath(ctx, c.path);
      ctx.clip(c.rule);
    }
    ctx.globalAlpha = this.s.globalAlpha;
    ctx.globalCompositeOperation = composite as GlobalCompositeOperation;
    ctx.filter = this.s.filter;
    ctx.shadowColor = this.s.shadowColor;
    ctx.shadowBlur = this.s.shadowBlur;
    ctx.shadowOffsetX = this.s.shadowOffsetX;
    ctx.shadowOffsetY = this.s.shadowOffsetY;
    ctx.lineWidth = this.s.lineWidth;
    ctx.lineCap = this.s.lineCap;
    ctx.lineJoin = this.s.lineJoin;
    ctx.miterLimit = this.s.miterLimit;
    ctx.setLineDash(this.s.dash);
    ctx.lineDashOffset = this.s.dashOffset;
    ctx.font = this.s.font;
    ctx.textAlign = this.s.textAlign;
    ctx.textBaseline = this.s.textBaseline;
    ctx.letterSpacing = this.s.letterSpacing;
    ctx.direction = this.s.direction;
    const m = this.s.ctm;
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    const toReal = (v: unknown) => (v instanceof GradientProxy ? v.materialize(ctx) : (v as string | CanvasPattern));
    ctx.fillStyle = toReal(this.s.fillStyle);
    ctx.strokeStyle = toReal(this.s.strokeStyle);
  }

  /** Flatten mode: draw one operation on the page backdrop, as the screen
   *  would (real composite, so blend modes come out exactly). */
  private onBackdrop(draw: (ctx: CanvasRenderingContext2D) => void): void {
    const ctx = this.o.backdrop!;
    ctx.save();
    try {
      this.prepare(ctx, this.s.composite);
      draw(ctx);
    } finally {
      ctx.restore();
    }
  }

  /** Flatten mode: embed the backdrop's pixels over `box` as an opaque
   *  image, clipped to `clip` (the operation's own outline) when given, so
   *  only what the operation touched turns into pixels. */
  private patch(box: Box | null, clip?: { path: Seg[]; rule: CanvasFillRule }): void {
    if (!box || !this.o.backdrop) return;
    const x0 = Math.max(0, Math.floor(box.x0 - 1));
    const y0 = Math.max(0, Math.floor(box.y0 - 1));
    const x1 = Math.min(this.o.width, Math.ceil(box.x1 + 1));
    const y1 = Math.min(this.o.height, Math.ceil(box.y1 + 1));
    if (x1 <= x0 || y1 <= y0) return;
    const w = x1 - x0, h = y1 - y0;
    const data = this.o.backdrop.getImageData(x0, y0, w, h).data;
    this.emitImage(null, w, h, data, { a: w, b: 0, c: 0, d: h, e: x0, f: y0 }, 1, null, clip);
    this.stats.rasterPatches++;
  }

  /** Draw one operation on the scratch canvas with the full canvas state
   *  (clip, alpha, shadow, filter) and embed the touched area as an image. */
  private raster(box: Box | null, draw: (ctx: CanvasRenderingContext2D) => void, extra = 0): void {
    if (!box) return;
    const margin = this.filterMargin() + extra;
    if (this.o.backdrop) {
      // Flatten mode: the effect is composited onto the page itself.
      this.onBackdrop(draw);
      this.patch({ x0: box.x0 - margin, y0: box.y0 - margin, x1: box.x1 + margin, y1: box.y1 + margin });
      return;
    }
    const x0 = Math.max(0, Math.floor(box.x0 - margin));
    const y0 = Math.max(0, Math.floor(box.y0 - margin));
    const x1 = Math.min(this.o.width, Math.ceil(box.x1 + margin));
    const y1 = Math.min(this.o.height, Math.ceil(box.y1 + margin));
    if (x1 <= x0 || y1 <= y0) return;
    const ctx = this.scratchCtx();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
    try {
      this.prepare(ctx, "source-over");
      draw(ctx);
    } finally {
      ctx.restore();
    }
    const w = x1 - x0, h = y1 - y0;
    const data = ctx.getImageData(x0, y0, w, h).data;
    let any = false;
    for (let i = 3; i < data.length; i += 4) if (data[i]) { any = true; break; }
    if (!any) return;
    this.emitImage(null, w, h, data, { a: w, b: 0, c: 0, d: h, e: x0, f: y0 }, 1, this.blendName() ?? "Normal");
    this.stats.rasterPatches++;
  }

  // --- painting API --------------------------------------------------------
  fill(a?: CanvasFillRule | Path2D, b?: CanvasFillRule): void {
    if (this.o.collect) return;
    const rule = (typeof a === "string" ? a : b) ?? "nonzero";
    const path = this.path;
    if (this.effectActive() || !this.vectorPaint(this.s.fillStyle) || !this.blendName()) {
      this.raster(pathBox(path), (ctx) => {
        const m = ctx.getTransform();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        tracePath(ctx, path);
        ctx.setTransform(m);
        ctx.fill(rule);
      });
      return;
    }
    this.paintFill(path, rule, this.s.fillStyle);
  }
  stroke(): void {
    if (this.o.collect) return;
    const path = this.path;
    if (this.effectActive() || !this.blendName() || !(typeof this.s.strokeStyle === "string" || this.s.strokeStyle instanceof GradientProxy)) {
      this.raster(pathBox(path), (ctx) => {
        const m = ctx.getTransform();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        tracePath(ctx, path);
        ctx.setTransform(m);
        ctx.stroke();
      }, this.s.lineWidth * scaleOf(this.s.ctm));
      return;
    }
    this.paintStroke(path, this.s.strokeStyle);
  }
  clip(a?: CanvasFillRule | Path2D, b?: CanvasFillRule): void {
    if (this.o.collect) return;
    const rule = (typeof a === "string" ? a : b) ?? "nonzero";
    const path = [...this.path];
    this.s.clips = [...this.s.clips, { path, rule }];
    this.emitClip(path, rule);
  }
  private withTempPath(build: () => void, paint: () => void): void {
    const saved = this.path, last = this.last, start = this.start;
    this.beginPath();
    build();
    paint();
    this.path = saved; this.last = last; this.start = start;
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.withTempPath(() => this.rect(x, y, w, h), () => this.fill());
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.withTempPath(() => this.rect(x, y, w, h), () => this.stroke());
  }
  clearRect(): void {
    // The page starts blank; the engine only clears at the start of a render.
  }

  // --- images --------------------------------------------------------------
  private pixels(img: CanvasImageSource, w: number, h: number): Uint8ClampedArray | null {
    try {
      const c = makeCanvas(w, h);
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return ctx.getImageData(0, 0, c.width, c.height).data;
    } catch {
      return null;
    }
  }

  drawImage(img: CanvasImageSource, ...args: number[]): void {
    if (this.o.collect) return;
    const el = img as { naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; width?: number | SVGAnimatedLength; height?: number | SVGAnimatedLength; src?: string };
    const iw = el.naturalWidth || el.videoWidth || (typeof el.width === "number" ? el.width : 0);
    const ih = el.naturalHeight || el.videoHeight || (typeof el.height === "number" ? el.height : 0);
    if (!iw || !ih) return;
    let sx = 0, sy = 0, sw = iw, sh = ih, dx: number, dy: number, dw: number, dh: number;
    if (args.length >= 8) [sx, sy, sw, sh, dx, dy, dw, dh] = args;
    else if (args.length >= 4) [dx, dy, dw, dh] = args;
    else { [dx, dy] = args; dw = iw; dh = ih; }
    const corners = [this.dev(dx, dy), this.dev(dx + dw, dy), this.dev(dx, dy + dh), this.dev(dx + dw, dy + dh)];
    const box: Box = {
      x0: Math.min(...corners.map((p) => p[0])), y0: Math.min(...corners.map((p) => p[1])),
      x1: Math.max(...corners.map((p) => p[0])), y1: Math.max(...corners.map((p) => p[1])),
    };
    if (this.effectActive() || !this.blendName()) {
      this.raster(box, (ctx) => ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh));
      return;
    }
    // Flatten mode: the image lands on the backdrop either way; the outline
    // of its destination is what a patch would be clipped to.
    let outline: Seg[] = [];
    if (this.o.backdrop) {
      this.onBackdrop((ctx) => ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh));
      const saved = this.path, last = this.last, start = this.start;
      this.beginPath();
      this.rect(dx, dy, dw, dh);
      outline = this.path;
      this.path = saved; this.last = last; this.start = start;
    }
    // Vector sources (SVG) have no meaningful pixel size: draw them at the
    // size they cover on the page at device resolution instead.
    const isSvg = typeof el.src === "string" && (/^data:image\/svg/i.test(el.src) || /\.svg(\?|#|$)/i.test(el.src));
    let pw = iw, ph = ih;
    if (isSvg) {
      const k = Math.max((box.x1 - box.x0) / Math.max(1, dw), (box.y1 - box.y0) / Math.max(1, dh));
      const want = Math.max(1, (dw * k) / (sw / iw));
      pw = Math.round(want);
      ph = Math.round((want * ih) / iw);
    }
    // Keep a single embedded image under ~40 megapixels.
    const cap = Math.sqrt(40e6 / (pw * ph));
    if (cap < 1) { pw = Math.round(pw * cap); ph = Math.round(ph * cap); }
    const data = this.pixels(img, pw, ph);
    if (!data) {
      if (this.o.backdrop) this.patch(box, { path: outline, rule: "nonzero" });
      else this.raster(box, (ctx) => ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh));
      return;
    }
    const blend = this.blendName() ?? "Normal";
    const alpha = this.s.globalAlpha;
    if (alpha <= 0) return;
    if (this.o.backdrop) {
      // Soft edges or translucency need the backdrop baked in.
      let soft = alpha < 0.999 || blend !== "Normal";
      if (!soft) for (let i = 3; i < data.length; i += 4) if (data[i] < 255) { soft = true; break; }
      if (soft) { this.patch(box, { path: outline, rule: "nonzero" }); return; }
    }
    // Full image placed so the source rect lands on the destination rect,
    // clipped to the destination: unit square -> image rows top-down.
    const fx = dw / sw, fy = dh / sh;
    const place: Mat = { a: iw * fx, b: 0, c: 0, d: ih * fy, e: dx - sx * fx, f: dy - sy * fy };
    const cropped = sx !== 0 || sy !== 0 || sw !== iw || sh !== ih;
    let crop: ClipPath | undefined;
    if (cropped) {
      const saved = this.path, last = this.last, start = this.start;
      this.beginPath();
      this.rect(dx, dy, dw, dh);
      crop = { path: this.path, rule: "nonzero" };
      this.path = saved; this.last = last; this.start = start;
    }
    this.emitImage(isSvg ? null : (img as object), pw, ph, data, mul(this.s.ctm, place), alpha, blend, crop);
    this.stats.images++;
  }

  // --- text ----------------------------------------------------------------
  private syncMeasure(): CanvasRenderingContext2D {
    const m = this.measure;
    m.font = this.s.font;
    m.letterSpacing = this.s.letterSpacing;
    m.textAlign = this.s.textAlign;
    m.textBaseline = this.s.textBaseline;
    m.fontKerning = this.s.fontKerning;
    m.direction = this.s.direction;
    (m as unknown as { textRendering: string }).textRendering = this.s.textRendering;
    return m;
  }
  measureText(text: string): TextMetrics {
    return this.syncMeasure().measureText(text);
  }

  /** Glyph outlines of `text` laid out like the canvas would draw it, as a
   *  device-space path; null when the font file is not available. */
  private glyphPath(text: string, x: number, y: number, maxWidth?: number): Seg[] | null {
    const req = parseCanvasFont(this.s.font);
    if (!req || req.smallCaps) return null;
    const face = this.o.faces.get(faceKeyOf(req));
    if (!face) return null;
    // Split into runs by the font file (unicode subset) that has each glyph.
    const runs: { font: fontkit.Font; text: string }[] = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      const font = face.subsets.find((f) => f.hasGlyphForCodePoint(cp)) ?? (/\s/.test(ch) ? face.subsets[0] : null);
      if (!font) return null;
      const lastRun = runs[runs.length - 1];
      if (lastRun && lastRun.font === font) lastRun.text += ch;
      else runs.push({ font, text: ch });
    }
    const spacing = parseFloat(this.s.letterSpacing) || 0;
    const features = this.s.textRendering === "optimizeSpeed" ? { liga: false, clig: false } : undefined;
    const laid = runs.map((r) => ({ font: r.font, run: r.font.layout(r.text, features), scale: req.size / r.font.unitsPerEm }));
    let fkWidth = 0;
    for (const l of laid) for (const p of l.run.positions) fkWidth += p.xAdvance * l.scale + spacing;
    // Match the browser's measured width exactly, so alignment, justification
    // and wrapping decided by the engine land identically.
    const metrics = this.syncMeasure().measureText(text);
    const browserWidth = metrics.width;
    let fit = fkWidth > 0 && browserWidth > 0 ? browserWidth / fkWidth : 1;
    if (fit < 0.8 || fit > 1.25) fit = 1;
    let squeeze = 1;
    if (maxWidth !== undefined && browserWidth > maxWidth && maxWidth > 0) squeeze = maxWidth / browserWidth;
    const total = browserWidth * squeeze;
    const align = this.s.textAlign;
    const rtl = this.s.direction === "rtl";
    let x0 = x;
    if (align === "center") x0 = x - total / 2;
    else if (align === "right" || (align === "end" && !rtl) || (align === "start" && rtl)) x0 = x - total;
    // Baseline: everything relative to the alphabetic baseline.
    let base = y;
    if (this.s.textBaseline !== "alphabetic") {
      const m = this.measure;
      const prev = m.textBaseline;
      m.textBaseline = "alphabetic";
      const am = m.measureText(text) as TextMetrics & { emHeightAscent?: number; emHeightDescent?: number };
      m.textBaseline = prev;
      const asc = am.emHeightAscent ?? am.fontBoundingBoxAscent;
      const desc = am.emHeightDescent ?? am.fontBoundingBoxDescent;
      const tb = this.s.textBaseline;
      if (tb === "top" || tb === "hanging") base = y + asc;
      else if (tb === "middle") base = y + (asc - desc) / 2;
      else if (tb === "bottom" || tb === "ideographic") base = y - desc;
    }
    const out: Seg[] = [];
    const m = this.s.ctm;
    let pen = 0;
    for (const l of laid) {
      l.run.glyphs.forEach((g, i) => {
        const p = l.run.positions[i];
        const gx = x0 + (pen + p.xOffset * l.scale) * fit * squeeze;
        const gy = base - p.yOffset * l.scale;
        const sxk = l.scale * squeeze;
        const tx = (fx: number, fy: number) => apply(m, gx + fx * sxk, gy - fy * l.scale);
        for (const c of g.path.commands) {
          const a = c.args;
          if (c.command === "moveTo") { const [px, py] = tx(a[0], a[1]); out.push({ op: "M", x: px, y: py }); }
          else if (c.command === "lineTo") { const [px, py] = tx(a[0], a[1]); out.push({ op: "L", x: px, y: py }); }
          else if (c.command === "quadraticCurveTo") {
            const prev = out[out.length - 1];
            const [p0x, p0y] = prev && prev.op !== "Z" ? [prev.x, prev.y] : tx(a[0], a[1]);
            const [qx, qy] = tx(a[0], a[1]);
            const [ex, ey] = tx(a[2], a[3]);
            out.push({ op: "C", x1: p0x + (2 / 3) * (qx - p0x), y1: p0y + (2 / 3) * (qy - p0y), x2: ex + (2 / 3) * (qx - ex), y2: ey + (2 / 3) * (qy - ey), x: ex, y: ey });
          } else if (c.command === "bezierCurveTo") {
            const [ax, ay] = tx(a[0], a[1]), [bx, by] = tx(a[2], a[3]), [ex, ey] = tx(a[4], a[5]);
            out.push({ op: "C", x1: ax, y1: ay, x2: bx, y2: by, x: ex, y: ey });
          } else out.push({ op: "Z" });
        }
        pen += p.xAdvance * l.scale + spacing;
      });
    }
    return out;
  }

  private textBox(text: string, x: number, y: number): Box {
    const mt = this.syncMeasure().measureText(text);
    const lx = x - mt.actualBoundingBoxLeft, rx = x + mt.actualBoundingBoxRight;
    const ty = y - mt.actualBoundingBoxAscent, by = y + mt.actualBoundingBoxDescent;
    const pts = [this.dev(lx, ty), this.dev(rx, ty), this.dev(lx, by), this.dev(rx, by)];
    return {
      x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])),
      x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])),
    };
  }

  private collectFont(): void {
    const req = parseCanvasFont(this.s.font);
    if (req && this.o.collect) {
      const { family, weight, italic, stretch } = req;
      this.o.collect.set(faceKeyOf(req), { family, weight, italic, stretch });
    }
  }

  fillText(text: string, x: number, y: number, maxWidth?: number): void {
    if (this.o.collect) { this.collectFont(); return; }
    if (!text) return;
    const outline = this.effectActive() || !this.vectorPaint(this.s.fillStyle) || !this.blendName() ? null : this.glyphPath(text, x, y, maxWidth);
    if (!outline) {
      this.raster(this.textBox(text, x, y), (ctx) => ctx.fillText(text, x, y, maxWidth));
      return;
    }
    this.paintFill(outline, "nonzero", this.s.fillStyle);
    this.stats.textRuns++;
  }

  strokeText(text: string, x: number, y: number, maxWidth?: number): void {
    if (this.o.collect) { this.collectFont(); return; }
    if (!text) return;
    const outline = this.effectActive() || typeof this.s.strokeStyle !== "string" || !this.blendName() ? null : this.glyphPath(text, x, y, maxWidth);
    if (!outline) {
      this.raster(this.textBox(text, x, y), (ctx) => ctx.strokeText(text, x, y, maxWidth), this.s.lineWidth * scaleOf(this.s.ctm));
      return;
    }
    this.paintStroke(outline, this.s.strokeStyle);
    this.stats.textRuns++;
  }
}

/** The PDF backend: content stream operators plus shared resources. */
export class PdfCanvas extends VectorCanvas {
  private ops: string[] = [];

  constructor(protected readonly o: PdfCanvasOptions) {
    super(o);
  }

  /** The page's content stream operators (device space). */
  content(): string {
    return this.ops.join("\n");
  }

  /** A colour's components in the output space (RGB, or CMYK via the
   *  profile; pure black in black ink only when asked). */
  private components(c: { r: number; g: number; b: number }): number[] {
    const out = this.o.color;
    if (!out) return [c.r, c.g, c.b];
    if (out.blackOnly && c.r <= 0.002 && c.g <= 0.002 && c.b <= 0.002) return [0, 0, 0, 1];
    return out.cmyk(c.r, c.g, c.b);
  }

  /** The fill (or stroke) colour operator for a colour. */
  private colorOp(c: { r: number; g: number; b: number }, stroke: boolean): string {
    const v = this.components(c).map(num).join(" ");
    if (this.o.color) return `${v} ${stroke ? "K" : "k"}`;
    return `${v} ${stroke ? "RG" : "rg"}`;
  }

  /** Shading dictionary for a gradient, in the CTM's user space. */
  private shading(g: GradientProxy): string {
    const stops = [...g.stops].sort((a, b) => a.offset - b.offset);
    if (stops[0].offset > 0) stops.unshift({ offset: 0, color: stops[0].color });
    if (stops[stops.length - 1].offset < 1) stops.push({ offset: 1, color: stops[stops.length - 1].color });
    // CMYK through a profile is not linear in RGB: each stop-to-stop piece is
    // split so the press colours follow the on-screen blend closely.
    const sub = this.o.color ? 8 : 1;
    const pts: { offset: number; c: { r: number; g: number; b: number } }[] = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const a = this.color(stops[i].color), b = this.color(stops[i + 1].color);
      for (let k = 0; k < sub; k++) {
        const t = k / sub;
        pts.push({ offset: stops[i].offset + (stops[i + 1].offset - stops[i].offset) * t, c: { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t } });
      }
    }
    const lastStop = this.color(stops[stops.length - 1].color);
    pts.push({ offset: 1, c: lastStop });
    const arr = (c: { r: number; g: number; b: number }) => `[${this.components(c).map(num).join(" ")}]`;
    const pieces: string[] = [];
    const bounds: string[] = [];
    const encode: string[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      pieces.push(`<< /FunctionType 2 /Domain [0 1] /C0 ${arr(pts[i].c)} /C1 ${arr(pts[i + 1].c)} /N 1 >>`);
      if (i > 0) bounds.push(num(pts[i].offset));
      encode.push("0 1");
    }
    const fn = pieces.length === 1
      ? pieces[0]
      : `<< /FunctionType 3 /Domain [0 1] /Functions [${pieces.join(" ")}] /Bounds [${bounds.join(" ")}] /Encode [${encode.join(" ")}] >>`;
    const a = g.args;
    const coords = g.kind === "linear" ? `[${a.map(num).join(" ")}]` : `[${num(a[0])} ${num(a[1])} ${num(a[2])} ${num(a[3])} ${num(a[4])} ${num(a[5])}]`;
    return `<< /ShadingType ${g.kind === "linear" ? 2 : 3} /ColorSpace /${this.o.color ? "DeviceCMYK" : "DeviceRGB"} /Coords ${coords} /Function ${fn} /Extend [true true] >>`;
  }

  private matrixOp(m: Mat): string {
    return `${num(m.a)} ${num(m.b)} ${num(m.c)} ${num(m.d)} ${num(m.e)} ${num(m.f)} cm`;
  }

  private strokeParams(): string {
    const k = scaleOf(this.s.ctm);
    const cap = this.s.lineCap === "round" ? 1 : this.s.lineCap === "square" ? 2 : 0;
    const join = this.s.lineJoin === "round" ? 1 : this.s.lineJoin === "bevel" ? 2 : 0;
    const dash = this.s.dash.length ? `[${this.s.dash.map((d) => num(d * k)).join(" ")}] ${num(this.s.dashOffset * k)} d` : "[] 0 d";
    return `${num(this.s.lineWidth * k)} w ${cap} J ${join} j ${num(this.s.miterLimit)} M ${dash}`;
  }

  private clipOps(clip?: ClipPath): string[] {
    return clip ? [pathOps(clip.path), clip.rule === "evenodd" ? "W* n" : "W n"] : [];
  }

  protected emitSave(): void {
    this.ops.push("q");
  }
  protected emitRestore(): void {
    this.ops.push("Q");
  }
  protected emitFill(path: Seg[], rule: CanvasFillRule, c: Rgba, alpha: number, blend: string): void {
    this.ops.push(`q /${this.o.resources.gs(alpha, alpha, blend)} gs ${this.colorOp(c, false)}`, pathOps(path), rule === "evenodd" ? "f* Q" : "f Q");
  }
  protected emitGradientFill(path: Seg[], rule: CanvasFillRule, g: GradientProxy, ctm: Mat, alpha: number, blend: string): void {
    const res = this.o.resources;
    const sh = res.addShading(this.shading(g));
    this.ops.push(`q /${res.gs(alpha, alpha, blend)} gs`, pathOps(path), rule === "evenodd" ? "W* n" : "W n", this.matrixOp(ctm), `/${sh} sh Q`);
  }
  protected emitStroke(path: Seg[], c: Rgba, alpha: number, blend: string): void {
    this.ops.push(`q /${this.o.resources.gs(alpha, alpha, blend)} gs ${this.colorOp(c, true)} ${this.strokeParams()}`, pathOps(path), "S Q");
  }
  protected emitClip(path: Seg[], rule: CanvasFillRule): void {
    if (path.length) this.ops.push(...this.clipOps({ path, rule }));
    else this.ops.push("0 0 m h W n");
  }
  protected emitImage(source: object | null, width: number, height: number, rgba: Uint8ClampedArray, place: Mat, alpha: number, blend: string | null, clip?: ClipPath): void {
    const name = this.o.resources.addImage(source, width, height, rgba);
    // PDF image space has its first row at the top of the unit square (y up).
    const m = this.matrixOp(mul(place, { a: 1, b: 0, c: 0, d: -1, e: 0, f: 1 }));
    if (blend === null) this.ops.push("q", ...this.clipOps(clip), `${m} /${name} Do Q`);
    else this.ops.push(`q /${this.o.resources.gs(alpha, alpha, blend)} gs`, ...this.clipOps(clip), m, `/${name} Do Q`);
  }
}
