// Designs the export check runs through every format. Each covers what has
// gone wrong in exports before, or what a print shop relies on. Built in
// code (no binary fixtures): images are drawn in the browser, the one font is
// the repository's own Liberation Sans, embedded as a data URL, so nothing
// needs the network.
//
// `ink` lists regions (page px) that must show something in every export:
// an absolute check that does not depend on the engine drawing the
// reference right.

export interface Fixture {
  name: string;
  doc: Record<string, unknown>;
  /** Regions of the page that must not be blank in any export. */
  ink: { x: number; y: number; w: number; h: number; what: string }[];
}

const MM = 96 / 25.4;
const col = (r: number, g: number, b: number, a = 1) => ({ srgb: { r, g, b, a } });
const T = (x: number, y: number, rotation = 0, scale = 1) => ({ x, y, scaleX: scale, scaleY: scale, rotation });
const solid = (c: ReturnType<typeof col>) => [{ type: "solid", color: c }];
/** A text box (fixed size) with one paragraph of one run. */
const textNode = (id: string, x: number, y: number, w: number, h: number, text: string, size: number, color: ReturnType<typeof col>, fontStyle = "Regular") => ({
  id, type: "text", transform: T(x, y), size: { width: w, height: h }, opacity: 1, blendMode: "normal",
  box: { mode: "fixed", width: w, height: h, autoFit: { enabled: false, min: 8, max: 512 }, verticalAlign: "top" },
  content: [{ style: { align: "left", direction: "auto" }, runs: [{ text, style: { fontFamily: "Export Check Sans", fontStyle, fontSize: size, fill: { type: "solid", color } } }] }],
});
const base = (id: string, title: string, pages: unknown[], extra: Record<string, unknown> = {}) => ({
  format: "hycanvas.design", schemaVersion: 28, id, title, unit: "px", dpi: 96, assets: [], fonts: [], meta: {}, pages, ...extra,
});

/** Builds the fixtures; `font` is the embedded font's data URL, `photo` a
 *  PNG data URL drawn by the harness. */
export function fixtures(font: string, photo: string, photoAlpha: string): Fixture[] {
  const shapes = {
    name: "shapes",
    doc: base("fx-shapes", "Shapes", [{
      id: "p", width: 600, height: 400,
      background: { type: "solid", color: col(0.96, 0.95, 0.9) },
      children: [
        { id: "r", type: "shape", shape: "rect", transform: T(40, 40), size: { width: 200, height: 120 }, opacity: 1, blendMode: "normal", fills: solid(col(0.85, 0.15, 0.1)) },
        { id: "e", type: "shape", shape: "ellipse", transform: T(300, 60), size: { width: 160, height: 160 }, opacity: 1, blendMode: "normal", fills: solid(col(0.1, 0.55, 0.3)) },
        { id: "rot", type: "shape", shape: "rect", transform: T(120, 220, 30), size: { width: 140, height: 60 }, opacity: 1, blendMode: "normal", fills: solid(col(0.15, 0.3, 0.8)) },
        { id: "half", type: "shape", shape: "rect", transform: T(380, 200), size: { width: 180, height: 150 }, opacity: 0.35, blendMode: "normal", fills: solid(col(0, 0, 0)) },
        { id: "stroke", type: "shape", shape: "rect", transform: T(40, 300), size: { width: 220, height: 70 }, opacity: 1, blendMode: "normal", fills: [], stroke: { width: 6, fill: { type: "solid", color: col(0.5, 0.2, 0.6) }, align: "center", cap: "butt", join: "miter", dash: [12, 6] } },
        { id: "grad", type: "shape", shape: "rect", transform: T(480, 20), size: { width: 100, height: 160 }, opacity: 1, blendMode: "normal", fills: [{ type: "gradient", gradient: "linear", angle: 90, stops: [{ position: 0, color: col(1, 0.6, 0.1) }, { position: 1, color: col(0.4, 0.1, 0.6) }] }] },
      ],
    }]),
    ink: [
      { x: 60, y: 60, w: 40, h: 40, what: "red rectangle" },
      { x: 360, y: 120, w: 40, h: 40, what: "green circle" },
      { x: 500, y: 60, w: 60, h: 80, what: "gradient" },
    ],
  };

  // Paths that keep the drawing's coordinates, outside their own size (as
  // SVG logo imports do): the logo's middle word vanished when culling used
  // the size box only.
  const offbox = {
    name: "offbox-path",
    doc: base("fx-offbox", "Off-box paths", [{
      id: "p", width: 600, height: 600,
      background: { type: "solid", color: col(1, 1, 1) },
      children: [{
        id: "logo", type: "group", clip: true, transform: T(50, 30, 0, 0.25), size: { width: 2000, height: 2200 }, opacity: 1, blendMode: "normal",
        children: [
          { id: "top", type: "path", closed: true, transform: T(-1000, -500), size: { width: 1800, height: 900 }, opacity: 1, blendMode: "normal", fills: solid(col(0.1, 0.38, 0.25)),
            segments: [{ x: 1100, y: 600 }, { x: 2800, y: 600 }, { x: 2800, y: 1300 }, { x: 1100, y: 1300 }] },
          { id: "middle", type: "path", closed: true, transform: T(-1000, -500), size: { width: 1800, height: 250 }, opacity: 1, blendMode: "normal", fills: solid(col(0.45, 0.62, 0.55)),
            segments: [{ x: 1100, y: 1500 }, { x: 2800, y: 1500 }, { x: 2800, y: 1800 }, { x: 1100, y: 1800 }] },
          { id: "bottom", type: "path", closed: true, transform: T(-1000, -500), size: { width: 1800, height: 300 }, opacity: 1, blendMode: "normal", fills: solid(col(0.1, 0.38, 0.25)),
            segments: [{ x: 1100, y: 2000 }, { x: 2800, y: 2000 }, { x: 2800, y: 2400 }, { x: 1100, y: 2400 }] },
        ],
      }],
    }]),
    // The middle path at page coordinates: 50 + (1100..2800 - 1000) * 0.25,
    // 30 + (1500..1800 - 500) * 0.25.
    ink: [{ x: 100, y: 290, w: 300, h: 50, what: "the middle path drawn outside its size" }],
  };

  const text = {
    name: "text",
    doc: base("fx-text", "Text", [{
      id: "p", width: 600, height: 300,
      background: { type: "solid", color: col(1, 1, 1) },
      children: [
        textNode("t1", 30, 30, 540, 80, "Hormoncreme D4 Export", 48, col(0.1, 0.1, 0.1)),
        textNode("t2", 30, 150, 540, 120, "Für Kinder unzugänglich aufbewahren. Bei 15 bis 25 °C.", 24, col(0.1, 0.35, 0.6)),
      ],
    }], { fonts: [{ id: "f1", family: "Export Check Sans", source: "upload", url: font }] }),
    ink: [{ x: 30, y: 40, w: 300, h: 40, what: "headline text" }],
  };

  // An uploaded font with one face, used bold and italic: the browser
  // synthesizes those faces, and every export has to look the same.
  const synth = {
    name: "synthetic-face",
    doc: base("fx-synth", "Synthesized faces", [{
      id: "p", width: 600, height: 360,
      background: { type: "solid", color: col(1, 1, 1) },
      children: [
        textNode("bold", 20, 20, 560, 90, "Bold Hormoncreme", 56, col(0.1, 0.1, 0.1), "Bold"),
        textNode("italic", 20, 130, 560, 90, "Italic Hormoncreme", 56, col(0.1, 0.35, 0.6), "Italic"),
        textNode("both", 20, 240, 560, 90, "Beides Hormoncreme", 56, col(0.55, 0.1, 0.15), "Bold Italic"),
      ],
    }], { fonts: [{ id: "f1", family: "Export Check Sans", source: "upload", url: font }] }),
    ink: [{ x: 30, y: 40, w: 300, h: 40, what: "bold text" }, { x: 30, y: 150, w: 300, h: 40, what: "italic text" }],
  };

  const image = {
    name: "image",
    doc: base("fx-image", "Image", [{
      id: "p", width: 600, height: 400,
      background: { type: "solid", color: col(0.9, 0.93, 0.97) },
      children: [
        { id: "img", type: "image", transform: T(30, 30), size: { width: 300, height: 200 }, opacity: 1, blendMode: "normal", source: { assetId: "photo", naturalWidth: 400, naturalHeight: 300 }, fit: "cover" },
        { id: "img2", type: "image", transform: T(360, 120), size: { width: 200, height: 200 }, opacity: 1, blendMode: "normal", source: { assetId: "alpha", naturalWidth: 200, naturalHeight: 200 }, fit: "contain" },
      ],
    }], { assets: [{ id: "photo", kind: "image", mime: "image/png", url: photo }, { id: "alpha", kind: "image", mime: "image/png", url: photoAlpha }] }),
    ink: [{ x: 60, y: 60, w: 200, h: 120, what: "placed photo" }, { x: 420, y: 180, w: 60, h: 60, what: "transparent image" }],
  };

  const clip = {
    name: "group-clip",
    doc: base("fx-clip", "Clipped group", [{
      id: "p", width: 500, height: 400,
      background: { type: "solid", color: col(1, 1, 1) },
      children: [{
        id: "g", type: "group", clip: true, transform: T(100, 80, 10), size: { width: 300, height: 200 }, opacity: 1, blendMode: "normal",
        children: [
          { id: "big", type: "shape", shape: "rect", transform: T(-50, -50), size: { width: 400, height: 300 }, opacity: 1, blendMode: "normal", fills: solid(col(0.2, 0.5, 0.75)) },
          { id: "dot", type: "shape", shape: "ellipse", transform: T(100, 50), size: { width: 100, height: 100 }, opacity: 1, blendMode: "normal", fills: solid(col(1, 1, 1)) },
        ],
      }],
    }]),
    ink: [{ x: 150, y: 130, w: 60, h: 40, what: "clipped group content" }],
  };

  // A 50 x 100 mm label with 1.5 mm bleed and crop marks: the print-shop
  // case. Artwork runs past the page edge into the bleed and beyond.
  const label = {
    name: "label",
    doc: base("fx-label", "Label", [{
      id: "p", width: 50 * MM, height: 100 * MM, bleed: 1.5 * MM, printMarks: { crop: true, offset: 1.5 * MM, length: 3 * MM },
      background: { type: "solid", color: col(0.376, 0.604, 0.773) },
      children: [
        // Runs 20 px past both edges, beyond the bleed: in a dark colour, so
        // anything of it outside the bleed shows on the paper.
        { id: "band", type: "shape", shape: "rect", transform: T(-20, 40), size: { width: 50 * MM + 40, height: 60 }, opacity: 1, blendMode: "normal", fills: solid(col(0.55, 0.1, 0.15)) },
        { id: "plant", type: "shape", shape: "ellipse", transform: T(40, 160), size: { width: 100, height: 160 }, opacity: 0.35, blendMode: "normal", fills: solid(col(1, 1, 1)) },
        { id: "black", type: "shape", shape: "rect", transform: T(20, 330), size: { width: 140, height: 12 }, opacity: 1, blendMode: "normal", fills: solid(col(0, 0, 0)) },
      ],
    }]),
    ink: [{ x: 20, y: 335, w: 100, h: 4, what: "black bar" }],
  };

  return [shapes, offbox, text, synth, image, clip, label];
}
