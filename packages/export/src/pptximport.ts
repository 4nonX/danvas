// PPTX (PowerPoint) import (doc 28, the hard interop half). Parses a real
// .pptx package (unzip + the compact XML parser) into an editable open-format
// DesignFile: one page per slide (size from sldSz), native text boxes with
// per-run styling, preset-geometry shapes with solid/gradient fills and
// strokes, images (embedded media become self-contained data: URL assets)
// with crop, straight connectors as lines, slide backgrounds, speaker notes,
// z-order, rotation/flips (converted from PowerPoint's center-rotation model
// to the engine's top-left-origin model), and groups kept as GroupNodes with
// their chOff/chExt child spaces mapped group-local. Picture fills on shapes
// (how Canva exports every image) become image nodes with crop/transparency,
// freeform outlines (a:custGeom) become editable path nodes, and weights baked
// into typeface names ("Titillium Web Semi-Bold") split into family + style.
// Unknown preset geometry degrades to a rect of the same bounds so layout
// always survives; anything lossy is reported through opts.onWarning.
//
// Pure and dependency-free: runs in browser, worker, and node alike.

import type { DesignFile, Node } from "@hc/schema";
import { createBlankDesign, createNode } from "@hc/schema";
import { unzip } from "./unzip";
import { parseXml, findFirst, findAll, childOf, childrenOf, type XmlElement } from "./xml";

const PX_PER_EMU = 1 / 9525;
const DEG = 60000;

// --- small helpers -----------------------------------------------------------

const px = (emu: string | undefined): number => (emu ? Number(emu) * PX_PER_EMU : 0);

type Rgba = { r: number; g: number; b: number; a: number };

function hexToRgb(hex: string, alpha = 1): Rgba {
  const v = parseInt(hex.slice(0, 6), 16);
  if (!Number.isFinite(v)) return { r: 0, g: 0, b: 0, a: alpha };
  return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255, a: alpha };
}

/** Resolve one DrawingML color element (srgbClr / schemeClr / sysClr child of
 *  a fill), honoring an <a:alpha> modifier. */
function colorFrom(el: XmlElement | null, theme: Map<string, string>): Rgba | null {
  if (!el) return null;
  const alphaEl = findFirst(el, "a:alpha");
  const alpha = alphaEl ? Math.max(0, Math.min(1, Number(alphaEl.attrs.val) / 100000)) : 1;
  if (el.tag === "a:srgbClr") return hexToRgb(el.attrs.val ?? "000000", alpha);
  if (el.tag === "a:sysClr") return hexToRgb(el.attrs.lastClr ?? "000000", alpha);
  if (el.tag === "a:schemeClr") {
    const name = el.attrs.val ?? "";
    // tx/bg aliases map onto the dk/lt scheme slots.
    const slot = ({ tx1: "dk1", tx2: "dk2", bg1: "lt1", bg2: "lt2" } as Record<string, string>)[name] ?? name;
    const hex = theme.get(slot);
    return hex ? hexToRgb(hex, alpha) : { r: 0, g: 0, b: 0, a: alpha };
  }
  return null;
}

function firstColorChild(el: XmlElement, theme: Map<string, string>): Rgba | null {
  for (const c of el.children) {
    const got = colorFrom(c, theme);
    if (got) return got;
  }
  return null;
}

/** Map a DrawingML fill container (spPr / bgPr) to a schema Fill. */
function fillFrom(container: XmlElement, theme: Map<string, string>): unknown | null {
  const solid = childOf(container, "a:solidFill");
  if (solid) {
    const c = firstColorChild(solid, theme);
    return c ? { type: "solid", color: { srgb: c } } : null;
  }
  const grad = childOf(container, "a:gradFill");
  if (grad) {
    const stops = findAll(grad, "a:gs")
      .map((gs) => {
        const c = firstColorChild(gs, theme);
        return c ? { position: Math.max(0, Math.min(1, Number(gs.attrs.pos ?? 0) / 100000)), color: { srgb: c } } : null;
      })
      .filter((s): s is NonNullable<typeof s> => !!s)
      .sort((a, b) => a.position - b.position);
    if (stops.length >= 2) {
      // A circular path is a radial gradient; otherwise linear, whose ang is
      // the engine's own convention (clockwise from 3 o'clock) verbatim.
      const path = findFirst(grad, "a:path");
      if (path?.attrs.path === "circle" || path?.attrs.path === "shape") {
        return { type: "gradient", gradient: "radial", angle: 0, stops };
      }
      const lin = findFirst(grad, "a:lin");
      const angle = lin ? (Number(lin.attrs.ang ?? 0) / DEG) % 360 : 0;
      return { type: "gradient", gradient: "linear", angle, stops };
    }
  }
  if (childOf(container, "a:noFill")) return null;
  return undefined; // no explicit fill element
}

function strokeFrom(container: XmlElement, theme: Map<string, string>): unknown | null {
  const ln = childOf(container, "a:ln");
  if (!ln) return null;
  if (childOf(ln, "a:noFill")) return null;
  const width = ln.attrs.w ? px(ln.attrs.w) : 1;
  const solid = childOf(ln, "a:solidFill");
  const c = solid ? firstColorChild(solid, theme) : { r: 0, g: 0, b: 0, a: 1 };
  if (!c || width <= 0) return null;
  return { fill: { type: "solid", color: { srgb: c } }, width, align: "center", cap: "round", join: "round" };
}

interface Xfrm {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number; // degrees, PowerPoint center-rotation
  flipH: boolean;
  flipV: boolean;
  chOff?: { x: number; y: number };
  chExt?: { w: number; h: number };
}

function xfrmFrom(spPr: XmlElement | null): Xfrm | null {
  const xfrm = spPr ? childOf(spPr, "a:xfrm") : null;
  if (!xfrm) return null;
  const off = childOf(xfrm, "a:off");
  const ext = childOf(xfrm, "a:ext");
  if (!off || !ext) return null;
  const chOff = childOf(xfrm, "a:chOff");
  const chExt = childOf(xfrm, "a:chExt");
  return {
    x: px(off.attrs.x),
    y: px(off.attrs.y),
    w: Math.max(1, px(ext.attrs.cx)),
    h: Math.max(1, px(ext.attrs.cy)),
    rot: Number(xfrm.attrs.rot ?? 0) / DEG,
    flipH: xfrm.attrs.flipH === "1",
    flipV: xfrm.attrs.flipV === "1",
    ...(chOff ? { chOff: { x: px(chOff.attrs.x), y: px(chOff.attrs.y) } } : {}),
    ...(chExt ? { chExt: { w: Math.max(1e-6, px(chExt.attrs.cx)), h: Math.max(1e-6, px(chExt.attrs.cy)) } } : {}),
  };
}

/** PowerPoint rotates about the box CENTER with an unrotated offset; the
 *  engine rotates clockwise about the box's top-left origin. Convert. */
function toEngineTransform(f: { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean }) {
  let x = f.x;
  let y = f.y;
  if (f.rot) {
    const rad = (f.rot * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    // origin = center - R(rot) . (w/2, h/2)  (clockwise, y-down)
    x = cx - (cos * (f.w / 2) - sin * (f.h / 2));
    y = cy - (sin * (f.w / 2) + cos * (f.h / 2));
  }
  return {
    x,
    y,
    scaleX: f.flipH ? -1 : 1,
    scaleY: f.flipV ? -1 : 1,
    rotation: f.rot,
    // A flip renders leftward/upward from the origin in the engine; shift so
    // the box stays where PowerPoint put it.
    ...(f.flipH ? { x: x + f.w } : {}),
    ...(f.flipV ? { y: y + f.h } : {}),
  };
}

// preset geometry -> schema shape
function shapeFor(prst: string): { shape: string; sides?: number; rounded?: boolean } {
  switch (prst) {
    case "rect": return { shape: "rect" };
    case "roundRect": return { shape: "rect", rounded: true };
    case "ellipse": return { shape: "ellipse" };
    case "triangle": return { shape: "triangle" };
    case "star5": case "star4": case "star6": case "star8": return { shape: "star" };
    case "diamond": return { shape: "polygon", sides: 4 };
    case "pentagon": return { shape: "polygon", sides: 5 };
    case "hexagon": return { shape: "polygon", sides: 6 };
    case "heptagon": return { shape: "polygon", sides: 7 };
    case "octagon": return { shape: "polygon", sides: 8 };
    case "decagon": return { shape: "polygon", sides: 10 };
    case "dodecagon": return { shape: "polygon", sides: 12 };
    default: return { shape: "rect" }; // bounds-preserving fallback
  }
}

// --- custom geometry (a:custGeom) --------------------------------------------

type Pt = { x: number; y: number };
type Seg = { x: number; y: number; cIn?: Pt; cOut?: Pt };
type Contour = { segments: Seg[]; closed: boolean };

/** A custGeom's path list in the shape's local px box (0..w, 0..h), as
 *  engine PathNode contours (absolute handles: a cubic A->B with controls
 *  c1,c2 is A.cOut=c1, B.cIn=c2). `isRect` flags the common exporter habit
 *  (Canva writes every element this way) of spelling a plain rectangle as a
 *  four-line freeform, so callers can keep emitting a native rect/image. */
function custGeomContours(custGeom: XmlElement, w: number, h: number): { contours: Contour[]; isRect: boolean; filled: boolean } | null {
  const pathLst = childOf(custGeom, "a:pathLst");
  if (!pathLst) return null;
  const contours: Contour[] = [];
  let filled = false;
  let lineOnly = true;
  for (const path of childrenOf(pathLst, "a:path")) {
    if (path.attrs.fill !== "none") filled = true;
    const pw = Number(path.attrs.w ?? 0);
    const ph = Number(path.attrs.h ?? 0);
    // Path units map onto the shape box; without w/h they are EMU in shape space.
    const kx = pw > 0 ? w / pw : PX_PER_EMU;
    const ky = ph > 0 ? h / ph : PX_PER_EMU;
    const pt = (el: XmlElement | undefined): Pt => ({ x: Number(el?.attrs.x ?? 0) * kx, y: Number(el?.attrs.y ?? 0) * ky });
    let cur: Contour | null = null;
    let last: Pt = { x: 0, y: 0 };
    let start: Pt = { x: 0, y: 0 };
    const finish = () => {
      if (cur && cur.segments.length) contours.push(cur);
      cur = null;
    };
    const ensure = (): Contour => {
      if (!cur) {
        cur = { segments: [{ x: last.x, y: last.y }], closed: false };
        start = last;
      }
      return cur;
    };
    const cubic = (c1: Pt, c2: Pt, end: Pt) => {
      const c = ensure();
      c.segments[c.segments.length - 1].cOut = c1;
      c.segments.push({ x: end.x, y: end.y, cIn: c2 });
      last = end;
    };
    for (const cmd of path.children) {
      const pts = childrenOf(cmd, "a:pt");
      switch (cmd.tag) {
        case "a:moveTo":
          finish();
          last = pt(pts[0]);
          ensure();
          break;
        case "a:lnTo": {
          const p = pt(pts[0]);
          ensure().segments.push({ x: p.x, y: p.y });
          last = p;
          break;
        }
        case "a:cubicBezTo":
          lineOnly = false;
          cubic(pt(pts[0]), pt(pts[1]), pt(pts[2]));
          break;
        case "a:quadBezTo": {
          lineOnly = false;
          const q = pt(pts[0]);
          const e = pt(pts[1]);
          cubic({ x: last.x + (2 / 3) * (q.x - last.x), y: last.y + (2 / 3) * (q.y - last.y) }, { x: e.x + (2 / 3) * (q.x - e.x), y: e.y + (2 / 3) * (q.y - e.y) }, e);
          break;
        }
        case "a:arcTo": {
          lineOnly = false;
          // Elliptical arc from the current point: radii in path units, angles
          // in 60000ths of a degree, clockwise in y-down space. Split into
          // <= 90 degree cubic pieces.
          const rx = Number(cmd.attrs.wR ?? 0) * kx;
          const ry = Number(cmd.attrs.hR ?? 0) * ky;
          const st = (Number(cmd.attrs.stAng ?? 0) / DEG) * (Math.PI / 180);
          const sw = (Number(cmd.attrs.swAng ?? 0) / DEG) * (Math.PI / 180);
          if (!rx || !ry || !sw) break;
          const cx = last.x - rx * Math.cos(st);
          const cy = last.y - ry * Math.sin(st);
          const n = Math.max(1, Math.ceil(Math.abs(sw) / (Math.PI / 2)));
          const step = sw / n;
          const k = (4 / 3) * Math.tan(step / 4);
          for (let i = 0; i < n; i++) {
            const a0 = st + i * step;
            const a1 = a0 + step;
            const p0 = { x: cx + rx * Math.cos(a0), y: cy + ry * Math.sin(a0) };
            const p1 = { x: cx + rx * Math.cos(a1), y: cy + ry * Math.sin(a1) };
            cubic(
              { x: p0.x - k * rx * Math.sin(a0), y: p0.y + k * ry * Math.cos(a0) },
              { x: p1.x + k * rx * Math.sin(a1), y: p1.y - k * ry * Math.cos(a1) },
              p1,
            );
          }
          break;
        }
        case "a:close": {
          const c = ensure();
          c.closed = true;
          // A closing point that repeats the start folds into it, carrying its
          // in-handle, so the engine does not draw a zero-length edge.
          const segs = c.segments;
          const end = segs[segs.length - 1];
          if (segs.length > 1 && Math.abs(end.x - segs[0].x) < 1e-6 && Math.abs(end.y - segs[0].y) < 1e-6) {
            if (end.cIn) segs[0].cIn = end.cIn;
            segs.pop();
          }
          last = start;
          finish();
          break;
        }
      }
    }
    finish();
  }
  if (!contours.length) return null;
  // Rectangle test: one closed straight-line contour whose 4 corners sit on
  // the bounding box edges (axis-aligned), regardless of winding.
  let isRect = false;
  if (lineOnly && contours.length === 1 && contours[0].segments.length === 4) {
    const s = contours[0].segments;
    const xs = s.map((p) => p.x);
    const ys = s.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
    isRect = s.every((p) => (near(p.x, x0) || near(p.x, x1)) && (near(p.y, y0) || near(p.y, y1)))
      && near(x0, 0) && near(y0, 0) && near(x1, w) && near(y1, h);
  }
  return { contours, isRect, filled };
}

// --- text --------------------------------------------------------------------

// Weight words some exporters (notably Canva) bake into the typeface name
// instead of setting b="1": "Titillium Web Semi-Bold", "Playfair Display Bold",
// even "Titillium Web Regular Bold". Longest first so "Semi-Bold" wins over
// "Bold". Keys are the engine's named styles (weightFromFontStyle).
const WEIGHT_SUFFIXES: [RegExp, string][] = [
  [/[\s-]+(extra|ultra)[\s-]?light$/i, "ExtraLight"],
  [/[\s-]+(semi|demi)[\s-]?bold$/i, "SemiBold"],
  [/[\s-]+(extra|ultra)[\s-]?bold$/i, "ExtraBold"],
  [/[\s-]+(black|heavy)$/i, "Black"],
  [/[\s-]+bold$/i, "Bold"],
  [/[\s-]+medium$/i, "Medium"],
  [/[\s-]+light$/i, "Light"],
  [/[\s-]+thin$/i, "Thin"],
];

/** Split a typeface name into family + named style, honoring the run's own
 *  b/i flags. "Titillium Web Regular Bold" -> family "Titillium Web", "Bold". */
export function fontFromTypeface(typeface: string | undefined, bold: boolean, italic: boolean): { family: string; style: string } {
  let family = (typeface ?? "").trim();
  let weight: string | null = null;
  if (/[\s-]+italic$/i.test(family)) {
    italic = true;
    family = family.replace(/[\s-]+italic$/i, "");
  }
  for (const [re, name] of WEIGHT_SUFFIXES) {
    if (re.test(family)) {
      weight = name;
      family = family.replace(re, "");
      break;
    }
  }
  family = family.replace(/[\s-]+regular$/i, "").trim();
  if (!weight) weight = bold ? "Bold" : "Regular";
  const style = italic ? (weight === "Regular" ? "Italic" : `${weight} Italic`) : weight;
  return { family: family || "system", style };
}

const NAMED_WEIGHT_NUM: Record<string, number> = { Thin: 100, ExtraLight: 200, Light: 300, Regular: 400, Medium: 500, SemiBold: 600, Bold: 700, ExtraBold: 800, Black: 900 };

function paragraphsFrom(txBody: XmlElement, theme: Map<string, string>): unknown[] {
  const paras: unknown[] = [];
  for (const p of childrenOf(txBody, "a:p")) {
    const pPr = childOf(p, "a:pPr");
    const align = ({ l: "left", ctr: "center", r: "right", just: "justify" } as Record<string, string>)[pPr?.attrs.algn ?? "l"] ?? "left";
    const runs: unknown[] = [];
    for (const r of childrenOf(p, "a:r")) {
      const t = childOf(r, "a:t")?.text ?? "";
      if (!t) continue;
      const rPr = childOf(r, "a:rPr");
      const sizePt = rPr?.attrs.sz ? Number(rPr.attrs.sz) / 100 : 18;
      const bold = rPr?.attrs.b === "1";
      const italic = rPr?.attrs.i === "1";
      const under = !!rPr?.attrs.u && rPr.attrs.u !== "none";
      const strike = !!rPr?.attrs.strike && rPr.attrs.strike !== "noStrike";
      const solid = rPr ? childOf(rPr, "a:solidFill") : null;
      const color = solid ? firstColorChild(solid, theme) : null;
      const latin = rPr ? childOf(rPr, "a:latin")?.attrs.typeface : undefined;
      const decoration = [...(under ? ["underline"] : []), ...(strike ? ["strikethrough"] : [])];
      const font = fontFromTypeface(latin, bold, italic);
      runs.push({
        text: t,
        style: {
          fontFamily: font.family,
          fontStyle: font.style,
          fontSize: Math.max(6, Math.round((sizePt / 0.75) * 10) / 10), // pt -> px @96dpi
          fill: { type: "solid", color: { srgb: color ?? { r: 0.07, g: 0.09, b: 0.13, a: 1 } } },
          ...(decoration.length ? { decoration } : {}),
        },
      });
    }
    if (runs.length) paras.push({ runs, style: { align, direction: "auto" } });
  }
  return paras;
}

/** Cell text as flat `TextRun`s. A table cell is NOT the paragraph/run tree a
 *  text node uses: `TableCell.content` is `TextRun[]` (`fontId`/`fontSize`/
 *  `weight`), so reusing paragraphsFrom here would produce a node the schema
 *  rejects and the renderer draws unstyled. Paragraphs join with a space
 *  because a cell renders as one line. */
function cellRuns(txBody: XmlElement, theme: Map<string, string>): unknown[] {
  const runs: unknown[] = [];
  const paras = childrenOf(txBody, "a:p");
  paras.forEach((p, pi) => {
    if (pi > 0 && runs.length) runs.push({ text: " ", fontId: "system", fontSize: 14, weight: 400 });
    for (const r of childrenOf(p, "a:r")) {
      const t = childOf(r, "a:t")?.text ?? "";
      if (!t) continue;
      const rPr = childOf(r, "a:rPr");
      const sizePt = rPr?.attrs.sz ? Number(rPr.attrs.sz) / 100 : 14;
      const solid = rPr ? childOf(rPr, "a:solidFill") : null;
      const color = solid ? firstColorChild(solid, theme) : null;
      const under = !!rPr?.attrs.u && rPr.attrs.u !== "none";
      const strike = !!rPr?.attrs.strike && rPr.attrs.strike !== "noStrike";
      const decoration = [...(under ? ["underline"] : []), ...(strike ? ["strikethrough"] : [])];
      const font = fontFromTypeface(rPr ? childOf(rPr, "a:latin")?.attrs.typeface : undefined, rPr?.attrs.b === "1", rPr?.attrs.i === "1");
      runs.push({
        text: t,
        fontId: font.family,
        fontSize: Math.max(6, Math.round((sizePt / 0.75) * 10) / 10), // pt -> px @96dpi
        weight: NAMED_WEIGHT_NUM[font.style.replace(/\s*Italic$/, "") || "Regular"] ?? 400,
        ...(/Italic$/.test(font.style) ? { italic: true } : {}),
        ...(color ? { color: { srgb: color } } : {}),
        ...(decoration.length ? { decoration } : {}),
      });
    }
  });
  return runs;
}

// --- the importer ------------------------------------------------------------

/** Parse .pptx bytes into an editable DesignFile. Embedded images become
 *  self-contained data: URL assets, so the file opens anywhere. */
export async function pptxToDesign(bytes: Uint8Array, opts: { title?: string; onWarning?: (message: string) => void } = {}): Promise<DesignFile> {
  const zip = await unzip(bytes);
  const read = (name: string): string | null => {
    const data = zip.get(name.replace(/^\//, ""));
    return data ? new TextDecoder().decode(data) : null;
  };
  const readRels = (partPath: string): Map<string, string> => {
    const dir = partPath.slice(0, partPath.lastIndexOf("/") + 1);
    const relsPath = `${dir}_rels/${partPath.slice(partPath.lastIndexOf("/") + 1)}.rels`;
    const out = new Map<string, string>();
    const xml = read(relsPath);
    if (!xml) return out;
    for (const rel of findAll(parseXml(xml), "Relationship")) {
      const target = rel.attrs.Target ?? "";
      const resolved = target.startsWith("../") ? dir.replace(/[^/]+\/$/, "") + target.slice(3) : target.startsWith("/") ? target.slice(1) : dir + target;
      out.set(rel.attrs.Id ?? "", resolved);
    }
    return out;
  };

  const presXmlSrc = read("ppt/presentation.xml");
  if (!presXmlSrc) throw new Error("not a .pptx (missing ppt/presentation.xml)");
  const pres = parseXml(presXmlSrc);
  const presRels = readRels("ppt/presentation.xml");

  // Slide size (EMU -> px). PowerPoint's default 16:9 is 12192000x6858000.
  const sldSz = findFirst(pres, "p:sldSz");
  const pageW = Math.round(px(sldSz?.attrs.cx) || 1280);
  const pageH = Math.round(px(sldSz?.attrs.cy) || 720);

  // Theme color scheme for schemeClr resolution.
  const theme = new Map<string, string>();
  const themePath = [...presRels.values()].find((t) => t.includes("theme/")) ?? "ppt/theme/theme1.xml";
  const themeSrc = read(themePath);
  if (themeSrc) {
    const scheme = findFirst(parseXml(themeSrc), "a:clrScheme");
    for (const slot of scheme?.children ?? []) {
      const name = slot.tag.replace(/^a:/, "");
      const c = childOf(slot, "a:srgbClr")?.attrs.val ?? childOf(slot, "a:sysClr")?.attrs.lastClr;
      if (c) theme.set(name, c);
    }
  }

  // A slide's background as PowerPoint shows it: the slide's own <p:bg>, else
  // its layout's, else its master's. Exporters such as Canva put the white
  // page on the master only (`<p:bgRef idx="1001"><a:schemeClr val="bg1"/>`),
  // so reading the slide alone left those pages without any background.
  // A <p:bgRef> points into the theme's background fill styles with its child
  // as the placeholder colour; it is taken as that colour (exact for the
  // usual solid style, the closest flat approximation for a gradient or
  // picture style).
  const bgOfPart = (xmlRoot: ReturnType<typeof parseXml>): unknown | undefined => {
    const bgEl = findFirst(xmlRoot, "p:bg");
    if (!bgEl) return undefined;
    const bgPr = childOf(bgEl, "p:bgPr");
    if (bgPr) return fillFrom(bgPr, theme) ?? undefined;
    const bgRef = childOf(bgEl, "p:bgRef");
    if (bgRef) {
      const c = firstColorChild(bgRef, theme);
      if (c) return { type: "solid", color: { srgb: c } };
    }
    return undefined;
  };
  const inheritedBg = new Map<string, unknown | undefined>();
  const backgroundFor = (slidePath: string, slideRoot: ReturnType<typeof parseXml>): unknown | undefined => {
    const own = bgOfPart(slideRoot);
    if (own !== undefined) return own;
    const layoutPath = [...readRels(slidePath).values()].find((t) => t.includes("slideLayouts/"));
    if (!layoutPath) return undefined;
    if (!inheritedBg.has(layoutPath)) {
      const layoutSrc = read(layoutPath);
      let bg = layoutSrc ? bgOfPart(parseXml(layoutSrc)) : undefined;
      if (bg === undefined) {
        const masterPath = [...readRels(layoutPath).values()].find((t) => t.includes("slideMasters/"));
        const masterSrc = masterPath ? read(masterPath) : null;
        bg = masterSrc ? bgOfPart(parseXml(masterSrc)) : undefined;
      }
      inheritedBg.set(layoutPath, bg);
    }
    return inheritedBg.get(layoutPath);
  };

  const slidePaths = findAll(pres, "p:sldId")
    .map((sl) => presRels.get(sl.attrs["r:id"] ?? ""))
    .filter((path): path is string => !!path);

  const file = createBlankDesign({ title: opts.title ?? "Imported presentation", width: pageW, height: pageH });
  file.pages = [];
  const assets: { id: string; kind: string; url: string; mime: string; checksum: string }[] = [];
  let assetSeq = 0;
  let nodeSeq = 0;
  const nid = (kind: string) => `pptx-${kind}-${++nodeSeq}`;

  const bytesToDataUrl = (data: Uint8Array, mime: string): string => {
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < data.length; i += CHUNK) {
      bin += String.fromCharCode(...data.subarray(i, i + CHUNK));
    }
    // btoa exists in browser and node 16+.
    return `data:${mime};base64,${btoa(bin)}`;
  };

  for (const slidePath of slidePaths) {
    const src = read(slidePath);
    if (!src) continue;
    const slide = parseXml(src);
    const rels = readRels(slidePath);
    const children: Node[] = [];
    // Where emitted nodes land: the slide, or a group's children while one is
    // being walked (see p:grpSp below).
    let target: Node[] = children;

    // Slide background (inherited from layout and master like PowerPoint).
    const bg = backgroundFor(slidePath, slide);

    const emitShape = (sp: XmlElement, frame: Xfrm, base: { dx: number; dy: number; sx: number; sy: number }): void => {
      const abs = {
        x: base.dx + frame.x * base.sx,
        y: base.dy + frame.y * base.sy,
        w: frame.w * base.sx,
        h: frame.h * base.sy,
        rot: frame.rot,
        flipH: frame.flipH,
        flipV: frame.flipV,
      };
      const spPr = findFirst(sp, "p:spPr");
      const prst = spPr ? findFirst(spPr, "a:prstGeom")?.attrs.prst ?? "rect" : "rect";
      const fill = spPr ? fillFrom(spPr, theme) : undefined;
      const stroke = spPr ? strokeFrom(spPr, theme) : null;
      const txBody = findFirst(sp, "p:txBody");
      const paras = txBody ? paragraphsFrom(txBody, theme) : [];
      const t = toEngineTransform(abs);
      const name = findFirst(sp, "p:cNvPr")?.attrs.name;
      const custGeom = spPr ? childOf(spPr, "a:custGeom") : null;
      const geom = custGeom ? custGeomContours(custGeom, abs.w, abs.h) : null;
      const blipFill = spPr ? childOf(spPr, "a:blipFill") : null;

      // A picture fill (Canva exports every image this way: a freeform rect
      // with a:blipFill, not a p:pic) becomes a real image node. A non-rect
      // outline cannot clip an image in the editor yet, so the image keeps the
      // shape's bounds and the loss is reported.
      if (blipFill) {
        if ((custGeom && geom && !geom.isRect) || (!custGeom && prst !== "rect")) {
          opts.onWarning?.(`${name ?? "shape"}: image fill in a non-rectangular outline imported as a rectangular image`);
        }
        pushImage(blipFill, abs, name);
      } else if (custGeom && geom && !geom.isRect && (fill || stroke)) {
        // A true freeform outline (logo, vector art) stays an editable path.
        const [first, ...rest] = geom.contours;
        target.push(createNode("path", {
          id: nid("path"),
          ...(name ? { name } : {}),
          transform: t,
          size: { width: abs.w, height: abs.h },
          segments: first.segments,
          closed: first.closed,
          ...(rest.length ? { contours: rest } : {}),
          fills: fill && geom.filled ? [fill] : [],
          ...(stroke ? { stroke } : {}),
        } as Partial<Node>));
      } else if (fill || stroke) {
        // A filled/stroked geometry becomes a shape; visible text overlays it
        // as a text node with the same frame (the open format keeps them separate).
        const preset = shapeFor(prst);
        target.push(createNode("shape", {
          id: nid("shape"),
          ...(name ? { name } : {}),
          shape: preset.shape,
          ...(preset.sides ? { sides: preset.sides } : {}),
          ...(preset.rounded ? { cornerRadius: { tl: 12, tr: 12, br: 12, bl: 12 } } : {}),
          transform: { ...t, scaleX: t.scaleX, scaleY: t.scaleY, rotation: t.rotation },
          size: { width: abs.w, height: abs.h },
          fills: fill ? [fill] : [],
          ...(stroke ? { stroke } : {}),
        } as Partial<Node>));
      }
      if (paras.length) {
        target.push(createNode("text", {
          id: nid("text"),
          ...(name ? { name } : {}),
          transform: { x: t.x, y: t.y, scaleX: 1, scaleY: 1, rotation: t.rotation },
          size: { width: abs.w, height: abs.h },
          box: { mode: "fixed", width: abs.w, height: abs.h, autoFit: { enabled: false, min: 6, max: 512 }, verticalAlign: "top" },
          content: paras,
        } as Partial<Node>));
      }
    };

    const emitPic = (pic: XmlElement, frame: Xfrm, base: { dx: number; dy: number; sx: number; sy: number }): void => {
      const abs = { x: base.dx + frame.x * base.sx, y: base.dy + frame.y * base.sy, w: frame.w * base.sx, h: frame.h * base.sy, rot: frame.rot, flipH: frame.flipH, flipV: frame.flipV };
      const blipFill = findFirst(pic, "p:blipFill");
      if (blipFill) pushImage(blipFill, abs, findFirst(pic, "p:cNvPr")?.attrs.name);
    };

    /** One image node from a blip fill container (p:blipFill of a picture or
     *  a:blipFill of a shape): media as a data: asset, a:srcRect crop,
     *  a:alphaModFix transparency, stretch vs cover. */
    function pushImage(blipFill: XmlElement, abs: { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean }, name?: string): void {
      const blip = findFirst(blipFill, "a:blip");
      const embed = blip?.attrs["r:embed"];
      const mediaPath = embed ? rels.get(embed) : undefined;
      const media = mediaPath ? zip.get(mediaPath) : undefined;
      if (!media) {
        opts.onWarning?.(`${name ?? "image"}: picture data missing (${embed ?? "no r:embed"}), skipped`);
        return;
      }
      const ext = mediaPath!.slice(mediaPath!.lastIndexOf(".") + 1).toLowerCase();
      const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "svg" ? "image/svg+xml" : "image/png";
      const assetId = `pptx-asset-${++assetSeq}`;
      assets.push({ id: assetId, kind: "image", url: bytesToDataUrl(media, mime), mime, checksum: "" });
      const alphaMod = blip ? findFirst(blip, "a:alphaModFix") : null;
      const opacity = alphaMod ? Math.max(0, Math.min(1, Number(alphaMod.attrs.amt ?? 100000) / 100000)) : 1;
      const stretch = !!childOf(blipFill, "a:stretch");
      const srcRect = findFirst(blipFill, "a:srcRect");
      const per = (v: string | undefined) => Math.max(0, Math.min(1, Number(v ?? 0) / 100000));
      let crop: { x: number; y: number; width: number; height: number } | undefined;
      if (srcRect) {
        const l = per(srcRect.attrs.l);
        const tt = per(srcRect.attrs.t);
        const w = Math.max(0.001, 1 - l - per(srcRect.attrs.r));
        const h = Math.max(0.001, 1 - tt - per(srcRect.attrs.b));
        crop = { x: l, y: tt, width: w, height: h };
      }
      // a:stretch/a:fillRect places the (cropped) picture relative to the box:
      // insets in 1/1000 %, negative = the picture extends past the box and is
      // clipped by it. That is how Canva writes its crop. The visible part of
      // the picture is then the box seen through the larger picture rect.
      const fillRect = stretch ? findFirst(blipFill, "a:fillRect") : null;
      if (fillRect) {
        const f = (v: string | undefined) => Number(v ?? 0) / 100000;
        const fl = f(fillRect.attrs.l), ft = f(fillRect.attrs.t), fr = f(fillRect.attrs.r), fb = f(fillRect.attrs.b);
        const spanX = 1 - fl - fr;
        const spanY = 1 - ft - fb;
        if (spanX > 0 && spanY > 0 && (fl || ft || fr || fb)) {
          const base = crop ?? { x: 0, y: 0, width: 1, height: 1 };
          const vx = Math.max(0, -fl / spanX);
          const vy = Math.max(0, -ft / spanY);
          const vw = Math.min(1 - vx, 1 / spanX);
          const vh = Math.min(1 - vy, 1 / spanY);
          crop = {
            x: base.x + vx * base.width,
            y: base.y + vy * base.height,
            width: Math.max(0.001, vw * base.width),
            height: Math.max(0.001, vh * base.height),
          };
        }
      }
      const t = toEngineTransform(abs);
      target.push(createNode("image", {
        id: nid("image"),
        ...(name ? { name } : {}),
        transform: t,
        size: { width: abs.w, height: abs.h },
        opacity,
        source: { assetId, naturalWidth: 0, naturalHeight: 0 },
        // a:stretch maps the (cropped) picture onto the box exactly.
        fit: stretch ? "stretch" : "cover",
        ...(crop ? { crop } : {}),
      } as Partial<Node>));
    }

    type AbsFrame = { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean };

    // A PowerPoint table (a:tbl) as an editable TableNode: column widths and
    // row heights come from the grid, cell text from each cell's txBody.
    const emitTable = (tbl: XmlElement, abs: AbsFrame): boolean => {
      const grid = findFirst(tbl, "a:tblGrid");
      const colWidths = grid ? childrenOf(grid, "a:gridCol").map((c) => px(c.attrs.w)) : [];
      const rowEls = childrenOf(tbl, "a:tr");
      if (!rowEls.length || !colWidths.length) return false;
      const rowHeights = rowEls.map((r) => px(r.attrs.h) || 32);
      const cells: unknown[] = [];
      rowEls.forEach((tr, row) => {
        childrenOf(tr, "a:tc").forEach((tc, col) => {
          // Continuation cells of a merge carry no content of their own.
          if (tc.attrs.hMerge === "1" || tc.attrs.vMerge === "1") return;
          const txBody = findFirst(tc, "a:txBody");
          const content = txBody ? cellRuns(txBody, theme) : [];
          const algn = txBody ? findFirst(txBody, "a:pPr")?.attrs.algn : undefined;
          const align = ({ l: "left", ctr: "center", r: "right" } as Record<string, "left" | "center" | "right">)[algn ?? ""];
          cells.push({
            row,
            col,
            rowSpan: Math.max(1, Number(tc.attrs.rowSpan ?? 1)),
            colSpan: Math.max(1, Number(tc.attrs.gridSpan ?? 1)),
            content,
            ...(align ? { align } : {}),
          });
        });
      });
      // Scale the grid to the frame the slide actually gives the table.
      const gridW = colWidths.reduce((a, b) => a + b, 0) || abs.w;
      const gridH = rowHeights.reduce((a, b) => a + b, 0) || abs.h;
      const kx = abs.w > 0 && gridW > 0 ? abs.w / gridW : 1;
      const ky = abs.h > 0 && gridH > 0 ? abs.h / gridH : 1;
      target.push(createNode("table", {
        id: nid("table"),
        transform: toEngineTransform(abs),
        size: { width: abs.w || gridW, height: abs.h || gridH },
        rows: rowEls.length,
        cols: colWidths.length,
        colWidths: colWidths.map((w) => w * kx),
        rowHeights: rowHeights.map((h) => h * ky),
        cells,
      } as Partial<Node>));
      return true;
    };

    // Charts, SmartArt and embedded media have no native equivalent yet.
    // Import them as a bounded, labelled text box so the slide keeps its
    // layout and the user can see exactly what needs replacing.
    const emitUnsupportedGraphic = (frameEl: XmlElement, abs: AbsFrame): void => {
      const uri = findFirst(frameEl, "a:graphicData")?.attrs.uri ?? "";
      const kind = uri.includes("/chart") ? "Chart" : uri.includes("/diagram") ? "SmartArt diagram" : uri.includes("/table") ? "Table" : "Embedded object";
      const name = findFirst(frameEl, "p:cNvPr")?.attrs.name ?? "";
      const label = `[${kind} from PowerPoint${name ? `: ${name}` : ""} - not imported]`;
      const bw = Math.max(24, abs.w);
      const bh = Math.max(18, abs.h);
      target.push(createNode("text", {
        id: nid("text"),
        transform: toEngineTransform(abs),
        size: { width: bw, height: bh },
        box: { mode: "fixed", width: bw, height: bh, autoFit: { enabled: false, min: 6, max: 512 }, verticalAlign: "middle" },
        content: [{
          runs: [{
            text: label,
            style: {
              fontFamily: "system",
              fontStyle: "Regular",
              fontSize: 14,
              fill: { type: "solid", color: { srgb: { r: 0.45, g: 0.47, b: 0.53, a: 1 } } },
            },
          }],
          style: { align: "center", direction: "auto" },
        }],
      } as Partial<Node>));
    };

    const walkTree = (tree: XmlElement, base: { dx: number; dy: number; sx: number; sy: number }): void => {
      for (const child of tree.children) {
        if (child.tag === "p:sp") {
          const frame = xfrmFrom(findFirst(child, "p:spPr"));
          if (frame) emitShape(child, frame, base);
        } else if (child.tag === "p:pic") {
          const frame = xfrmFrom(findFirst(child, "p:spPr"));
          if (frame) emitPic(child, frame, base);
        } else if (child.tag === "p:cxnSp") {
          const spPr = findFirst(child, "p:spPr");
          const frame = xfrmFrom(spPr);
          const prst = spPr ? findFirst(spPr, "a:prstGeom")?.attrs.prst : undefined;
          if (frame && prst === "line") {
            const stroke = (spPr && strokeFrom(spPr, theme)) || { fill: { type: "solid", color: { srgb: { r: 0, g: 0, b: 0, a: 1 } } }, width: 2, align: "center", cap: "round", join: "round" };
            const w = frame.w * base.sx;
            const h = frame.h * base.sy;
            // flipV mirrors the line's direction inside its box.
            const pts = frame.flipV ? [{ x: 0, y: h }, { x: w, y: 0 }] : [{ x: 0, y: 0 }, { x: w, y: h }];
            target.push(createNode("line", {
              id: nid("line"),
              transform: { x: base.dx + frame.x * base.sx, y: base.dy + frame.y * base.sy, scaleX: 1, scaleY: 1, rotation: frame.rot },
              size: { width: Math.max(1, w), height: Math.max(1, h) },
              points: pts,
              stroke,
            } as Partial<Node>));
          } else if (frame) {
            emitShape(child, frame, base); // non-line connectors keep their bounds
          }
        } else if (child.tag === "p:graphicFrame") {
          // Tables, charts, SmartArt and embedded media all arrive as a
          // graphicFrame. A real table imports as an editable TableNode; the
          // rest have no native equivalent yet, so they land as a labelled
          // placeholder at the right position rather than disappearing from
          // the slide with no trace.
          // A graphicFrame carries p:xfrm directly (not wrapped in spPr), so
          // read its offset/extent here rather than through xfrmFrom.
          const gx = findFirst(child, "p:xfrm");
          const off = gx ? childOf(gx, "a:off") : null;
          const ext = gx ? childOf(gx, "a:ext") : null;
          if (!gx || !off || !ext) continue;
          const frame: Xfrm = {
            x: px(off.attrs.x),
            y: px(off.attrs.y),
            w: Math.max(1, px(ext.attrs.cx)),
            h: Math.max(1, px(ext.attrs.cy)),
            rot: Number(gx.attrs.rot ?? 0) / DEG,
            flipH: false, // PowerPoint does not mirror graphicFrames
            flipV: false,
          };
          const abs = {
            x: base.dx + frame.x * base.sx,
            y: base.dy + frame.y * base.sy,
            w: frame.w * base.sx,
            h: frame.h * base.sy,
            rot: frame.rot,
            flipH: frame.flipH,
            flipV: frame.flipV,
          };
          const tbl = findFirst(child, "a:tbl");
          if (tbl && emitTable(tbl, abs)) continue;
          emitUnsupportedGraphic(child, abs);
        } else if (child.tag === "p:grpSp") {
          const frame = xfrmFrom(findFirst(child, "p:grpSpPr"));
          if (!frame) continue;
          // Keep the group as a real GroupNode so the layer structure
          // survives. Children live in the chOff/chExt space; map them into
          // the group's own local box (engine groups are group-local: world =
          // group matrix x child matrix), and let the group carry its on-slide
          // position, rotation and flips.
          const sx = base.sx * (frame.chExt ? frame.w / frame.chExt.w : 1);
          const sy = base.sy * (frame.chExt ? frame.h / frame.chExt.h : 1);
          const gAbs = {
            x: base.dx + frame.x * base.sx,
            y: base.dy + frame.y * base.sy,
            w: frame.w * base.sx,
            h: frame.h * base.sy,
            rot: frame.rot,
            flipH: frame.flipH,
            flipV: frame.flipV,
          };
          const kids: Node[] = [];
          const outer = target;
          target = kids;
          walkTree(child, { dx: -(frame.chOff?.x ?? 0) * sx, dy: -(frame.chOff?.y ?? 0) * sy, sx, sy });
          target = outer;
          if (!kids.length) continue;
          const groupName = findFirst(child, "p:cNvPr")?.attrs.name;
          target.push(createNode("group", {
            id: nid("group"),
            ...(groupName ? { name: groupName } : {}),
            transform: toEngineTransform(gAbs),
            size: { width: gAbs.w, height: gAbs.h },
            children: kids,
          } as Partial<Node>));
        }
      }
    };

    const tree = findFirst(slide, "p:spTree");
    if (tree) walkTree(tree, { dx: 0, dy: 0, sx: 1, sy: 1 });

    // Speaker notes via the slide's notesSlide relationship.
    let notes = "";
    const notesPath = [...rels.values()].find((p) => p.includes("notesSlides/"));
    if (notesPath) {
      const notesSrc = read(notesPath);
      if (notesSrc) {
        const body = parseXml(notesSrc);
        // The body placeholder's paragraphs; skip the slide-number placeholder.
        const texts: string[] = [];
        for (const sp of findAll(body, "p:sp")) {
          const ph = findFirst(sp, "p:ph");
          if (ph && ph.attrs.type && ph.attrs.type !== "body") continue;
          const tx = findFirst(sp, "p:txBody");
          if (!tx) continue;
          for (const p of childrenOf(tx, "a:p")) {
            // Keep blank paragraphs: they are the presenter's deliberate
            // spacing; only the OUTER blank edges trim below.
            texts.push(findAll(p, "a:t").map((t) => t.text).join(""));
          }
        }
        notes = texts.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
      }
    }

    file.pages.push({
      id: `pptx-slide-${file.pages.length + 1}`,
      width: pageW,
      height: pageH,
      children: children as never[],
      ...(bg ? { background: bg } : {}),
      ...(notes ? { notes } : {}),
    } as never);
  }

  if (!file.pages.length) throw new Error("no slides found in the .pptx");
  (file as { assets?: unknown[] }).assets = assets;
  return file;
}
