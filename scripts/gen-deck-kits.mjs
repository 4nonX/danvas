// Generate the presentation kits: six complete slide systems, sixteen layouts
// each, written as template specs (scripts/templates/kit-*.json) for
// scripts/build-templates.mjs to compile into the embedded seed.
//
//   node scripts/gen-deck-kits.mjs            # write the six kit specs
//   node scripts/build-templates.mjs          # then compile the seed
//
// A kit is one visual system (its faces, its palette on paper and on a deep
// ground, its corner radius, its ornament) applied to the same catalog of
// layouts: cover, agenda, section, statement, text with a picture, two
// columns, three cards, a figure row, a chart, a timeline, a process, a
// comparison table, a team, a quote, pricing, and a closing. The layouts are
// hand-set here, slot by slot, the way the single-page design templates are;
// the kit tokens keep every slide of one kit on the same grid, scale and
// palette, so a deck built from any subset of its slides holds together.
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
 *  the closing. A dark kit's paper is dark too, one shade lighter than deep. */
const KITS = [
  {
    id: "kit-atlas",
    title: "Atlas Corporate Kit",
    tags: ["kit", "corporate", "annual report", "investor", "serif", "navy", "gold"],
    styleTags: ["professional", "classic", "elegant"],
    rank: 10,
    company: "Halcyon Capital",
    deck: "Annual review FY2026",
    display: "Playfair Display", dw: 700, body: "Source Sans 3", bw: 400, mono: null,
    paper: { bg: "#F7F5F0", ink: "#14213D", muted: "#5C6478", line: "#D9D4C7", panel: "#EEEBE3", panel2: "#E3DFD3", accent: "#B8901F", accent2: "#1F4E79" },
    deep: { bg: "#14213D", ink: "#F7F5F0", muted: "#AEB6C9", line: "#2B3A5E", panel: "#1C2C4F", panel2: "#243761", accent: "#D4AA2E", accent2: "#7FA6D0" },
    radius: 6,
    ornament: "rules",
    coverGround: "deep",
    coverPicture: "photo",
    tracking: 4,
    scale: { cover: 118, title: 62, section: 236, statement: 80, numeral: 104, quote: 54 },
  },
  {
    id: "kit-vanta",
    title: "Vanta Tech Kit",
    tags: ["kit", "tech", "product", "engineering", "dark", "mono", "gradient"],
    styleTags: ["modern", "bold", "dark"],
    rank: 11,
    company: "Nova Systems",
    deck: "Platform review Q3",
    display: "Space Grotesk", dw: 700, body: "IBM Plex Sans", bw: 400, mono: "IBM Plex Mono",
    paper: { bg: "#0D1220", ink: "#F1F5F9", muted: "#8B95AB", line: "#1F2A3F", panel: "#141B2D", panel2: "#1B2438", accent: "#C6F135", accent2: "#8B7CFF" },
    deep: { bg: "#070A12", ink: "#F1F5F9", muted: "#8B95AB", line: "#1A2338", panel: "#10172A", panel2: "#182034", accent: "#C6F135", accent2: "#8B7CFF" },
    radius: 14,
    ornament: "glow",
    coverGround: "deep",
    coverPicture: "stats",
    tracking: 3,
    scale: { cover: 116, title: 60, section: 220, statement: 76, numeral: 100, quote: 50 },
  },
  {
    id: "kit-folio",
    title: "Folio Editorial Kit",
    tags: ["kit", "editorial", "strategy", "serif", "cream", "minimal", "magazine"],
    styleTags: ["editorial", "minimal", "elegant"],
    rank: 12,
    company: "Meridian Studio",
    deck: "Brand strategy 2027",
    display: "Fraunces", dw: 600, body: "Inter", bw: 400, mono: null,
    paper: { bg: "#F4EFE6", ink: "#1C1A17", muted: "#6B655C", line: "#D8D0C2", panel: "#ECE5D8", panel2: "#E2DACB", accent: "#C8371E", accent2: "#2B4C3F" },
    deep: { bg: "#1C1A17", ink: "#F4EFE6", muted: "#A8A094", line: "#3A3630", panel: "#26231F", panel2: "#302C27", accent: "#E85A3E", accent2: "#8FB39F" },
    radius: 0,
    ornament: "hairlines",
    coverGround: "paper",
    coverPicture: "none",
    tracking: 3,
    scale: { cover: 128, title: 66, section: 260, statement: 84, numeral: 108, quote: 56 },
  },
  {
    id: "kit-pulse",
    title: "Pulse Startup Kit",
    tags: ["kit", "startup", "pitch", "launch", "bold", "coral", "cobalt"],
    styleTags: ["bold", "modern", "playful"],
    rank: 13,
    company: "Loop",
    deck: "Seed round 2026",
    display: "Sora", dw: 800, body: "Manrope", bw: 500, mono: null,
    paper: { bg: "#FFFFFF", ink: "#0B0B14", muted: "#5B5B70", line: "#E6E6EE", panel: "#F3F3F8", panel2: "#E9E9F2", accent: "#FF4D2E", accent2: "#2A2AFF" },
    deep: { bg: "#2A2AFF", ink: "#FFFFFF", muted: "#C9C9FF", line: "#4A4AFF", panel: "#3838FF", panel2: "#4646FF", accent: "#FF4D2E", accent2: "#B9F542" },
    radius: 24,
    ornament: "blocks",
    coverGround: "deep",
    coverPicture: "blocks",
    tracking: 2,
    scale: { cover: 124, title: 68, section: 250, statement: 82, numeral: 112, quote: 54 },
  },
  {
    id: "kit-terra",
    title: "Terra Community Kit",
    tags: ["kit", "sustainability", "nonprofit", "community", "warm", "organic", "illustrated"],
    styleTags: ["warm", "friendly", "organic"],
    rank: 14,
    company: "Fernwood Collective",
    deck: "Impact report 2026",
    display: "Outfit", dw: 700, body: "Nunito Sans", bw: 400, mono: null,
    paper: { bg: "#F6EFE4", ink: "#2F2A25", muted: "#7A6F63", line: "#DDD1BF", panel: "#EDE3D3", panel2: "#E3D7C3", accent: "#C4643B", accent2: "#5E7F5C" },
    deep: { bg: "#334233", ink: "#F6EFE4", muted: "#B9C3B4", line: "#465646", panel: "#3D4E3C", panel2: "#475A46", accent: "#E38B62", accent2: "#A9C7A3" },
    radius: 28,
    ornament: "blobs",
    coverGround: "deep",
    coverPicture: "drawing",
    tracking: 2,
    scale: { cover: 120, title: 64, section: 240, statement: 80, numeral: 108, quote: 54 },
  },
  {
    id: "kit-slate",
    title: "Slate Minimal Kit",
    tags: ["kit", "agency", "portfolio", "proposal", "minimal", "swiss", "monochrome"],
    styleTags: ["minimal", "modern", "clean"],
    rank: 15,
    company: "Form & Function",
    deck: "Studio proposal",
    display: "Archivo", dw: 700, body: "Archivo", bw: 400, mono: null,
    paper: { bg: "#FFFFFF", ink: "#111111", muted: "#6B6B6B", line: "#E2E2E2", panel: "#F3F3F3", panel2: "#E9E9E9", accent: "#2F6BFF", accent2: "#111111" },
    deep: { bg: "#111111", ink: "#FFFFFF", muted: "#9A9A9A", line: "#2E2E2E", panel: "#1C1C1C", panel2: "#262626", accent: "#5C8CFF", accent2: "#FFFFFF" },
    radius: 0,
    ornament: "crosshairs",
    coverGround: "deep",
    coverPicture: "photo",
    tracking: 3,
    scale: { cover: 120, title: 60, section: 236, statement: 78, numeral: 104, quote: 52 },
  },
];

// --- primitives --------------------------------------------------------------

const text = (x, y, w, h, t, o = {}) => ({ kind: "text", x, y, w, h, text: t, ...o });
const rect = (x, y, w, h, fill, o = {}) => ({ kind: "rect", x, y, w, h, fill, ...o });
const ellipse = (x, y, w, h, fill, o = {}) => ({ kind: "ellipse", x, y, w, h, fill, ...o });
const button = (x, y, w, h, label, o = {}) => ({ kind: "button", x, y, w, h, label, ...o });
const icon = (name, x, y, size, color) => ({ kind: "icon", icon: name, x, y, w: size, h: size, color });
const photo = (x, y, w, h, fill, o = {}) =>
  o.shape === "ellipse"
    ? { kind: "ellipse", name: "Photo", x, y, w, h, fill }
    : { kind: "photo", name: "Photo", x, y, w, h, fill, ...o };
const drawing = (name, x, y, w, h, g) => ({ kind: "drawing", drawing: name, x, y, w, h, ink: g.ink, accent: g.accent, ground: g.bg });

function mixHex(a, b, t) {
  const pa = a.replace("#", ""), pb = b.replace("#", "");
  const ch = (i) => Math.round(parseInt(pa.slice(i, i + 2), 16) * (1 - t) + parseInt(pb.slice(i, i + 2), 16) * t);
  return "#" + [0, 2, 4].map((i) => ch(i).toString(16).padStart(2, "0")).join("");
}

/** Type roles for a kit on a ground. Each returns the text options only; the
 *  caller supplies the box. */
function type(K, g) {
  return {
    display: (size, o = {}) => ({ family: K.display, size, weight: K.dw, color: g.ink, lineHeight: 1.06, ...o }),
    body: (size, o = {}) => ({ family: K.body, size, weight: K.bw, color: g.muted, lineHeight: 1.4, ...o }),
    strong: (size, o = {}) => ({ family: K.body, size, weight: 600, color: g.ink, lineHeight: 1.3, ...o }),
    eyebrow: (o = {}) => ({ family: K.mono ?? K.body, size: 20, weight: 600, color: g.accent, letterSpacing: K.tracking, upper: true, lineHeight: 1.2, ...o }),
    meta: (o = {}) => ({ family: K.mono ?? K.body, size: 18, weight: 500, color: g.muted, lineHeight: 1.3, ...o }),
    numeral: (size, o = {}) => ({ family: K.display, size, weight: K.dw, color: g.accent, lineHeight: 1, ...o }),
  };
}

const pageNo = (i) => `${String(i + 1).padStart(2, "0")} / ${PAGES}`;

// --- ornaments ---------------------------------------------------------------

/** The kit's signature marks on a deep page (cover, section, closing). */
function ornamentDeep(K, g, opts = {}) {
  switch (K.ornament) {
    case "rules":
      return [rect(40, 40, W - 80, H - 80, undefined, { stroke: g.accent, strokeWidth: 1, opacity: 0.55 })];
    case "glow":
      return [
        ellipse(1380, -420, 1100, 1100, { angle: 135, stops: [[g.accent2, 0], [g.bg, 1]], radial: true }, { opacity: 0.55, bleed: true }),
        ellipse(-380, 620, 900, 900, { angle: 135, stops: [[g.accent, 0], [g.bg, 1]], radial: true }, { opacity: 0.22, bleed: true }),
        ...[320, 640, 960, 1280, 1600].map((x) => rect(x, 0, 1, H, g.ink, { opacity: 0.06 })),
        ...[270, 540, 810].map((y) => rect(0, y, W, 1, g.ink, { opacity: 0.06 })),
      ];
    case "hairlines":
      return [rect(M, 64, CW, 2, g.ink), rect(M, H - 66, CW, 2, g.ink), ...(opts.mark ? [] : [rect(M, 84, 14, 14, g.accent)])];
    case "blocks":
      return [];
    case "blobs":
      return [
        ellipse(1480, -260, 760, 760, g.accent2, { opacity: 0.35, bleed: true }),
        ellipse(-200, 720, 560, 560, g.accent, { opacity: 0.3, bleed: true }),
      ];
    case "crosshairs":
      return crosshairs(g.ink, 0.7);
    default:
      return [];
  }
}

/** The kit's quieter marks on a reading page. */
function ornamentPaper(K, g) {
  switch (K.ornament) {
    case "glow":
      return [
        ellipse(1500, -520, 1000, 1000, { angle: 135, stops: [[g.accent2, 0], [g.bg, 1]], radial: true }, { opacity: 0.28, bleed: true }),
        ...[320, 640, 960, 1280, 1600].map((x) => rect(x, 0, 1, H, g.ink, { opacity: 0.045 })),
      ];
    case "hairlines":
      return [rect(M, 64, CW, 2, g.ink)];
    case "crosshairs":
      return crosshairs(g.line, 1);
    default:
      return [];
  }
}

function crosshairs(color, opacity) {
  const out = [];
  for (const [cx, cy] of [[48, 48], [W - 48, 48], [48, H - 48], [W - 48, H - 48]]) {
    out.push(rect(cx - 12, cy - 1, 24, 2, color, { opacity }), rect(cx - 1, cy - 12, 2, 24, color, { opacity }));
  }
  return out;
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

/** A panel (card) in the kit's radius. */
const panel = (g, x, y, w, h, fill, o = {}) => rect(x, y, w, h, fill ?? g.panel, { radius: o.radius, ...o });

// --- layouts -----------------------------------------------------------------

function cover(K, i) {
  const g = K[K.coverGround];
  const t = type(K, g);
  const fill = [];
  const nodes = [...ornamentDeep(K, g, { mark: true })];
  const textW = K.coverPicture === "none" ? 1500 : 1020;
  // Mark and company.
  nodes.push(rect(M, M, 22, 22, g.accent, { radius: K.radius ? 6 : 0 }));
  nodes.push(text(M + 36, M - 3, 700, 30, K.company, t.strong(22)));
  fill.push({ node: nodes.length - 1, label: "Company", hint: "Your company or team name" });
  // Eyebrow, title, subtitle.
  nodes.push(text(M, 404, textW, 28, `${K.deck}  ·  Confidential`, t.eyebrow()));
  nodes.push(text(M, 446, textW, Math.round(K.scale.cover * 1.05 * 2) + 10, "Built for the\nlong run", t.display(K.scale.cover, { lineHeight: 1.02 })));
  fill.push({ node: nodes.length - 1, label: "Title", hint: "Two short lines" });
  nodes.push(text(M, 446 + Math.round(K.scale.cover * 1.05 * 2) + 36, Math.min(textW, 900), 84, "A year of steady growth, and the plan that carries it into the next decade.", t.body(28)));
  fill.push({ node: nodes.length - 1, label: "Subtitle", hint: "One sentence on what the deck covers" });
  // Presenter and date.
  nodes.push(text(M, 940, 900, 28, "Dana Whitfield, Managing Partner  ·  14 October 2026", t.meta()));
  fill.push({ node: nodes.length - 1, label: "Presenter and date", hint: "Who presents, and when" });
  nodes.push(text(W - M - 240, 940, 240, 28, pageNo(i), t.meta({ align: "right" })));
  // The picture, per kit.
  switch (K.coverPicture) {
    case "photo":
      nodes.push(photo(1176, 0, 744, H, { angle: 160, stops: [[g.panel2, 0], [g.panel, 1]] }));
      if (K.ornament === "crosshairs") nodes.push(rect(1176, 0, 4, H, g.accent));
      break;
    case "drawing":
      nodes.push(ellipse(1180, 220, 640, 640, g.panel));
      nodes.push(drawing("Growth", 1200, 250, 600, 580, g));
      break;
    case "stats": {
      const x = 1240, y = 300, w = 584;
      nodes.push(panel(g, x, y, w, 500, g.panel, { radius: K.radius }));
      nodes.push(rect(x, y, w, 4, { angle: 90, stops: [[g.accent, 0], [g.accent2, 1]] }));
      const rows = [["99.98%", "Platform uptime, trailing 90 days"], ["4.6 / day", "Production deploys"], ["−38%", "P95 latency, quarter over quarter"]];
      rows.forEach(([n, l], k) => {
        const ry = y + 44 + k * 150;
        nodes.push(text(x + 40, ry, w - 80, 70, n, t.numeral(60, { family: K.mono ?? K.display, weight: 700 })));
        nodes.push(text(x + 40, ry + 78, w - 80, 30, l, t.body(20)));
        if (k < rows.length - 1) nodes.push(rect(x + 40, ry + 124, w - 80, 1, g.line));
      });
      break;
    }
    case "blocks":
      nodes.push(rect(1272, 0, 648, H, g.accent, { bleed: true }));
      nodes.push(ellipse(1120, 500, 520, 520, g.ink));
      nodes.push(ellipse(1180, 560, 400, 400, g.bg));
      nodes.push(text(1330, 96, 500, 60, "2026", t.display(52, { color: g.ink, align: "right" })));
      break;
    default:
      break;
  }
  return { page: { name: "Cover", bg: g.bg, nodes }, fill };
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
    nodes.push(text(M + 1060, y + 10, 140, 30, d, t.meta({ align: "right" })));
    nodes.push(rect(M, y + rowH - 12, 1204, 1, g.line));
  });
  // The session card.
  const cx = 1396, cy = bodyTop, cw = 428, ch = 560;
  nodes.push(panel(g, cx, cy, cw, ch, g.panel, { radius: K.radius }));
  nodes.push(text(cx + 40, cy + 40, cw - 80, 28, "Today", t.eyebrow()));
  nodes.push(text(cx + 40, cy + 80, cw - 80, 120, "14 Oct", t.display(76)));
  const meta = [["Time", "09:30 to 10:30"], ["Room", "Boardroom, level 4"], ["Host", "Dana Whitfield"], ["Notes", "Shared after the session"]];
  meta.forEach(([l, v], k) => {
    const my = cy + 236 + k * 74;
    nodes.push(text(cx + 40, my, 120, 26, l, t.meta()));
    nodes.push(text(cx + 40, my + 28, cw - 80, 30, v, t.strong(22)));
    if (k < meta.length - 1) nodes.push(rect(cx + 40, my + 64, cw - 80, 1, g.line));
  });
  return { page: { name: "Agenda", bg: g.bg, nodes } };
}

function section(K, i, n = "02", title = "What we learned", blurb = "Three findings from the year that change how we plan the next one.") {
  const g = K.deep;
  const t = type(K, g);
  const nodes = [...ornamentDeep(K, g)];
  if (K.ornament === "blocks") {
    nodes.push(rect(0, 0, 360, H, g.accent, { bleed: true }));
    nodes.push(text(48, 300, 300, 260, n, t.display(K.scale.section, { color: g.ink, align: "left" })));
    nodes.push(text(460, 380, 1300, 260, title, t.display(96, { lineHeight: 1.04 })));
    nodes.push(text(460, 680, 980, 90, blurb, t.body(28)));
  } else {
    nodes.push(text(M, 236, 800, K.scale.section + 20, n, t.numeral(K.scale.section)));
    nodes.push(text(M, 236 + K.scale.section + 48, 1400, 220, title, t.display(96, { lineHeight: 1.04 })));
    nodes.push(text(M, 236 + K.scale.section + 48 + 232, 980, 90, blurb, t.body(28)));
    nodes.push(rect(M, 236 + K.scale.section + 20, 120, 4, g.accent));
  }
  nodes.push(...footer(K, g, i));
  return { page: { name: "Section", bg: g.bg, nodes } };
}

function statement(K, i) {
  const g = K.paper;
  const t = type(K, g);
  const nodes = [...ornamentPaper(K, g), ...footer(K, g, i)];
  nodes.push(rect(M, 250, 120, 6, g.accent));
  nodes.push(text(M, 296, 1560, Math.round(K.scale.statement * 1.12 * 3) + 10, "Growth that we can explain is the only kind we want to keep.", t.display(K.scale.statement, { lineHeight: 1.1 })));
  nodes.push(text(M, 296 + Math.round(K.scale.statement * 1.12 * 3) + 50, 1000, 32, "Dana Whitfield, in the FY2026 letter to partners", t.meta()));
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
    nodes.push(ellipse(M, y + 12, 18, 18, g.accent));
    nodes.push(text(M + 48, y, 840, 44, h, t.display(32)));
    nodes.push(text(M + 48, y + 52, 840, 70, s, t.body(22)));
  });
  nodes.push(photo(1080, 196, 744, 740, { angle: 160, stops: [[g.panel2, 0], [g.panel, 1]] }, { radius: K.radius * 1.5 }));
  return { page: { name: "Text and picture", bg: g.bg, nodes } };
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
    { x: M, g, ty: t, eyebrow: "Before", head: "Every team ran its own playbook", lines: ["Four onboarding flows, none shared", "Handoffs lost a day at every step", "Nobody owned the number"] },
    { x: M + colW + 32, g: d, ty: td, eyebrow: "After", head: "One playbook, one owner", lines: ["A single flow every team adopts", "Handoffs measured and cut to hours", "One dashboard, one accountable lead"] },
  ];
  cols.forEach((c) => {
    nodes.push(panel(c.g, c.x, y, colW, h, c.g === g ? g.panel : d.bg, { radius: K.radius }));
    nodes.push(text(c.x + 48, y + 48, colW - 96, 28, c.eyebrow, c.ty.eyebrow()));
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
  cards.forEach(([ic, head, body], k) => {
    const x = M + k * (cw + 24);
    nodes.push(panel(g, x, y, cw, h, g.panel, { radius: K.radius }));
    nodes.push(ellipse(x + 40, y + 40, 80, 80, mixHex(g.panel, g.accent, 0.18)));
    nodes.push(icon(ic, x + 60, y + 60, 40, g.accent));
    nodes.push(text(x + 40, y + 156, cw - 80, 100, head, t.display(34, { lineHeight: 1.1 })));
    nodes.push(text(x + 40, y + 268, cw - 80, 160, body, t.body(22)));
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
    nodes.push(panel(g, x, y, cw, h, g.panel, { radius: K.radius }));
    nodes.push(text(x + 36, y + 56, cw - 72, K.scale.numeral + 16, n, t.numeral(K.scale.numeral * (n.length > 5 ? 0.8 : 1))));
    nodes.push(text(x + 36, y + 196, cw - 72, 34, l, t.strong(24)));
    nodes.push(button(x + 36, y + 250, 190, 40, d, { fill: mixHex(g.panel, g.accent, 0.16), color: g.accent, family: K.body, size: 17, weight: 700 }));
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
  if (dark) nodes.push(panel(g, cx - 32, cy - 24, cw + 64, ch + 48, "#F3F5F9", { radius: K.radius }));
  nodes.push({
    kind: "chart", x: cx, y: cy, w: cw, h: ch, chartType: "barGrouped", fontSize: 18,
    categories: ["Q1", "Q2", "Q3", "Q4"],
    series: [
      { name: "New business", values: [2.1, 2.4, 2.6, 3.0], color: dark ? "#1F2A44" : mixHex(g.ink, g.bg, 0.15) },
      { name: "Expansion", values: [1.8, 2.7, 3.4, 4.2], color: g.accent },
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
    nodes.push(ellipse(x, y, 88, 88, k === 0 ? g.accent : d.bg));
    nodes.push(text(x, y, 88, 88, String(k + 1), { family: K.display, size: 34, weight: K.dw, color: d.ink, align: "center", vAlign: "middle", lineHeight: 1 }));
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
  nodes.push(rect(x0, y0, CW, headH, d.bg, { radius: K.radius ? Math.min(K.radius, 12) : 0 }));
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
  people.forEach(([n, r, b], k) => {
    const x = M + k * (cw + 24);
    nodes.push(photo(x + (cw - 220) / 2, y, 220, 220, { angle: 160, stops: [[g.panel2, 0], [g.panel, 1]] }, { shape: "ellipse" }));
    nodes.push(text(x, y + 252, cw, 40, n, t.display(30, { align: "center" })));
    nodes.push(text(x, y + 298, cw, 28, r, t.eyebrow({ align: "center", size: 17 })));
    nodes.push(text(x + 24, y + 344, cw - 48, 96, b, t.body(21, { align: "center" })));
  });
  return { page: { name: "Team", bg: g.bg, nodes } };
}

function quote(K, i) {
  const g = K.deep;
  const t = type(K, g);
  const nodes = [...ornamentDeep(K, g), ...footer(K, g, i)];
  nodes.push(text(M, 180, 260, 260, "“", t.numeral(280, { lineHeight: 1 })));
  nodes.push(text(M + 20, 400, 1560, Math.round(K.scale.quote * 1.3 * 3) + 10, "They did not sell us software. They showed us the number we were losing every week, and then made it stop.", t.display(K.scale.quote, { lineHeight: 1.26, weight: K.display === "Fraunces" ? 400 : K.dw })));
  const ay = 400 + Math.round(K.scale.quote * 1.3 * 3) + 60;
  nodes.push(photo(M + 20, ay, 80, 80, g.panel2, { shape: "ellipse" }));
  nodes.push(text(M + 124, ay + 8, 800, 32, "Rowan Achebe", t.strong(24)));
  nodes.push(text(M + 124, ay + 44, 800, 28, "Chief Financial Officer, Brightline Logistics", t.body(20)));
  return { page: { name: "Quote", bg: g.bg, nodes } };
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
    nodes.push(hot ? panel(d, x, y, cw, h, d.bg, { radius: K.radius }) : panel(g, x, y, cw, h, g.bg, { radius: K.radius, stroke: g.line, strokeWidth: 2 }));
    if (hot) nodes.push(button(x + cw - 200, y + 32, 160, 36, "Most chosen", { fill: gg.accent, color: gg.bg === "#2A2AFF" || isDark(gg.accent) ? gg.ink : d.bg, family: K.body, size: 15, weight: 700, upper: true, letterSpacing: 1 }));
    nodes.push(text(x + 40, y + 40, cw - 80, 28, name, tt.eyebrow()));
    nodes.push(text(x + 40, y + 84, cw - 80, 90, price, tt.display(72)));
    nodes.push(text(x + 40, y + 180, cw - 80, 28, per, tt.body(20)));
    nodes.push(rect(x + 40, y + 232, cw - 80, 1, gg.line));
    feats.forEach((f, j) => {
      const fy = y + 264 + j * 56;
      nodes.push(icon("circle-check", x + 40, fy, 26, gg.accent));
      nodes.push(text(x + 84, fy - 2, cw - 124, 32, f, tt.strong(22, { weight: 500 })));
    });
    nodes.push(button(x + 40, y + h - 100, cw - 80, 60, hot ? "Start with Team" : "Choose " + name, { fill: hot ? gg.accent : d.bg, color: hot && !isDark(gg.accent) ? d.bg : d.ink, family: K.body, size: 20, weight: 700, radius: K.radius ? Math.min(K.radius, 30) : 0 }));
  });
  return { page: { name: "Pricing", bg: g.bg, nodes } };
}

function closing(K, i) {
  const g = K.deep;
  const t = type(K, g);
  const nodes = [...ornamentDeep(K, g, { mark: true })];
  const fill = [];
  if (K.ornament === "blocks") {
    nodes.push(rect(1272, 0, 648, H, g.accent, { bleed: true }));
    nodes.push(ellipse(1360, 300, 480, 480, g.ink));
    nodes.push(ellipse(1420, 360, 360, 360, g.bg));
  }
  nodes.push(rect(M, M, 22, 22, g.accent, { radius: K.radius ? 6 : 0 }));
  nodes.push(text(M + 36, M - 3, 700, 30, K.company, t.strong(22)));
  nodes.push(text(M, 300, 1100, Math.round(K.scale.cover * 1.1) + 10, "Thank you", t.display(K.scale.cover)));
  nodes.push(text(M, 300 + Math.round(K.scale.cover * 1.1) + 34, 940, 84, "Questions now, or any time this week. The deck and the model are in the shared folder.", t.body(28)));
  const rows = [["mail", "dana@halcyon.example"], ["world", "halcyon.example"], ["phone", "+1 415 555 0142"]];
  rows.forEach(([ic, v], k) => {
    const y = 700 + k * 62;
    nodes.push(icon(ic, M, y + 2, 28, g.accent));
    nodes.push(text(M + 48, y, 800, 34, v, t.strong(24, { weight: 500 })));
    fill.push({ node: nodes.length - 1, label: ["Email", "Website", "Phone"][k], hint: "Contact detail" });
  });
  nodes.push(button(M, 910, 340, 64, "Book a follow-up", { fill: g.accent, color: isDark(g.accent) ? g.ink : K.deep.bg, family: K.body, size: 22, weight: 700, radius: K.radius ? Math.min(K.radius, 32) : 0 }));
  nodes.push(text(W - M - 240, 940, 240, 28, pageNo(i), t.meta({ align: "right" })));
  return { page: { name: "Closing", bg: g.bg, nodes }, fill };
}

/** Relative luminance below a mid grey. */
function isDark(hex) {
  const h = hex.replace("#", "");
  const c = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
  return 0.2126 * c(0) + 0.7152 * c(2) + 0.0722 * c(4) < 0.4;
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
      ...(K.mono ? [{ role: "label", family: K.mono, weight: 500 }] : []),
    ],
    pages,
    fillable,
    version: 1,
    created: "2026-09-29T00:00:00.000Z",
    rank: K.rank,
  };
  writeFileSync(join(OUT, `${K.id}.json`), JSON.stringify(spec, null, 1) + "\n");
  console.log(`${K.id}: ${pages.length} slides, ${pages.reduce((n, p) => n + p.nodes.length, 0)} nodes`);
}
