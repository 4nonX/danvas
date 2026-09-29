// Generate the presentation kits: six complete slide systems, sixteen layouts
// each, written as template specs (scripts/templates/kit-*.json) for
// scripts/build-templates.mjs to compile into the embedded seed.
//
//   node scripts/gen-deck-kits.mjs            # write the six kit specs
//   node scripts/build-templates.mjs          # then compile the seed
//
// A kit is one visual system (its faces, its palette on paper and on a deep
// ground, its corner radius, its ornament, its drawings) applied to the same
// catalog of layouts: cover, agenda, section, statement, text with a picture,
// two columns, three cards, a figure row, a chart, a timeline, a process, a
// comparison table, a team, a quote, pricing, and a closing. The layouts are
// hand-set here, slot by slot, the way the single-page design templates are,
// and they borrow what makes those templates read as finished: a gradient
// ground on the impact pages, a glowing halo behind a full-colour drawing
// from the bundled packs, sparkle dots, an accent face for one kicker line,
// tinted cards with strokes, a pill call to action, and no empty grey slot
// anywhere. A picture slot is a shape with a drawing on it: drop a photo on
// the shape and the editor fills it; delete the drawing if the photo should
// stand alone.
//
// The specs are generated rather than hand-written because sixteen slides
// times six kits is a thousand-odd nodes, and one grid change must land on
// all of them at once. The generated JSON is committed: the compiler's
// contract that specs are the source of truth is unchanged, and a kit can
// still be edited by hand after the fact.

import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "scripts", "templates");

const W = 1920;
const H = 1080;
const M = 96;
const CW = W - 2 * M;
const PAGES = 16;

// --- kits --------------------------------------------------------------------

/** Every colour a kit needs on each of its two grounds. `paper` pages carry
 *  the reading slides; `deep` pages carry the cover, sections, the quote and
 *  the closing, on a gradient between `bg` and `bg2`. A dark kit's paper is
 *  dark too, one shade lighter than deep. `art` names the drawings from the
 *  bundled packs each layout places; `peeps` the portraits for the team. */
const KITS = [
  {
    id: "kit-atlas",
    title: "Atlas Corporate Kit",
    tags: ["kit", "corporate", "annual report", "investor", "serif", "navy", "gold"],
    styleTags: ["professional", "classic", "elegant"],
    rank: 10,
    company: "Halcyon Capital",
    deck: "Annual review FY2026",
    kicker: "The year in review",
    farewell: "Until next year",
    display: "Playfair Display", dw: 700, body: "Source Sans 3", bw: 400, mono: null,
    accentFace: "Cormorant Garamond", accentWeight: 600, accentSize: 40,
    paper: { bg: "#F8F5EE", ink: "#14213D", muted: "#5A627A", line: "#DCD6C8", panel: "#EFEBE1", panel2: "#E4DED0", accent: "#C9992A", accent2: "#3E6FCC" },
    deep: { bg: "#182752", bg2: "#0C1330", ink: "#F8F5EE", muted: "#B4BCD0", line: "#2E3E6A", panel: "#21335F", panel2: "#2A3F73", accent: "#E8B94A", accent2: "#7FA6E8" },
    radius: 8,
    ornament: "rules",
    art: { cover: "la-success-illustration", section: "la-building", picture: "la-woman-working-1", closing: "la-working-2" },
    peeps: ["op-peep-84", "op-peep-86", "op-peep-105", "op-peep-53", "op-peep-23"],
    scale: { cover: 116, title: 62, section: 236, statement: 80, numeral: 104, quote: 54 },
  },
  {
    id: "kit-vanta",
    title: "Vanta Tech Kit",
    tags: ["kit", "tech", "product", "engineering", "dark", "mono", "gradient"],
    styleTags: ["modern", "bold", "dark"],
    rank: 11,
    company: "Nova Systems",
    deck: "Platform review Q3",
    kicker: "// platform review, q3",
    farewell: "// end of transmission",
    display: "Space Grotesk", dw: 700, body: "IBM Plex Sans", bw: 400, mono: "IBM Plex Mono",
    accentFace: "IBM Plex Mono", accentWeight: 500, accentSize: 30,
    paper: { bg: "#0F1526", bg2: "#0A0E1B", ink: "#F1F5F9", muted: "#93A0B8", line: "#243049", panel: "#161E33", panel2: "#1E2842", accent: "#C8F542", accent2: "#8F7BFF" },
    deep: { bg: "#0A0F1F", bg2: "#04060E", ink: "#F1F5F9", muted: "#93A0B8", line: "#1E2840", panel: "#121A2E", panel2: "#1A2440", accent: "#C8F542", accent2: "#8F7BFF" },
    radius: 14,
    ornament: "glow",
    art: { cover: "la-ai-robot-3", section: "il-111-coding", picture: "la-woman-working-2", closing: "la-free-svg-illustrations-robots" },
    peeps: ["op-peep-72", "op-peep-9", "op-peep-56", "op-peep-41", "op-peep-55"],
    scale: { cover: 114, title: 60, section: 220, statement: 76, numeral: 100, quote: 50 },
  },
  {
    id: "kit-folio",
    title: "Folio Editorial Kit",
    tags: ["kit", "editorial", "strategy", "serif", "cream", "magazine", "illustrated"],
    styleTags: ["editorial", "elegant", "warm"],
    rank: 12,
    company: "Meridian Studio",
    deck: "Brand strategy 2027",
    kicker: "Notes from the studio",
    farewell: "Thanks for reading",
    display: "Fraunces", dw: 600, body: "Inter", bw: 400, mono: null,
    accentFace: "Caveat", accentWeight: 600, accentSize: 44,
    paper: { bg: "#F5EFE4", ink: "#1C1A17", muted: "#6B655C", line: "#DACFBE", panel: "#EDE4D4", panel2: "#E3D8C3", accent: "#E0492B", accent2: "#2C6B58", sun: "#F4C15D" },
    deep: { bg: "#221E1A", bg2: "#100E0C", ink: "#F5EFE4", muted: "#B0A798", line: "#3E3831", panel: "#2C2723", panel2: "#38322C", accent: "#F26A48", accent2: "#8CC7AE", sun: "#F4C15D" },
    radius: 0,
    ornament: "hairlines",
    art: { cover: "la-guy-with-glasses", section: "il-day73-writing-tool", picture: "la-doodle", closing: "la-coffee" },
    peeps: ["op-peep-58", "op-peep-47", "op-peep-73", "op-peep-84", "op-peep-86"],
    scale: { cover: 120, title: 66, section: 260, statement: 84, numeral: 108, quote: 56 },
  },
  {
    id: "kit-pulse",
    title: "Pulse Startup Kit",
    tags: ["kit", "startup", "pitch", "launch", "bold", "coral", "cobalt"],
    styleTags: ["bold", "modern", "playful"],
    rank: 13,
    company: "Loop",
    deck: "Seed round 2026",
    kicker: "Seed round",
    farewell: "Let's build it",
    display: "Sora", dw: 800, body: "Manrope", bw: 500, mono: null,
    accentFace: "Bricolage Grotesque", accentWeight: 800, accentSize: 36,
    paper: { bg: "#FFFFFF", ink: "#0B0B14", muted: "#5B5B70", line: "#E4E4EE", panel: "#F3F3F9", panel2: "#E9E9F4", accent: "#FF4D2E", accent2: "#2B2BFF", lime: "#B9F542" },
    deep: { bg: "#2B2BFF", bg2: "#6A2BFF", ink: "#FFFFFF", muted: "#CFCFFF", line: "#5050FF", panel: "#3A3AFF", panel2: "#4A48FF", accent: "#FF4D2E", accent2: "#B9F542", accentInk: "#B9F542", lime: "#B9F542" },
    radius: 24,
    ornament: "blocks",
    art: { cover: "la-free-svg-illustration-rocket", section: "il-day20-rocket", picture: "la-hero-image-2", closing: "la-scooter" },
    peeps: ["op-peep-105", "op-peep-53", "op-peep-23", "op-peep-72", "op-peep-9"],
    scale: { cover: 122, title: 68, section: 250, statement: 82, numeral: 112, quote: 54 },
  },
  {
    id: "kit-terra",
    title: "Terra Community Kit",
    tags: ["kit", "sustainability", "nonprofit", "community", "warm", "organic", "illustrated"],
    styleTags: ["warm", "friendly", "organic"],
    rank: 14,
    company: "Fernwood Collective",
    deck: "Impact report 2026",
    kicker: "Our year together",
    farewell: "See you out there",
    display: "Outfit", dw: 700, body: "Nunito Sans", bw: 400, mono: null,
    accentFace: "Caveat", accentWeight: 600, accentSize: 46,
    paper: { bg: "#F8F0E3", ink: "#2F2A25", muted: "#786C5F", line: "#DDD0BB", panel: "#EFE4D0", panel2: "#E5D8BF", accent: "#E0703F", accent2: "#5F8F5A", sun: "#F2C063" },
    deep: { bg: "#2F4A36", bg2: "#1D3124", ink: "#F8F0E3", muted: "#BBC9B4", line: "#456249", panel: "#3A5A40", panel2: "#466B4C", accent: "#F2905E", accent2: "#A9D2A0", sun: "#F2C063" },
    radius: 28,
    ornament: "blobs",
    art: { cover: "od-jumping", section: "il-day96-camping", picture: "la-house-illustrations", closing: "od-strolling" },
    peeps: ["op-peep-56", "op-peep-41", "op-peep-55", "op-peep-58", "op-peep-47"],
    scale: { cover: 118, title: 64, section: 240, statement: 80, numeral: 108, quote: 54 },
  },
  {
    id: "kit-slate",
    title: "Slate Minimal Kit",
    tags: ["kit", "agency", "portfolio", "proposal", "minimal", "swiss", "monochrome"],
    styleTags: ["minimal", "modern", "clean"],
    rank: 15,
    company: "Form & Function",
    deck: "Studio proposal",
    kicker: "Studio proposal, 2026",
    farewell: "Let's make something",
    display: "Archivo", dw: 700, body: "Archivo", bw: 400, mono: null,
    accentFace: "Space Mono", accentWeight: 400, accentSize: 26,
    paper: { bg: "#FFFFFF", ink: "#111111", muted: "#6B6B6B", line: "#E2E2E2", panel: "#F3F3F3", panel2: "#E9E9E9", accent: "#2F6BFF", accent2: "#111111" },
    deep: { bg: "#181818", bg2: "#070707", ink: "#FFFFFF", muted: "#A0A0A0", line: "#2E2E2E", panel: "#1F1F1F", panel2: "#2A2A2A", accent: "#4D82FF", accent2: "#FFFFFF" },
    radius: 0,
    ornament: "crosshairs",
    art: { cover: "la-working-1", section: "il-day10-canvas-stand", picture: "la-desk-illustration-2", closing: "la-flat-character-illustrations" },
    peeps: ["op-peep-73", "op-peep-84", "op-peep-86", "op-peep-105", "op-peep-53"],
    scale: { cover: 118, title: 60, section: 236, statement: 78, numeral: 104, quote: 52 },
  },
];

// --- primitives --------------------------------------------------------------

const text = (x, y, w, h, t, o = {}) => ({ kind: "text", x, y, w, h, text: t, ...o });
const rect = (x, y, w, h, fill, o = {}) => ({ kind: "rect", x, y, w, h, fill, ...o });
const ellipse = (x, y, w, h, fill, o = {}) => ({ kind: "ellipse", x, y, w, h, fill, ...o });
const button = (x, y, w, h, label, o = {}) => ({ kind: "button", x, y, w, h, label, ...o });
const icon = (name, x, y, size, color) => ({ kind: "icon", icon: name, x, y, w: size, h: size, color });
/** A picture slot: a shape the editor fills when a photo is dropped on it. */
const photo = (x, y, w, h, fill, o = {}) =>
  o.shape === "ellipse" ? { kind: "ellipse", name: "Photo", x, y, w, h, fill } : { kind: "rect", name: "Photo", x, y, w, h, fill, ...(o.radius ? { radius: o.radius } : {}) };
/** A drawing from the bundled packs, fitted and centered in the box. */
const art = (asset, x, y, w, h, o = {}) => ({ asset, x, y, w, h, ...(asset.startsWith("il-") ? { cleanCard: true } : {}), ...o });

function mixHex(a, b, t) {
  const pa = a.replace("#", ""), pb = b.replace("#", "");
  const ch = (i) => Math.round(parseInt(pa.slice(i, i + 2), 16) * (1 - t) + parseInt(pb.slice(i, i + 2), 16) * t);
  return "#" + [0, 2, 4].map((i) => ch(i).toString(16).padStart(2, "0")).join("");
}

/** Relative luminance below a mid grey. */
function isDark(hex) {
  const h = hex.replace("#", "");
  const c = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
  return 0.2126 * c(0) + 0.7152 * c(2) + 0.0722 * c(4) < 0.4;
}

/** The ink that reads on a fill: the kit's light ink on a dark fill, its
 *  dark ink on a light one. A dark kit's paper ink is light too, so the
 *  dark ink falls back to its deepest ground. */
const inkOn = (K, fill) => {
  const light = isDark(K.deep.ink) ? K.paper.ink : K.deep.ink;
  const dark = isDark(K.paper.ink) ? K.paper.ink : K.deep.bg2;
  return isDark(fill) ? light : dark;
};

/** Type roles for a kit on a ground. Each returns the text options only; the
 *  caller supplies the box. */
function type(K, g) {
  return {
    display: (size, o = {}) => ({ family: K.display, size, weight: K.dw, color: g.ink, lineHeight: 1.06, ...o }),
    body: (size, o = {}) => ({ family: K.body, size, weight: K.bw, color: g.muted, lineHeight: 1.4, ...o }),
    strong: (size, o = {}) => ({ family: K.body, size, weight: 600, color: g.ink, lineHeight: 1.3, ...o }),
    eyebrow: (o = {}) => ({ family: K.mono ?? K.body, size: 20, weight: 600, color: g.accentInk ?? g.accent, letterSpacing: 4, upper: true, lineHeight: 1.2, ...o }),
    meta: (o = {}) => ({ family: K.mono ?? K.body, size: 18, weight: 500, color: g.muted, lineHeight: 1.3, ...o }),
    numeral: (size, o = {}) => ({ family: K.display, size, weight: K.dw, color: g.accentInk ?? g.accent, lineHeight: 1, ...o }),
    /** The kicker line in the kit's accent face: the one voice that is
     *  neither the display nor the body. */
    kicker: (o = {}) => ({ family: K.accentFace, size: K.accentSize, weight: K.accentWeight, color: g.accentInk ?? g.accent, lineHeight: 1.2, ...o }),
  };
}

const pageNo = (i) => `${String(i + 1).padStart(2, "0")} / ${PAGES}`;

/** The deep pages' ground: a gradient from bg to bg2, darker toward the
 *  bottom right. */
const deepGround = (g) => ({ angle: 160, stops: [[g.bg, 0], [g.bg2, 1]] });

// --- ornaments ---------------------------------------------------------------

/** Two concentric discs of the accent behind a hero drawing, the way a flyer
 *  lights its subject. */
function halo(cx, cy, size, color) {
  return [
    ellipse(cx - size / 2, cy - size / 2, size, size, color, { opacity: 0.12 }),
    ellipse(cx - size * 0.4, cy - size * 0.4, size * 0.8, size * 0.8, color, { opacity: 0.16 }),
  ];
}

/** A scatter of small dots at varied opacity, deterministic per seed. */
function sparkles(color, seed, n = 7, box = { x: 0, y: 0, w: W, h: H }) {
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const out = [];
  for (let k = 0; k < n; k++) {
    const d = 4 + Math.round(rnd() * 5);
    out.push(ellipse(Math.round(box.x + rnd() * (box.w - d)), Math.round(box.y + rnd() * (box.h - d)), d, d, color, { opacity: 0.35 + Math.round(rnd() * 45) / 100 }));
  }
  return out;
}

/** Small rotated strips in the kit's second colours, the confetti a bold
 *  kit throws around its hero. */
function confetti(colors, seed, n = 6, box = { x: 0, y: 0, w: W, h: H }) {
  let s = seed * 7919 + 104729;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const out = [];
  for (let k = 0; k < n; k++) {
    const w = 22 + Math.round(rnd() * 26), h = 8 + Math.round(rnd() * 6);
    out.push(rect(Math.round(box.x + rnd() * (box.w - w)), Math.round(box.y + rnd() * (box.h - h)), w, h, colors[k % colors.length], { rotation: Math.round(-40 + rnd() * 80), radius: 3 }));
  }
  return out;
}

function crosshairs(color, opacity) {
  const out = [];
  for (const [cx, cy] of [[48, 48], [W - 48, 48], [48, H - 48], [W - 48, H - 48]]) {
    out.push(rect(cx - 12, cy - 1, 24, 2, color, { opacity }), rect(cx - 1, cy - 12, 2, 24, color, { opacity }));
  }
  return out;
}

/** The kit's signature marks on a deep page (cover, section, closing). */
function ornamentDeep(K, g, opts = {}) {
  switch (K.ornament) {
    case "rules":
      return [rect(40, 40, W - 80, H - 80, undefined, { stroke: g.accent, strokeWidth: 1.5, opacity: 0.7 }), ...sparkles(g.accent, 3, 8)];
    case "glow":
      return [
        ellipse(1380, -420, 1100, 1100, { angle: 135, stops: [[g.accent2, 0], [g.bg2, 1]], radial: true }, { opacity: 0.6, bleed: true }),
        ellipse(-380, 620, 900, 900, { angle: 135, stops: [[g.accent, 0], [g.bg2, 1]], radial: true }, { opacity: 0.26, bleed: true }),
        ...[320, 640, 960, 1280, 1600].map((x) => rect(x, 0, 1, H, g.ink, { opacity: 0.06 })),
        ...[270, 540, 810].map((y) => rect(0, y, W, 1, g.ink, { opacity: 0.06 })),
        ...sparkles(g.accent, 5, 6),
        ...sparkles(g.accent2, 6, 5),
      ];
    case "hairlines":
      return [
        ellipse(1560, -180, 520, 520, g.sun, { bleed: true, opacity: 0.9 }),
        rect(M, 64, CW, 2, g.ink), rect(M, H - 66, CW, 2, g.ink),
        ...(opts.mark ? [] : [rect(M, 84, 14, 14, g.accent)]),
      ];
    case "blocks":
      return [];
    case "blobs":
      return [
        ellipse(1480, -260, 760, 760, g.accent2, { opacity: 0.4, bleed: true }),
        ellipse(-200, 720, 560, 560, g.accent, { opacity: 0.35, bleed: true }),
        ellipse(1720, 720, 300, 300, g.sun, { opacity: 0.6, bleed: true }),
        ...sparkles(g.ink, 9, 7),
      ];
    case "crosshairs":
      return [
        ellipse(1180, -300, 1200, 1200, { angle: 135, stops: [[g.accent, 0], [g.bg2, 1]], radial: true }, { opacity: 0.35, bleed: true }),
        ...crosshairs(g.ink, 0.7),
      ];
    default:
      return [];
  }
}

/** The kit's quieter marks on a reading page. */
function ornamentPaper(K, g) {
  switch (K.ornament) {
    case "glow":
      return [
        ellipse(1500, -520, 1000, 1000, { angle: 135, stops: [[g.accent2, 0], [g.bg2, 1]], radial: true }, { opacity: 0.3, bleed: true }),
        ...[320, 640, 960, 1280, 1600].map((x) => rect(x, 0, 1, H, g.ink, { opacity: 0.045 })),
      ];
    case "hairlines":
      return [rect(M, 64, CW, 2, g.ink), ellipse(1770, -110, 220, 220, g.sun, { bleed: true })];
    case "crosshairs":
      return crosshairs(g.line, 1);
    case "blobs":
      return [ellipse(1700, -180, 380, 380, g.accent2, { opacity: 0.22, bleed: true })];
    case "blocks":
      return [rect(W - 14, 0, 14, H, g.accent2)];
    case "rules":
      return [rect(M, 76, 56, 3, g.accent)];
    default:
      return [];
  }
}

// --- chrome ------------------------------------------------------------------

/** Eyebrow, title and footer of a reading page; returns the nodes and the y
 *  the body starts at. */
function chrome(K, g, i, eyebrow, title, opts = {}) {
  const t = type(K, g);
  const size = opts.titleSize ?? K.scale.title;
  const lines = opts.titleLines ?? 1;
  const titleY = K.ornament === "hairlines" ? 132 : 124;
  const nodes = [
    ...ornamentPaper(K, g),
    text(M, titleY - 36, 1200, 28, eyebrow, t.eyebrow()),
    text(M, titleY, opts.titleWidth ?? 1240, Math.round(size * 1.1 * lines) + 8, title, t.display(size)),
    ...footer(K, g, i),
  ];
  return { nodes, bodyTop: titleY + Math.round(size * 1.1 * lines) + 52 };
}

function footer(K, g, i) {
  const t = type(K, g);
  const y = K.ornament === "hairlines" ? H - 50 : 992;
  return [
    ...(K.ornament === "hairlines" ? [] : [rect(M, 968, CW, 1, g.line)]),
    text(M, y, 900, 26, `${K.company}  ·  ${K.deck}`, t.meta()),
    text(W - M - 240, y, 240, 26, pageNo(i), t.meta({ align: "right" })),
  ];
}

/** A card: the kit's panel with a hairline stroke, in the kit's radius. */
const card = (K, g, x, y, w, h, o = {}) => rect(x, y, w, h, o.fill ?? g.panel, { radius: K.radius, stroke: o.stroke ?? g.line, strokeWidth: o.strokeWidth ?? 1.5, ...(o.opacity ? { opacity: o.opacity } : {}) });

/** The company mark, top-left of an impact page. */
function mark(K, g, y = M) {
  const t = type(K, g);
  return [rect(M, y, 22, 22, g.accent, { radius: K.radius ? 6 : 0 }), text(M + 36, y - 3, 700, 30, K.company, t.strong(22))];
}

// --- layouts -----------------------------------------------------------------

function cover(K, i) {
  const g = K.deep;
  const t = type(K, g);
  const fill = [];
  const nodes = [...ornamentDeep(K, g, { mark: true })];
  const illustrations = [];
  const centered = K.ornament === "hairlines";
  nodes.push(...mark(K, g));
  fill.push({ node: nodes.length - 1, label: "Company", hint: "Your company or team name" });
  const titleH = Math.round(K.scale.cover * 1.05 * 2) + 10;
  if (centered) {
    // The flyer's composition: the drawing in its halo above a centered title.
    nodes.push(...halo(W / 2, 330, 400, g.accent));
    illustrations.push(art(K.art.cover, W / 2 - 170, 190, 340, 280));
    nodes.push(text(M, 500, CW, 56, K.kicker, t.kicker({ align: "center" })));
    nodes.push(text(M, 560, CW, titleH, "Built for the\nlong run", t.display(K.scale.cover, { lineHeight: 1.02, align: "center" })));
    fill.push({ node: nodes.length - 1, label: "Title", hint: "Two short lines" });
    nodes.push(text(W / 2 - 500, 560 + titleH + 24, 1000, 80, "A year of steady growth, and the plan that carries it into the next decade.", t.body(26, { align: "center" })));
    fill.push({ node: nodes.length - 1, label: "Subtitle", hint: "One sentence on what the deck covers" });
    // A meta row with dividers, the way an event flyer lists when and where.
    const rowY = 900;
    const cols = [["Presented by", "Dana Whitfield"], ["When", "14 October 2026"], ["Where", "Studio, level 4"]];
    cols.forEach(([l, v], k) => {
      const x = W / 2 - 660 + k * 440;
      nodes.push(text(x, rowY, 440, 24, l, t.eyebrow({ align: "center", size: 15 })));
      nodes.push(text(x, rowY + 30, 440, 34, v, t.strong(24, { align: "center" })));
      if (k > 0) nodes.push(rect(x - 1, rowY + 4, 1, 60, g.line));
    });
    fill.push({ node: nodes.length - 4, label: "Presenter", hint: "Who presents" });
    nodes.push(text(W - M - 240, H - 50, 240, 28, pageNo(i), t.meta({ align: "right" })));
    return { page: { name: "Cover", bg: deepGround(g), nodes, illustrations }, fill };
  }
  const textW = 1000;
  nodes.push(text(M, 372, textW, 60, K.kicker, t.kicker()));
  nodes.push(text(M, 446, textW, titleH, "Built for the\nlong run", t.display(K.scale.cover, { lineHeight: 1.02 })));
  fill.push({ node: nodes.length - 1, label: "Title", hint: "Two short lines" });
  nodes.push(text(M, 446 + titleH + 30, 900, 84, "A year of steady growth, and the plan that carries it into the next decade.", t.body(28)));
  fill.push({ node: nodes.length - 1, label: "Subtitle", hint: "One sentence on what the deck covers" });
  nodes.push(text(M, 940, 900, 28, "Dana Whitfield, Managing Partner  ·  14 October 2026", t.meta()));
  fill.push({ node: nodes.length - 1, label: "Presenter and date", hint: "Who presents, and when" });
  nodes.push(text(W - M - 240, 940, 240, 28, pageNo(i), t.meta({ align: "right" })));
  // The hero: a full-colour drawing in a halo, per kit.
  switch (K.ornament) {
    case "blocks":
      nodes.push(rect(1272, 0, 648, H, g.accent, { bleed: true }));
      nodes.push(ellipse(1316, 260, 560, 560, g.ink, { opacity: 0.18 }));
      nodes.push(...confetti([g.lime, g.ink, g.bg], 4, 8, { x: 1290, y: 80, w: 610, h: 920 }));
      nodes.push(text(1330, 96, 500, 48, "2026", t.display(40, { align: "right" })));
      illustrations.push(art(K.art.cover, 1336, 300, 520, 480));
      break;
    case "glow": {
      nodes.push(...halo(1500, 470, 640, g.accent));
      illustrations.push(art(K.art.cover, 1230, 200, 540, 540));
      // Three figures as chips under the subtitle: the tech kit's habit.
      [["99.98%", "uptime"], ["4.6 / day", "deploys"], ["−38%", "p95 latency"]].forEach(([n, l], k) => {
        const x = M + k * 300;
        nodes.push(rect(x, 780, 276, 64, g.panel, { radius: K.radius, stroke: g.line, strokeWidth: 1.5 }));
        nodes.push(text(x + 20, 792, 130, 40, n, t.numeral(26, { family: K.mono })));
        nodes.push(text(x + 150, 800, 110, 26, l, t.meta({ size: 16 })));
      });
      break;
    }
    case "blobs":
      nodes.push(ellipse(1180, 200, 660, 660, g.panel2));
      nodes.push(...halo(1510, 530, 700, g.sun));
      illustrations.push(art(K.art.cover, 1230, 240, 560, 580));
      break;
    case "crosshairs":
      nodes.push(rect(1176, 0, 744, H, g.panel, { bleed: true }));
      nodes.push(rect(1176, 0, 4, H, g.accent));
      nodes.push(...halo(1548, 540, 620, g.accent));
      illustrations.push(art(K.art.cover, 1260, 260, 580, 560));
      break;
    default:
      nodes.push(...halo(1500, 520, 700, g.accent));
      illustrations.push(art(K.art.cover, 1210, 230, 580, 580));
      break;
  }
  return { page: { name: "Cover", bg: deepGround(g), nodes, illustrations }, fill };
}

function agenda(K, i) {
  const g = K.paper;
  const t = type(K, g);
  const { nodes, bodyTop } = chrome(K, g, i, "Agenda", "What we will cover today");
  const items = [
    ["Where we stand", "Results, retention and the numbers behind them", "10 min"],
    ["What we learned", "Three findings that change the plan", "15 min"],
    ["The plan for next year", "Priorities, sequencing and owners", "20 min"],
    ["What it takes", "Budget, hiring and the risks we carry", "10 min"],
    ["Decisions we need", "Three questions for this room", "5 min"],
  ];
  const rowH = 118;
  const y0 = bodyTop;
  items.forEach(([h, s, d], k) => {
    const y = y0 + k * rowH;
    nodes.push(text(M, y + 6, 96, 60, String(k + 1).padStart(2, "0"), t.numeral(44)));
    nodes.push(text(M + 120, y + 4, 900, 44, h, t.display(34)));
    nodes.push(text(M + 120, y + 50, 900, 30, s, t.body(21)));
    nodes.push(button(M + 1040, y + 8, 160, 34, d, { fill: mixHex(g.panel, g.accent, 0.16), color: g.accent, family: K.body, size: 15, weight: 700 }));
    nodes.push(rect(M, y + rowH - 12, 1204, 1, g.line));
  });
  // The session card, on the kit's deep ground.
  const d = K.deep;
  const td = type(K, d);
  const cx = 1396, cy = bodyTop, cw = 428, ch = 560;
  nodes.push(rect(cx, cy, cw, ch, deepGround(d), { radius: K.radius }));
  nodes.push(rect(cx, cy, cw, 6, d.accent, { radius: 0 }));
  nodes.push(text(cx + 40, cy + 40, cw - 80, 28, "Today", td.eyebrow()));
  nodes.push(text(cx + 40, cy + 80, cw - 80, 120, "14 Oct", td.display(76)));
  const meta = [["Time", "09:30 to 10:30"], ["Room", "Boardroom, level 4"], ["Host", "Dana Whitfield"], ["Notes", "Shared after the session"]];
  meta.forEach(([l, v], k) => {
    const my = cy + 236 + k * 74;
    nodes.push(text(cx + 40, my, 120, 26, l, td.meta()));
    nodes.push(text(cx + 40, my + 28, cw - 80, 30, v, td.strong(22)));
    if (k < meta.length - 1) nodes.push(rect(cx + 40, my + 64, cw - 80, 1, d.line));
  });
  return { page: { name: "Agenda", bg: g.bg, nodes } };
}

function section(K, i, n = "02", title = "What we learned", blurb = "Three findings from the year that change how we plan the next one.") {
  const g = K.deep;
  const t = type(K, g);
  const nodes = [...ornamentDeep(K, g)];
  const illustrations = [];
  if (K.ornament === "blocks") {
    nodes.push(rect(0, 0, 360, H, g.accent, { bleed: true }));
    nodes.push(text(48, 300, 300, 260, n, t.display(K.scale.section, { color: g.ink, align: "left" })));
    nodes.push(text(460, 340, 1000, 50, K.kicker, t.kicker()));
    nodes.push(text(460, 400, 1000, 240, title, t.display(96, { lineHeight: 1.04 })));
    nodes.push(text(460, 680, 900, 90, blurb, t.body(28)));
    nodes.push(...confetti([g.lime, g.accent, g.ink], 8, 6, { x: 1380, y: 120, w: 480, h: 840 }));
    illustrations.push(art(K.art.section, 1400, 300, 440, 440));
  } else {
    nodes.push(text(M, 236, 800, K.scale.section + 20, n, t.numeral(K.scale.section)));
    nodes.push(rect(M, 236 + K.scale.section + 20, 120, 4, g.accent));
    nodes.push(text(M, 236 + K.scale.section + 48, 1100, 220, title, t.display(96, { lineHeight: 1.04 })));
    nodes.push(text(M, 236 + K.scale.section + 48 + 232, 900, 90, blurb, t.body(28)));
    nodes.push(...halo(1520, 560, 560, g.accent));
    illustrations.push(art(K.art.section, 1300, 340, 440, 440));
  }
  nodes.push(...footer(K, g, i));
  return { page: { name: "Section", bg: deepGround(g), nodes, illustrations } };
}

function statement(K, i) {
  const g = K.paper;
  const t = type(K, g);
  const nodes = [...ornamentPaper(K, g), ...footer(K, g, i)];
  nodes.push(text(M, 236, 1000, 56, K.kicker, t.kicker()));
  nodes.push(rect(M, 250 + 56, 120, 6, g.accent));
  const y = 296 + 40;
  nodes.push(text(M, y, 1560, Math.round(K.scale.statement * 1.12 * 3) + 10, "Growth that we can explain is the only kind we want to keep.", t.display(K.scale.statement, { lineHeight: 1.1 })));
  nodes.push(text(M, y + Math.round(K.scale.statement * 1.12 * 3) + 50, 1000, 32, "Dana Whitfield, in the FY2026 letter to partners", t.meta()));
  return { page: { name: "Statement", bg: g.bg, nodes } };
}

function textPicture(K, i) {
  const g = K.paper;
  const t = type(K, g);
  const { nodes, bodyTop } = chrome(K, g, i, "Where we stand", "Three things the year proved", { titleWidth: 960 });
  const points = [
    ["Retention leads growth", "Net revenue retention held above 118% in every quarter, before any new logo."],
    ["The mid-market is ours", "Deals between 200 and 2,000 seats closed twice as fast as a year ago."],
    ["Partners now bring a third of pipeline", "Referred deals close at higher values and churn less."],
  ];
  points.forEach(([h, s], k) => {
    const y = bodyTop + 24 + k * 178;
    nodes.push(ellipse(M, y + 4, 34, 34, mixHex(g.panel, g.accent, 0.18)));
    nodes.push(text(M, y + 4, 34, 34, String(k + 1), { family: K.display, size: 17, weight: K.dw, color: g.accent, align: "center", vAlign: "middle", lineHeight: 1 }));
    nodes.push(text(M + 56, y, 840, 44, h, t.display(32)));
    nodes.push(text(M + 56, y + 52, 840, 70, s, t.body(22)));
  });
  // The picture slot: a tinted shape (drop a photo on it) with a drawing on it.
  nodes.push(photo(1080, 196, 744, 740, { angle: 160, stops: [[mixHex(g.panel, g.accent2, 0.22), 0], [g.panel, 1]] }, { radius: K.radius * 1.5 }));
  nodes.push(...halo(1452, 566, 520, g.accent));
  const illustrations = [art(K.art.picture, 1150, 280, 604, 570)];
  return { page: { name: "Text and picture", bg: g.bg, nodes, illustrations } };
}

function twoColumns(K, i) {
  const g = K.paper;
  const d = K.deep;
  const t = type(K, g);
  const td = type(K, d);
  const { nodes, bodyTop } = chrome(K, g, i, "What we learned", "Before and after the change");
  const colW = (CW - 32) / 2;
  const y = bodyTop;
  const h = 600;
  const cols = [
    { x: M, g, ty: t, eyebrow: "Before", head: "Every team ran its own playbook", lines: ["Four onboarding flows, none shared", "Handoffs lost a day at every step", "Nobody owned the number"], icon: "alert-triangle" },
    { x: M + colW + 32, g: d, ty: td, eyebrow: "After", head: "One playbook, one owner", lines: ["A single flow every team adopts", "Handoffs measured and cut to hours", "One dashboard, one accountable lead"], icon: "circle-check" },
  ];
  cols.forEach((c) => {
    if (c.g === g) nodes.push(card(K, g, c.x, y, colW, h));
    else nodes.push(rect(c.x, y, colW, h, deepGround(d), { radius: K.radius }));
    nodes.push(icon(c.icon, c.x + colW - 88, y + 44, 40, c.g.accent));
    nodes.push(text(c.x + 48, y + 48, colW - 160, 28, c.eyebrow, c.ty.eyebrow()));
    nodes.push(text(c.x + 48, y + 92, colW - 96, 112, c.head, c.ty.display(40, { lineHeight: 1.1 })));
    c.lines.forEach((l, k) => {
      const ly = y + 260 + k * 100;
      nodes.push(rect(c.x + 48, ly, colW - 96, 1, c.g.line));
      nodes.push(text(c.x + 48, ly + 24, colW - 96, 40, l, c.ty.strong(24)));
    });
  });
  return { page: { name: "Two columns", bg: g.bg, nodes } };
}

function threeCards(K, i) {
  const g = K.paper;
  const t = type(K, g);
  const { nodes, bodyTop } = chrome(K, g, i, "The plan", "Three priorities for the year");
  const cards = [
    ["flag", "Win the mid-market", "Double the segment team and ship the two integrations every deal asks for."],
    ["shield", "Earn the enterprise", "Certifications, regional residency and a support tier that answers in an hour."],
    ["sparkles", "Make the product sell itself", "A free tier that grows into paid on its own, measured weekly."],
  ];
  const cw = (CW - 48) / 3;
  const y = bodyTop;
  const h = 580;
  const tones = [g.accent, g.accent2, g.accent];
  cards.forEach(([ic, head, body], k) => {
    const x = M + k * (cw + 24);
    nodes.push(card(K, g, x, y, cw, h));
    nodes.push(rect(x, y, cw, 6, tones[k], { radius: 0 }));
    nodes.push(ellipse(x + 40, y + 48, 80, 80, mixHex(g.panel, tones[k], 0.2)));
    nodes.push(icon(ic, x + 60, y + 68, 40, tones[k]));
    nodes.push(text(x + 40, y + 164, cw - 80, 100, head, t.display(34, { lineHeight: 1.1 })));
    nodes.push(text(x + 40, y + 276, cw - 80, 160, body, t.body(22)));
    nodes.push(rect(x + 40, y + h - 84, cw - 80, 1, g.line));
    nodes.push(text(x + 40, y + h - 60, 120, 28, String(k + 1).padStart(2, "0"), t.meta()));
  });
  return { page: { name: "Three cards", bg: g.bg, nodes } };
}

function figures(K, i) {
  const g = K.paper;
  const t = type(K, g);
  const { nodes, bodyTop } = chrome(K, g, i, "Results", "The year in four numbers");
  const stats = [
    ["$48.2M", "Annual recurring revenue", "+31% year over year", "Up from $36.8M, with expansion ahead of new business for the first time."],
    ["118%", "Net revenue retention", "+6 pts", "Held above target in every quarter; enterprise accounts led."],
    ["1,240", "Customers", "+280 net new", "Mid-market grew fastest; churn fell to 4.1% on the year."],
    ["19", "Months of runway", "Plan holds", "Before the round, at the current burn and the current plan."],
  ];
  const cw = (CW - 72) / 4;
  const y = bodyTop;
  const h = 560;
  stats.forEach(([n, l, d, note], k) => {
    const x = M + k * (cw + 24);
    const tone = k % 2 ? g.accent2 : g.accent;
    nodes.push(card(K, g, x, y, cw, h));
    nodes.push(rect(x, y, cw, 6, tone, { radius: 0 }));
    nodes.push(text(x + 36, y + 56, cw - 72, K.scale.numeral + 16, n, t.numeral(K.scale.numeral * (n.length > 5 ? 0.8 : 1), { color: tone })));
    nodes.push(text(x + 36, y + 196, cw - 72, 34, l, t.strong(24)));
    nodes.push(button(x + 36, y + 250, 190, 40, d, { fill: mixHex(g.panel, tone, 0.18), color: tone, family: K.body, size: 17, weight: 700 }));
    nodes.push(text(x + 36, y + 320, cw - 72, 140, note, t.body(20)));
  });
  return { page: { name: "Figures", bg: g.bg, nodes } };
}

function chart(K, i) {
  const g = K.paper;
  const t = type(K, g);
  const { nodes, bodyTop } = chrome(K, g, i, "Results", "Revenue by quarter", { titleWidth: 1100 });
  nodes.push(text(M, bodyTop - 24, 1100, 36, "Expansion overtook new business in Q2 and has led every quarter since.", t.body(24)));
  const cx = M, cy = bodyTop + 40, cw = 1140, ch = 580;
  // Chart text draws in a fixed dark ink, so a dark kit sets its chart on a
  // light card; a light kit lets it sit on the page.
  const dark = isDark(g.bg);
  if (dark) nodes.push(rect(cx - 32, cy - 24, cw + 64, ch + 48, "#F3F5F9", { radius: K.radius }));
  nodes.push({
    kind: "chart", x: cx, y: cy, w: cw, h: ch, chartType: "barGrouped", fontSize: 18,
    categories: ["Q1", "Q2", "Q3", "Q4"],
    series: [
      { name: "New business", values: [2.1, 2.4, 2.6, 3.0], color: dark ? "#1F2A44" : g.accent2 },
      { name: "Expansion", values: [1.8, 2.7, 3.4, 4.2], color: dark && !isDark(g.accent) ? g.accent2 : g.accent },
    ],
  });
  const rx = 1320, rw = 504;
  const calls = [["$4.2M", "Expansion revenue in Q4, a record"], ["58%", "Share of Q4 growth from existing customers"], ["3 of 4", "Quarters where expansion led"]];
  calls.forEach(([n, l], k) => {
    const y = bodyTop + 20 + k * 180;
    nodes.push(text(rx, y, rw, 80, n, t.numeral(64)));
    nodes.push(text(rx, y + 88, rw, 60, l, t.body(22)));
    if (k < calls.length - 1) nodes.push(rect(rx, y + 152, rw, 1, g.line));
  });
  return { page: { name: "Chart", bg: g.bg, nodes } };
}

function timeline(K, i) {
  const g = K.paper;
  const t = type(K, g);
  const { nodes, bodyTop } = chrome(K, g, i, "The plan", "The road to next October");
  const steps = [
    ["Q1", "Foundations", "Segment team hired, the two integrations shipped, pricing page rebuilt."],
    ["Q2", "Enterprise ready", "Certifications complete, EU residency live, one-hour support tier launched."],
    ["Q3", "Self-serve growth", "Free tier public, conversion measured weekly, first paid upgrades on their own."],
    ["Q4", "Scale what works", "Double down on the channel that grew, cut the ones that did not."],
  ];
  const y = bodyTop + 170;
  nodes.push(rect(M, y + 13, CW, 3, g.line));
  nodes.push(rect(M, y + 13, CW / 2, 3, g.accent));
  const cw = CW / 4;
  steps.forEach(([q, h, s], k) => {
    const x = M + k * cw;
    const done = k < 2;
    nodes.push(ellipse(x, y, 30, 30, done ? g.accent : g.bg, done ? {} : { stroke: g.accent, strokeWidth: 3 }));
    nodes.push(text(x, y - 60, 300, 28, q, t.eyebrow()));
    nodes.push(text(x, y + 64, cw - 48, 44, h, t.display(32)));
    nodes.push(text(x, y + 116, cw - 48, 120, s, t.body(21)));
  });
  return { page: { name: "Timeline", bg: g.bg, nodes } };
}

function process(K, i) {
  const g = K.paper;
  const d = K.deep;
  const t = type(K, g);
  const { nodes, bodyTop } = chrome(K, g, i, "How it works", "From first call to live");
  const steps = [
    ["Discover", "A 45-minute call maps your workflow and the numbers you care about."],
    ["Pilot", "One team, two weeks, your real data. We measure against the baseline."],
    ["Roll out", "Every team onboarded in waves, with a named lead on each side."],
    ["Review", "A quarterly session on the numbers, and the plan for the next one."],
  ];
  const cw = (CW - 3 * 40) / 4;
  const y = bodyTop + 30;
  steps.forEach(([h, s], k) => {
    const x = M + k * (cw + 40);
    const fillC = k === 0 ? g.accent : d.bg;
    nodes.push(ellipse(x, y, 88, 88, fillC));
    nodes.push(text(x, y, 88, 88, String(k + 1), { family: K.display, size: 34, weight: K.dw, color: inkOn(K, fillC), align: "center", vAlign: "middle", lineHeight: 1 }));
    if (k < steps.length - 1) nodes.push(rect(x + 104, y + 43, cw - 104 + 24, 2, g.line));
    nodes.push(text(x, y + 132, cw, 44, h, t.display(32)));
    nodes.push(text(x, y + 186, cw - 24, 150, s, t.body(21)));
  });
  return { page: { name: "Process", bg: g.bg, nodes } };
}

function table(K, i) {
  const g = K.paper;
  const d = K.deep;
  const t = type(K, g);
  const td = type(K, d);
  const { nodes, bodyTop } = chrome(K, g, i, "Options", "How the plans compare");
  const cols = ["", "Starter", "Team", "Enterprise"];
  const rows = [
    ["Seats included", "5", "25", "Unlimited"],
    ["Shared workspaces", "yes", "yes", "yes"],
    ["Brand kits", "no", "yes", "yes"],
    ["Single sign-on", "no", "no", "yes"],
    ["Support response", "2 days", "1 day", "1 hour"],
  ];
  const x0 = M, y0 = bodyTop;
  const firstW = 600;
  const colW = (CW - firstW) / 3;
  const headH = 76, rowH = 96;
  nodes.push(rect(x0, y0, CW, headH, deepGround(d), { radius: K.radius ? Math.min(K.radius, 12) : 0 }));
  cols.forEach((c, k) => {
    if (!k) return;
    nodes.push(text(x0 + firstW + (k - 1) * colW, y0 + 22, colW, 32, c, td.strong(22, { align: "center" })));
  });
  rows.forEach((r, k) => {
    const y = y0 + headH + k * rowH;
    if (k % 2 === 1) nodes.push(rect(x0, y, CW, rowH, g.panel));
    nodes.push(text(x0 + 32, y + 30, firstW - 64, 36, r[0], t.strong(24)));
    r.slice(1).forEach((v, c) => {
      const cx = x0 + firstW + c * colW;
      if (v === "yes") nodes.push(icon("circle-check", cx + colW / 2 - 16, y + 32, 32, g.accent));
      else if (v === "no") nodes.push(icon("circle", cx + colW / 2 - 16, y + 32, 32, g.line));
      else nodes.push(text(cx, y + 30, colW, 36, v, t.strong(24, { align: "center", color: g.muted })));
    });
    nodes.push(rect(x0, y + rowH - 1, CW, 1, g.line));
  });
  return { page: { name: "Comparison table", bg: g.bg, nodes } };
}

function team(K, i) {
  const g = K.paper;
  const t = type(K, g);
  const { nodes, bodyTop } = chrome(K, g, i, "Who we are", "The people behind the plan");
  const people = [
    ["Dana Whitfield", "Managing Partner", "Twenty years across three funds; leads the portfolio."],
    ["Marcus Obi", "Chief Operating Officer", "Built the operating model every team now runs on."],
    ["Priya Raman", "Head of Product", "Owns the roadmap and the free tier that feeds it."],
    ["Elena Sato", "Head of Customers", "Retention, expansion and the partners who bring both."],
  ];
  const cw = (CW - 72) / 4;
  const y = bodyTop + 20;
  const illustrations = [];
  people.forEach(([n, r, b], k) => {
    const x = M + k * (cw + 24);
    const tone = k % 2 ? g.accent2 : g.accent;
    const px = x + (cw - 220) / 2;
    // A portrait slot: a tinted circle (drop a photo on it) with a drawn peep.
    nodes.push(photo(px, y, 220, 220, mixHex(g.panel, tone, 0.22), { shape: "ellipse" }));
    illustrations.push(art(K.peeps[k], px + 30, y + 22, 160, 176));
    nodes.push(text(x, y + 252, cw, 40, n, t.display(30, { align: "center" })));
    nodes.push(text(x, y + 298, cw, 28, r, t.eyebrow({ align: "center", size: 17, color: tone })));
    nodes.push(text(x + 24, y + 344, cw - 48, 96, b, t.body(21, { align: "center" })));
  });
  return { page: { name: "Team", bg: g.bg, nodes, illustrations } };
}

function quote(K, i) {
  const g = K.deep;
  const t = type(K, g);
  const nodes = [...ornamentDeep(K, g), ...footer(K, g, i)];
  nodes.push(text(M, 180, 260, 260, "“", t.numeral(280, { lineHeight: 1 })));
  const qh = Math.round(K.scale.quote * 1.3 * 3) + 10;
  nodes.push(text(M + 20, 400, 1400, qh, "They did not sell us software. They showed us the number we were losing every week, and then made it stop.", t.display(K.scale.quote, { lineHeight: 1.26, weight: K.display === "Fraunces" ? 400 : K.dw })));
  const ay = 400 + qh + 60;
  nodes.push(photo(M + 20, ay, 84, 84, g.panel2, { shape: "ellipse" }));
  const illustrations = [art(K.peeps[4], M + 32, ay + 8, 60, 68)];
  nodes.push(text(M + 128, ay + 8, 800, 32, "Rowan Achebe", t.strong(24)));
  nodes.push(text(M + 128, ay + 44, 800, 28, "Chief Financial Officer, Brightline Logistics", t.body(20)));
  return { page: { name: "Quote", bg: deepGround(g), nodes, illustrations } };
}

function pricing(K, i) {
  const g = K.paper;
  const d = K.deep;
  const t = type(K, g);
  const td = type(K, d);
  const { nodes, bodyTop } = chrome(K, g, i, "Options", "Pick the plan that fits");
  const tiers = [
    ["Starter", "$29", "per seat, per month", ["5 seats", "Shared workspaces", "Community support", "Export to PDF"], false],
    ["Team", "$59", "per seat, per month", ["25 seats", "Brand kits and templates", "Priority support", "Version history"], true],
    ["Enterprise", "Custom", "annual agreement", ["Unlimited seats", "Single sign-on", "One-hour response", "Dedicated success lead"], false],
  ];
  const cw = (CW - 64) / 3;
  const y = bodyTop;
  const h = 620;
  tiers.forEach(([name, price, per, feats, hot], k) => {
    const x = M + k * (cw + 32);
    const gg = hot ? d : g;
    const tt = hot ? td : t;
    if (hot) nodes.push(rect(x, y - 16, cw, h + 32, deepGround(d), { radius: K.radius }));
    else nodes.push(card(K, g, x, y, cw, h, { fill: g.bg }));
    const top = hot ? y - 16 : y;
    if (hot) nodes.push(button(x + cw - 200, top + 28, 160, 36, "Most chosen", { fill: gg.accent, color: inkOn(K, gg.accent), family: K.body, size: 15, weight: 700, upper: true, letterSpacing: 1 }));
    nodes.push(text(x + 40, top + 40, cw - 80, 28, name, tt.eyebrow()));
    nodes.push(text(x + 40, top + 84, cw - 80, 90, price, tt.display(72)));
    nodes.push(text(x + 40, top + 180, cw - 80, 28, per, tt.body(20)));
    nodes.push(rect(x + 40, top + 232, cw - 80, 1, gg.line));
    feats.forEach((f, j) => {
      const fy = top + 264 + j * 56;
      nodes.push(icon("circle-check", x + 40, fy, 26, gg.accent));
      nodes.push(text(x + 84, fy - 2, cw - 124, 32, f, tt.strong(22, { weight: 500 })));
    });
    const btnFill = hot ? gg.accent : d.bg;
    nodes.push(button(x + 40, y + h - 100, cw - 80, 60, hot ? "Start with Team" : "Choose " + name, { fill: btnFill, color: inkOn(K, btnFill), family: K.body, size: 20, weight: 700, radius: K.radius ? Math.min(K.radius, 30) : 0 }));
  });
  return { page: { name: "Pricing", bg: g.bg, nodes } };
}

function closing(K, i) {
  const g = K.deep;
  const t = type(K, g);
  const nodes = [...ornamentDeep(K, g, { mark: true })];
  const illustrations = [];
  const fill = [];
  if (K.ornament === "blocks") {
    nodes.push(rect(1272, 0, 648, H, g.accent, { bleed: true }));
    nodes.push(ellipse(1316, 240, 560, 560, g.ink, { opacity: 0.18 }));
    nodes.push(...confetti([g.lime, g.ink, g.bg], 12, 8, { x: 1290, y: 80, w: 610, h: 920 }));
    illustrations.push(art(K.art.closing, 1336, 280, 520, 480));
  } else {
    nodes.push(...halo(1520, 520, 640, g.accent));
    illustrations.push(art(K.art.closing, 1250, 250, 540, 540));
  }
  nodes.push(...mark(K, g));
  nodes.push(text(M, 236, 1000, 60, K.farewell, t.kicker()));
  nodes.push(text(M, 300, 1100, Math.round(K.scale.cover * 1.1) + 10, "Thank you", t.display(K.scale.cover)));
  nodes.push(text(M, 300 + Math.round(K.scale.cover * 1.1) + 34, 940, 84, "Questions now, or any time this week. The deck and the model are in the shared folder.", t.body(28)));
  const rows = [["mail", "dana@halcyon.example"], ["world", "halcyon.example"], ["phone", "+1 415 555 0142"]];
  rows.forEach(([ic, v], k) => {
    const y = 700 + k * 62;
    nodes.push(icon(ic, M, y + 2, 28, g.accent));
    nodes.push(text(M + 48, y, 800, 34, v, t.strong(24, { weight: 500 })));
    fill.push({ node: nodes.length - 1, label: ["Email", "Website", "Phone"][k], hint: "Contact detail" });
  });
  nodes.push(button(M, 910, 340, 64, "Book a follow-up", { fill: g.accent, color: inkOn(K, g.accent), family: K.body, size: 22, weight: 700, radius: K.radius ? Math.min(K.radius, 32) : 0 }));
  nodes.push(text(W - M - 240, 940, 240, 28, pageNo(i), t.meta({ align: "right" })));
  return { page: { name: "Closing", bg: deepGround(g), nodes, illustrations }, fill };
}

// --- assemble ------------------------------------------------------------------

const LAYOUTS = [
  cover, agenda,
  (K, i) => section(K, i, "01", "Where we stand", "The year in numbers, and what sits behind each of them."),
  statement, textPicture, twoColumns, threeCards, figures, chart, timeline, process, table, team, quote, pricing, closing,
];

for (const K of KITS) {
  const pages = [];
  const fillable = [];
  LAYOUTS.forEach((layout, i) => {
    const { page, fill } = layout(K, i);
    pages.push(page);
    for (const f of fill ?? []) fillable.push({ node: `p${i}-n${f.node}`, kind: "text", label: f.label, hint: f.hint });
  });
  const spec = {
    id: K.id,
    title: K.title,
    categories: ["presentations", "business"],
    tags: K.tags,
    styleTags: K.styleTags,
    size: [W, H],
    typography: [
      { role: "heading", family: K.display, weight: K.dw },
      { role: "body", family: K.body, weight: K.bw },
      { role: "accent", family: K.accentFace, weight: K.accentWeight },
      ...(K.mono ? [{ role: "label", family: K.mono, weight: 500 }] : []),
    ],
    pages,
    fillable,
    version: 2,
    created: "2026-09-29T00:00:00.000Z",
    updated: "2026-09-30T00:00:00.000Z",
    rank: K.rank,
  };
  writeFileSync(join(OUT, `${K.id}.json`), JSON.stringify(spec, null, 1) + "\n");
  console.log(`${K.id}: ${pages.length} slides, ${pages.reduce((n, p) => n + p.nodes.length + (p.illustrations?.length ?? 0), 0)} nodes`);
}
