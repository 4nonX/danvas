// Flatten an SVG's group transforms before converting to scene nodes. The
// @hc/stock `svgToNodes` is a flat, dependency-free scanner that ignores
// ancestor <g transform="..."> nesting, so a grouped/transformed SVG (e.g. an
// export from another design tool) would import with wrong positions/scales. Here, in the browser,
// we parse the DOM, accumulate each leaf's full transform matrix (translate /
// scale / rotate / matrix / skew, nested), convert that single leaf via
// svgToNodes (which yields it in its own local coordinates), then bake the
// accumulated matrix onto the resulting node's transform. Rotation is preserved;
// shear is folded into scale/rotation by `decompose` (rare in practice).

import { svgToNodes, parseGradients } from "@hc/stock";
import { decompose, fontFamilyStack, fromTransform, identity, multiply, type Mat2D } from "@hc/engine";
import { createNode, type Node } from "@hc/schema";
import { fonts } from "@/lib/fontProvider";

const LEAF = new Set(["path", "rect", "circle", "ellipse", "line", "polygon", "polyline", "text", "image"]);
const CONTAINER = new Set(["g", "a", "svg"]);

const RAD = Math.PI / 180;

/** Parse an SVG `transform` attribute (a list of functions) into one matrix. */
export function parseTransform(s: string | null): Mat2D {
  let m = identity();
  if (!s) return m;
  for (const fn of s.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = fn[2].split(/[\s,]+/).map(Number).filter((n) => !Number.isNaN(n));
    let t: Mat2D | null = null;
    switch (fn[1]) {
      case "translate": t = { a: 1, b: 0, c: 0, d: 1, e: a[0] || 0, f: a[1] || 0 }; break;
      case "scale": { const sx = a[0] ?? 1; const sy = a[1] ?? sx; t = { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }; break; }
      case "rotate": {
        const ang = (a[0] || 0) * RAD, cos = Math.cos(ang), sin = Math.sin(ang);
        const r: Mat2D = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
        t = a.length >= 3
          ? multiply(multiply({ a: 1, b: 0, c: 0, d: 1, e: a[1], f: a[2] }, r), { a: 1, b: 0, c: 0, d: 1, e: -a[1], f: -a[2] })
          : r;
        break;
      }
      case "matrix": if (a.length === 6) t = { a: a[0], b: a[1], c: a[2], d: a[3], e: a[4], f: a[5] }; break;
      case "skewX": t = { a: 1, b: 0, c: Math.tan((a[0] || 0) * RAD), d: 1, e: 0, f: 0 }; break;
      case "skewY": t = { a: 1, b: Math.tan((a[0] || 0) * RAD), c: 0, d: 1, e: 0, f: 0 }; break;
    }
    if (t) m = multiply(m, t);
  }
  return m;
}

export interface FlattenResult {
  nodes: Node[];
  assets: { assetId: string; url: string }[];
  approximated: boolean;
}

// Paint/text properties whose resolved (computed) value we bake onto each leaf so
// svgToNodes sees the real color even when it came from a <style> CSS class,
// `currentColor`, or inheritance rather than an inline attribute.
const COMPUTED_PROPS = [
  "fill", "fill-opacity", "stroke", "stroke-opacity", "stroke-width", "opacity",
  "font-family", "font-size", "font-weight", "font-style", "text-anchor",
];

// getComputedStyle can report paint in modern color spaces (lab()/lch()/oklab()/
// oklch()/color()) — this is what `currentColor` resolves to under a Tailwind v4
// theme. The dependency-free SVG color parser only understands hex/rgb/hsl/named,
// so it drops those colors: a fill silently falls back to black, but a stroke-only
// shape (outline icons: fill="none") loses its ONLY paint and renders invisible.
// Rasterize such a value to one pixel and read it back as sRGB so the parser can
// consume it. Returns a normalizer, or null when there is no canvas.
function makeColorNormalizer(): ((v: string) => string) | null {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const c = cv.getContext("2d", { willReadFrequently: true });
  if (!c) return null;
  return (v: string): string => {
    if (!v || v === "none" || v === "transparent" || v.startsWith("url(")) return v;
    if (/^(#|rgb|hsl)/i.test(v)) return v; // already parser-readable
    try {
      c.clearRect(0, 0, 1, 1);
      c.fillStyle = v;
      c.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = c.getImageData(0, 0, 1, 1).data;
      return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
    } catch {
      return v;
    }
  };
}

/** Overwrite the element's inline style with its computed paint/text values, so
 *  the downstream attribute parser (which lets `style` win) picks them up. Paint
 *  colors are normalized to sRGB via `toRgb` so modern color spaces still parse. */
function inlineComputedPaint(el: Element, toRgb: ((v: string) => string) | null): void {
  const cs = window.getComputedStyle(el);
  const decls: string[] = [];
  for (const p of COMPUTED_PROPS) {
    let v = cs.getPropertyValue(p).trim();
    if (!v || v === "normal") continue;
    if (toRgb && (p === "fill" || p === "stroke")) v = toRgb(v);
    decls.push(`${p}:${v}`);
  }
  if (decls.length) el.setAttribute("style", decls.join(";"));
}

// --- text ------------------------------------------------------------------
// SVG text as written by design tools is positioned per span: Affinity and
// Illustrator kern a single letter with <tspan x="..">, and the rest of the
// word continues after it ("M<tspan x=..>A</tspan>RKT"). The flat parser turns
// that into one string with a guessed width, which wraps and drops the
// kerning. Here the mounted SVG is laid out by the browser already, so each
// run that starts at its own position becomes its own text node, placed where
// the browser put its first character and as wide as the browser measured it.

const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace"]);

/** The first family of a CSS font list this app can render. PostScript-style
 *  names ("TrajanPro-Bold") are also tried as family names ("Trajan Pro"). */
export function resolveFontFamily(list: string): string {
  const candidates = list.split(",").map((f) => f.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  const variants = (f: string) => {
    const base = f.replace(/-(Bold|Regular|Italic|Light|Medium|Semibold|SemiBold|Black|Heavy|Thin|Book|Roman|BoldItalic)$/i, "");
    return [f, base, base.replace(/([a-z])([A-Z])/g, "$1 $2")];
  };
  for (const c of candidates) {
    if (GENERIC_FAMILIES.has(c.toLowerCase())) continue;
    for (const v of variants(c)) if (fonts.knows(v)) return v;
  }
  // Nothing installed yet (the font may be uploaded later): prefer an entry
  // that reads like a family name ("Goudy Old Style") over a PostScript name.
  const named = candidates.find((c) => !GENERIC_FAMILIES.has(c.toLowerCase()) && /\s/.test(c));
  if (named) return named;
  const first = candidates.find((c) => !GENERIC_FAMILIES.has(c.toLowerCase()));
  return first ? variants(first)[2] : "system";
}

function rgbaOf(v: string): { r: number; g: number; b: number; a: number } | null {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(v.trim());
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return { r: +m[1] / 255, g: +m[2] / 255, b: +m[3] / 255, a };
}

/** Text nodes for a mounted <text> element, from the browser's own layout.
 *  Null when the layout cannot be mapped (the caller then uses the flat parser). */
function textNodesFromLayout(el: SVGTextElement, idGen: () => string, toRgb: ((v: string) => string) | null): Node[] | null {
  const count = el.getNumberOfChars?.();
  if (!count) return count === 0 ? [] : null;

  // Every character in document order with the element that styles it.
  type Ch = { ch: string; owner: Element; fresh: boolean };
  let chars: Ch[] = [];
  const visit = (node: Element, owner: Element) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) for (const ch of child.textContent ?? "") chars.push({ ch, owner, fresh: false });
      else if (child.nodeType === 1 && (child as Element).tagName.toLowerCase() === "tspan") visit(child as Element, child as Element);
    }
  };
  visit(el, el);

  // The browser addresses characters after SVG whitespace handling: without
  // xml:space="preserve" (white-space: pre), newlines go, tabs become spaces,
  // runs of spaces collapse and the ends are trimmed (Illustrator indents
  // its spans, so this is the common case, not an edge case).
  const ws = window.getComputedStyle(el).whiteSpace;
  if (!/^(pre|pre-wrap|break-spaces)$/.test(ws)) {
    const kept: Ch[] = [];
    for (const c of chars) {
      if (c.ch === "\n" || c.ch === "\r") continue;
      const ch = c.ch === "\t" ? " " : c.ch;
      if (ch === " " && (kept.length === 0 || kept[kept.length - 1].ch === " ")) continue;
      kept.push({ ...c, ch });
    }
    while (kept.length && kept[kept.length - 1].ch === " ") kept.pop();
    chars = kept;
  }
  if (chars.length !== count) return null; // indices would not line up

  // Where a new run starts: at every character that has an explicit position
  // (x / y / dx / dy, also lists of one value per letter, which Illustrator
  // writes instead of spans), and where the style changes.
  const listLen = (e: Element) => Math.max(0, ...["x", "y", "dx", "dy"].map((a) => (e.getAttribute(a) ?? "").trim().split(/[\s,]+/).filter(Boolean).length));
  const consumed = new Map<Element, number>();
  const key = (e: Element) => {
    const cs = window.getComputedStyle(e);
    return [cs.fontFamily, cs.fontSize, cs.fontWeight, cs.fontStyle, cs.fill, cs.letterSpacing].join("|");
  };
  chars.forEach((c, i) => {
    let fresh = i === 0;
    for (let a: Element | null = c.owner; a; a = a === el ? null : a.parentElement) {
      const n = consumed.get(a) ?? 0;
      if ((a !== el || i > 0) && n < listLen(a)) fresh = true;
      consumed.set(a, n + 1);
    }
    if (i > 0 && c.owner !== chars[i - 1].owner && key(c.owner) !== key(chars[i - 1].owner)) fresh = true;
    c.fresh = fresh;
  });
  const raw = chars.map((c) => c.ch).join("");

  const runs: { start: number; end: number; owner: Element }[] = [];
  chars.forEach((c, i) => {
    if (c.fresh || !runs.length) runs.push({ start: i, end: i + 1, owner: c.owner });
    else runs[runs.length - 1].end = i + 1;
  });

  const nodes: Node[] = [];
  for (const run of runs) {
    let a = run.start;
    let b = run.end - 1;
    while (a <= b && /\s/.test(raw[a])) a++;
    while (b >= a && /\s/.test(raw[b])) b--;
    if (a > b) continue;
    const text = raw.slice(a, b + 1);
    let x0: number, y0: number, width: number;
    try {
      const p = el.getStartPositionOfChar(a);
      const last = el.getExtentOfChar(b);
      x0 = p.x;
      y0 = p.y;
      width = Math.max(1, last.x + last.width - p.x);
    } catch {
      return null;
    }
    const cs = window.getComputedStyle(run.owner);
    const fontSize = parseFloat(cs.fontSize) || 16;
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const italic = /italic|oblique/i.test(cs.fontStyle);
    const letterSpacing = parseFloat(cs.letterSpacing) || 0; // "normal" -> 0
    const stretch = parseFloat(cs.fontStretch); // "112.5%" (semi-expanded) -> 112.5
    const wdth = Number.isFinite(stretch) && stretch !== 100 ? stretch : undefined;
    const fillRaw = toRgb ? toRgb(cs.fill) : cs.fill;
    const c = rgbaOf(fillRaw) ?? { r: 0, g: 0, b: 0, a: 1 };
    const opacity = (parseFloat(cs.fillOpacity) || 1) * (parseFloat(cs.opacity) || 1);
    const fontStyle = `${weight >= 600 ? "Bold" : "Regular"}${italic ? " Italic" : ""}`.replace("Regular Italic", "Italic");
    nodes.push(createNode("text", {
      id: idGen(),
      name: text.slice(0, 24),
      // Line height 1: the engine draws the baseline one line below the top.
      transform: { x: x0, y: y0 - fontSize, scaleX: 1, scaleY: 1, rotation: 0 },
      size: { width, height: fontSize * 1.25 },
      box: { mode: "autoWidth", width, height: fontSize * 1.25, autoFit: { enabled: false, min: 8, max: 512 }, verticalAlign: "top" },
      content: [{
        runs: [{ text, style: { fontFamily: resolveFontFamily(cs.fontFamily), fontStyle, fontSize, lineHeight: 1, axes: { wght: weight, ...(wdth ? { wdth } : {}) }, ...(letterSpacing ? { letterSpacing } : {}), fill: { type: "solid", color: { srgb: { ...c, a: c.a * opacity } } } } }],
        style: { align: "left", direction: "auto" },
      }],
    } as Partial<Node>));
  }
  return nodes;
}

// --- clipped fills -----------------------------------------------------------
// Design tools that outline text for export (Affinity, for one) often write
// each word as a filled rectangle clipped by the letter shapes:
//   <g clip-path="url(#c)"><rect .../></g>  with  <clipPath id="c"><path d="letters"/></clipPath>
// Scene nodes carry no clip paths, so the rectangle would come through as a
// solid bar. When the group paints exactly one shape that covers the whole
// clip, the result is simply the clip's shapes in that shape's fill.

/** Nodes for a clipped group of that form, or null when it is not one. */
function clippedFillNodes(
  group: Element,
  root: SVGSVGElement,
  idGen: () => string,
  toRgb: ((v: string) => string) | null,
  gradients: ReturnType<typeof parseGradients>,
): Node[] | null {
  const ref = /url\(\s*["']?#([^"')\s]+)["']?\s*\)/.exec(group.getAttribute("clip-path") ?? window.getComputedStyle(group).clipPath ?? "");
  if (!ref) return null;
  const esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(ref[1]) : ref[1].replace(/["\\]/g, "\\$&");
  const clip = root.querySelector(`clipPath[id="${esc}"]`);
  if (!clip || (clip.getAttribute("clipPathUnits") ?? "userSpaceOnUse") !== "userSpaceOnUse") return null;
  const painted = Array.from(group.children).filter((c) => !["defs", "clippath", "title", "desc", "metadata"].includes(c.tagName.toLowerCase()));
  if (painted.length !== 1 || !["rect", "path", "circle", "ellipse", "polygon"].includes(painted[0].tagName.toLowerCase())) return null;
  const shape = painted[0];
  const shapes = Array.from(clip.children).filter((c) => LEAF.has(c.tagName.toLowerCase()) && c.tagName.toLowerCase() !== "text" && c.tagName.toLowerCase() !== "image");
  if (!shapes.length) return null;
  // Compared in the group's user space; transforms on either side would need
  // the full matrix math, and exporters do not write them for this pattern.
  if (shape.getAttribute("transform") || clip.getAttribute("transform") || shapes.some((c) => c.getAttribute("transform"))) return null;

  // Each clip shape, painted with the clipped shape's fill. Taken from the
  // computed style, else from the SVG's own style/attribute: nothing here may
  // depend on the browser measuring or styling the mounted copy, so the result
  // is the same on every machine (an environment that measured or styled it
  // differently used to send these logos down the fallback, as bare bars).
  const own = (el: Element, prop: string): string | null => {
    const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i").exec(el.getAttribute("style") ?? "");
    return (m ? m[1] : el.getAttribute(prop))?.trim() || null;
  };
  const cs = window.getComputedStyle(shape);
  const computed = (cs.fill || "").trim();
  const rawFill = computed && computed !== "none" && !computed.startsWith("url(") ? computed : own(shape, "fill") ?? "#000000";
  const fill = toRgb ? toRgb(rawFill) : rawFill;
  const fillOpacity = own(shape, "fill-opacity") ?? (cs.fillOpacity || "1");
  const out: Node[] = [];
  for (const c of shapes) {
    const copy = c.cloneNode(true) as Element;
    const rule = c.getAttribute("clip-rule") ?? own(c, "clip-rule") ?? "nonzero";
    copy.setAttribute("style", `fill:${fill};fill-rule:${rule};fill-opacity:${fillOpacity};stroke:none`);
    out.push(...svgToNodes(copy.outerHTML, idGen, { fallbackFill: true, gradients }).nodes);
  }
  // The clip shapes stand in for "the shape, cut to the clip". That is exact
  // when the shape covers the clip, which is what exporters write for outlined
  // text; were it smaller, the letters would show uncut, still far closer to
  // the drawing than the bare shape.
  if (!out.length) return null;
  return out;
}

/** Load every font an SVG's text asks for, so the browser lays it out (and the
 *  converter measures it) in the real face instead of a fallback. Resolves once
 *  each family has loaded or turned out to be unavailable, or after `timeoutMs`.
 *  Call before converting an SVG that may contain text. */
export async function prepareSvgFonts(svgText: string, timeoutMs = 5000): Promise<void> {
  if (typeof document === "undefined" || !/<text[\s>]/i.test(svgText)) return;
  const lists = new Set<string>();
  // CSS declarations (style attributes, <style>) run to the next ; or quote;
  // the presentation attribute is one quoted value.
  for (const m of svgText.matchAll(/font-family\s*:\s*([^;"<>{}]+)/gi)) lists.add(m[1].replace(/&quot;|&apos;/g, "'").trim());
  for (const m of svgText.matchAll(/font-family\s*=\s*("[^"]*"|'[^']*')/gi)) lists.add(m[1].slice(1, -1));
  const weights = new Set<string>(["400"]);
  for (const m of svgText.matchAll(/font-weight\s*[:=]\s*["']?(\d{3}|bold|normal)/gi)) weights.add(m[1] === "bold" ? "700" : m[1] === "normal" ? "400" : m[1]);
  const families = [...new Set([...lists].map(resolveFontFamily))].filter((f) => f !== "system");
  if (!families.length) return;
  for (const f of families) fonts.ensure(f);
  const settled = () => families.every((f) => fonts.isSettled(f));
  await new Promise<void>((resolve) => {
    if (settled()) return resolve();
    const timer = setTimeout(done, timeoutMs);
    const off = fonts.onChange(() => { if (settled()) done(); });
    function done() { clearTimeout(timer); off(); resolve(); }
  });
  // Faces are registered now; make sure the weights in use are decoded too.
  await Promise.race([
    Promise.all(families.flatMap((f) => [...weights].map((w) => document.fonts.load(`${w} 16px "${f}"`).catch(() => [])))),
    new Promise((r) => setTimeout(r, timeoutMs)),
  ]);
}

/** Convert an SVG string to scene nodes with group transforms resolved. */
export function flattenSvgToNodes(svgText: string, opts: { fallbackFill?: boolean } = {}): FlattenResult {
  const idGen = () => `svg-${crypto.randomUUID()}`;
  const fallbackFill = opts.fallbackFill ?? false;
  // Gradient defs live on the root; parse once and inject into every per-leaf
  // convert (each leaf's outerHTML does not include <defs>).
  const gradients = parseGradients(svgText);
  // No DOM (SSR / tests without jsdom): fall back to the flat parser.
  if (typeof DOMParser === "undefined" || typeof document === "undefined" || !document.body) {
    const r = svgToNodes(svgText, idGen, { fallbackFill, gradients });
    return { nodes: r.nodes, assets: r.assets, approximated: r.approximated };
  }
  const nodes: Node[] = [];
  const assets: { assetId: string; url: string }[] = [];
  let approximated = false;

  // Mount the SVG offscreen so the browser resolves CSS (<style> classes,
  // currentColor, inherited fills) into computed styles we can read per leaf.
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:-99999px;top:0;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none";
  host.innerHTML = svgText;
  const root = host.querySelector("svg");
  if (!root) {
    const r = svgToNodes(svgText, idGen, { fallbackFill, gradients });
    return { nodes: r.nodes, assets: r.assets, approximated: r.approximated };
  }
  {
    const vb = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      root.setAttribute("width", String(vb[2]));
      root.setAttribute("height", String(vb[3]));
    }
  }
  document.body.appendChild(host);
  const toRgb = makeColorNormalizer();
  // Lay text out in the family the text nodes will use: a list the browser
  // cannot match ("'TrajanPro-Bold'" alone) would otherwise be measured in a
  // fallback face while the node draws the real one.
  for (const t of Array.from(root.querySelectorAll("text, tspan"))) {
    // The engine's own stack, fallbacks included: an unavailable font is then
    // measured in the same fallback face the engine will draw.
    const fam = resolveFontFamily(window.getComputedStyle(t).fontFamily);
    (t as SVGElement).style.fontFamily = fontFamilyStack(fam === "system" ? undefined : fam);
  }

  // `co` is the accumulated container opacity. CSS `opacity` does not inherit, so
  // a `<g opacity="0.5">` must be folded onto its leaves manually (each leaf's
  // own computed opacity is group-independent).
  const walk = (el: Element, ctm: Mat2D, co: number) => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase();
      const m = multiply(ctm, parseTransform(child.getAttribute("transform")));
      if (CONTAINER.has(tag)) {
        const go = parseFloat(window.getComputedStyle(child).opacity);
        if (child.hasAttribute("clip-path")) {
          const filled = clippedFillNodes(child, root as SVGSVGElement, idGen, toRgb, gradients);
          if (filled) {
            const gco = co * (Number.isFinite(go) ? go : 1);
            for (const n of filled) {
              n.transform = decompose(multiply(m, fromTransform(n.transform)));
              if (gco < 1) n.opacity = Math.max(0, Math.min(1, (n.opacity ?? 1) * gco));
              nodes.push(n);
            }
            continue;
          }
        }
        walk(child, m, co * (Number.isFinite(go) ? go : 1));
        continue;
      }
      if (!LEAF.has(tag)) continue; // skip defs/clipPath/gradients/etc.
      if (tag === "text") {
        const laid = textNodesFromLayout(child as SVGTextElement, idGen, toRgb);
        if (laid) {
          for (const n of laid) {
            n.transform = decompose(multiply(m, fromTransform(n.transform)));
            if (co < 1) n.opacity = Math.max(0, Math.min(1, (n.opacity ?? 1) * co));
            nodes.push(n);
          }
          continue;
        }
      }
      inlineComputedPaint(child, toRgb);
      const r = svgToNodes(child.outerHTML, idGen, { fallbackFill, gradients });
      approximated = approximated || r.approximated;
      assets.push(...r.assets);
      for (const n of r.nodes) {
        n.transform = decompose(multiply(m, fromTransform(n.transform)));
        if (co < 1) n.opacity = Math.max(0, Math.min(1, (n.opacity ?? 1) * co));
        nodes.push(n);
      }
    }
  };
  try {
    walk(root, identity(), 1);
  } finally {
    host.remove();
  }
  return { nodes, assets, approximated };
}
