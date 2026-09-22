// The design system a generated deck is composed from.
//
// A deck used to carry two colors and, when a brand supplied them, two fonts.
// Everything else the composer painted was hardcoded per call site, which is
// why every generated deck looked like the same scaffolding in a different
// hue. A designer starts the other way round: decide the system, then derive
// every slide from it. This module is that decision, made once per deck and
// handed to every archetype.
//
// Six color slots (the same six the theme catalog and the file's theme record
// use), a spacing unit everything is a multiple of, a grid, one radius, one
// rule weight, and a type pairing. Inks are fixed to AA against the ground
// they sit on, so nothing downstream has to think about contrast again.
//
// Pure and deterministic: the same theme and size always produce the same
// system, on the client and under goja alike.

import { contrastRatio, fixToAA, fromHex, hslToRgb, rgbToHsl, toHex } from "@hc/color";
import type { Color, Fill } from "@hc/schema";
import type { DeckTheme } from "./outline";
import type { ThemeCatalogEntry } from "./themeCatalog";
import { themeCatalog } from "./themeCatalog";

const WHITE: Color = { srgb: { r: 1, g: 1, b: 1, a: 1 } };
const BLACK: Color = { srgb: { r: 0, g: 0, b: 0, a: 1 } };

export interface DesignSystemColors {
  /** The deck's deep ground, for impact pages. */
  deep: Color;
  /** The deck's main hue, for large color blocks and the impact gradient. */
  primary: Color;
  /** The one color allowed to be loud: rules, markers, numerals. */
  accent: Color;
  /** A pale wash of the hue, for image stand-ins and quiet panels on paper. */
  tint: Color;
  /** Reading ink on paper. */
  ink: Color;
  /** The reading ground. */
  paper: Color;
  /** Derived, contrast-fixed inks. */
  inkOnDeep: Color;
  mutedOnDeep: Color;
  mutedOnPaper: Color;
  accentOnPaper: Color;
  accentOnDeep: Color;
}

export interface DesignSystem {
  size: { width: number; height: number };
  /** Every distance is a multiple of this; it scales with the page. */
  unit: number;
  margin: number;
  gutter: number;
  columns: 12;
  radius: number;
  rule: number;
  colors: DesignSystemColors;
  fonts: { heading: string; body: string };
  impactBackground: Fill;
  paperBackground: Fill;
  /** The deck title, shown small on reading pages so they belong together. */
  kicker?: string;
  dir: "ltr" | "rtl";
  /** One clause appended to every picture prompt so the deck's pictures read
   *  as a series: the mood the outline named, the palette's tones, one light,
   *  and the rules a slide picture always follows. */
  artDirection: string;
  /** Entrance motion on the composed pages: "subtle" (the default) gives
   *  every element one quiet entrance in reading order; "none" leaves the
   *  deck still. */
  motion: DeckMotion;
}

export type DeckMotion = "subtle" | "none";

/** Type pairings for a deck that arrives with no brand fonts and no catalog
 *  theme. Chosen by seed, never the same one for every deck, and none of them
 *  the one face everything generated tends to default to. */
const PAIRINGS: { heading: string; body: string }[] = [
  { heading: "Fraunces", body: "Nunito" },
  { heading: "Playfair Display", body: "Source Sans 3" },
  { heading: "DM Serif Display", body: "DM Sans" },
  { heading: "Outfit", body: "Work Sans" },
  { heading: "Merriweather", body: "Source Sans 3" },
  { heading: "Plus Jakarta Sans", body: "Plus Jakarta Sans" },
  { heading: "Lora", body: "Nunito" },
  { heading: "Montserrat", body: "Inter" },
];

function mix(a: Color, b: Color, t: number): Color {
  const l = (x: number, y: number) => x + (y - x) * t;
  return { srgb: { r: l(a.srgb.r, b.srgb.r), g: l(a.srgb.g, b.srgb.g), b: l(a.srgb.b, b.srgb.b), a: 1 } };
}

function withLightness(c: Color, l: number, sMin = 0): Color {
  const hsl = rgbToHsl(c);
  return hslToRgb({ h: hsl.h, s: Math.max(hsl.s, sMin), l, a: 1 });
}

/** The ink that reads best on a ground, nudged to AA against it. */
function inkFor(ground: Color): Color {
  const base = contrastRatio(WHITE, ground) >= contrastRatio(BLACK, ground) ? WHITE : BLACK;
  return fixToAA(base, ground);
}

/** A secondary ink: the primary ink pulled toward the ground, but kept at
 *  4.5:1 so captions and kickers stay legible rather than merely tasteful. */
function mutedFor(ink: Color, ground: Color): Color {
  let out = mix(ink, ground, 0.35);
  if (contrastRatio(out, ground) < 4.5) out = fixToAA(out, ground);
  return out;
}

/** An accent that stays the deck's hue but clears the ground it sits on. */
function accentFor(seed: Color, ground: Color, onDark: boolean): Color {
  const hsl = rgbToHsl(seed);
  let out = hslToRgb({
    h: hsl.h,
    s: Math.min(1, Math.max(hsl.s, 0.5)),
    l: onDark ? Math.max(0.6, Math.min(0.75, hsl.l + 0.3)) : Math.min(0.5, Math.max(0.32, hsl.l)),
    a: 1,
  });
  // Large text threshold: an accent carries rules and numerals, never body.
  if (contrastRatio(out, ground) < 3) out = fixToAA(out, ground);
  return out;
}

/** A plain name for a color's hue family, for prompts a picture model reads.
 *  Low saturation is a neutral whatever its hue; very light and very dark
 *  colors are named by tone. */
export function hueName(c: Color): string {
  const { h, s, l } = rgbToHsl(c);
  if (l >= 0.92) return "off-white";
  if (l <= 0.12) return "near-black";
  if (s < 0.12) return l > 0.5 ? "light grey" : "charcoal";
  const deg = ((h % 360) + 360) % 360;
  const name =
    deg < 15 ? "red" : deg < 40 ? "orange" : deg < 60 ? "amber" : deg < 75 ? "yellow" :
    deg < 100 ? "lime" : deg < 160 ? "green" : deg < 185 ? "teal" : deg < 205 ? "cyan" :
    deg < 250 ? "blue" : deg < 275 ? "indigo" : deg < 300 ? "violet" : deg < 335 ? "magenta" : deg < 345 ? "pink" : "red";
  if (l < 0.3) return `deep ${name}`;
  if (l > 0.72) return `pale ${name}`;
  return name;
}

/** The art direction clause for a deck's pictures: the outline's mood, the
 *  palette's two hue families, one consistent light, and the constraints every
 *  slide picture obeys. Deterministic, so the two doors write the same clause. */
export function artDirectionFor(mood: string | undefined, colors: { primary: Color; accent: Color; deep: Color }): string {
  const moodWords = (mood ?? "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2)
    .slice(0, 4);
  const tones = Array.from(new Set([hueName(colors.primary), hueName(colors.accent)])).join(" and ");
  const parts = [
    "one consistent series across the deck",
    moodWords.length ? `${moodWords.join(", ")} mood` : "",
    `${tones} tones in the palette`,
    "soft directional light, uncluttered composition, generous negative space for text",
    "no text, no logos, no watermarks, no borders",
  ].filter(Boolean);
  return parts.join(", ");
}

/** Choose a catalog entry deterministically from a seed. */
export function catalogEntryForSeed(seed: number): ThemeCatalogEntry {
  const n = themeCatalog.length;
  const i = ((Math.floor(seed) % n) + n) % n;
  return themeCatalog[i];
}

/** Words that point at a catalog style group. Scored by hits; the first group
 *  in this order wins a tie, so a phrase like "clean, energetic" lands on
 *  bold rather than minimal: the stronger descriptor decides. */
const MOOD_WORDS: Array<[ThemeCatalogEntry["style"], string[]]> = [
  ["dark", ["dark", "night", "luxury", "premium", "black", "noir", "midnight", "moody", "cinematic"]],
  ["tech", ["tech", "technology", "software", "data", "digital", "ai", "cloud", "startup", "engineering", "cyber", "platform", "saas"]],
  ["bold", ["bold", "energy", "energetic", "launch", "vibrant", "loud", "punchy", "dynamic", "optimistic", "sport", "youth"]],
  ["warm", ["warm", "friendly", "community", "human", "cozy", "hospitality", "food", "family", "care", "wellness", "school", "celebration", "joy", "festive"]],
  ["editorial", ["editorial", "story", "magazine", "narrative", "culture", "literary", "heritage", "craft", "history", "art"]],
  ["minimal", ["minimal", "minimalist", "clean", "quiet", "calm", "simple", "restrained", "understated", "serene", "elegant"]],
];

/** Choose a catalog entry from the outline's own mood phrase, deterministically.
 *
 *  The model already returns a short mood for every deck ("clean, optimistic,
 *  energy") and until now nothing read it. Matching it to a style group and
 *  picking within the group by seed turns that phrase into the palette and
 *  pairing, which is the cheapest design decision in the pipeline: no model
 *  call, and a school function stops coming out in a boardroom slate. A
 *  phrase with no recognizable words falls back to the seed alone. */
export function catalogEntryForMood(mood: string, seed: number): ThemeCatalogEntry {
  const words = new Set(
    mood
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter(Boolean),
  );
  let best: ThemeCatalogEntry["style"] | null = null;
  let bestHits = 0;
  for (const [group, keys] of MOOD_WORDS) {
    const hits = keys.reduce((n, k) => n + (words.has(k) ? 1 : 0), 0);
    if (hits > bestHits) {
      best = group;
      bestHits = hits;
    }
  }
  if (!best) return catalogEntryForSeed(seed);
  const pool = themeCatalog.filter((e) => e.style === best);
  if (!pool.length) return catalogEntryForSeed(seed);
  const i = ((Math.floor(seed) % pool.length) + pool.length) % pool.length;
  return pool[i];
}

export interface DeriveOptions {
  /** A catalog theme: its six slots are used as-is. */
  catalog?: ThemeCatalogEntry | null;
  /** The outline's own mood phrase ("calm, coastal, restrained"), folded into
   *  the art direction every picture prompt carries. */
  mood?: string;
  /** Entrance motion on the composed pages; defaults to "subtle". */
  motion?: DeckMotion;
  /** Brand colors: the first is the primary, the second (if any) the accent. */
  brandPalette?: string[];
  dir?: "ltr" | "rtl";
  /** Seed for the fallback pairing when no fonts arrive. */
  seed?: number;
}

/** Derive the full system from what a deck knows about itself. Precedence for
 *  color: catalog slots, then brand, then the theme background's own hue; for
 *  fonts: the theme's (brand) fonts, then the catalog pairing, then a seeded
 *  pairing. */
export function deriveDesignSystem(theme: DeckTheme, size: { width: number; height: number }, opts: DeriveOptions = {}): DesignSystem {
  const width = Math.max(1, Math.round(size.width));
  const height = Math.max(1, Math.round(size.height));
  const short = Math.min(width, height);

  // Color slots -----------------------------------------------------------
  let deep: Color, primary: Color, accent: Color, tint: Color, ink: Color, paper: Color;
  const bgColor = fromHex(theme.background.color ?? "#1f2937") ?? { srgb: { r: 0.12, g: 0.16, b: 0.22, a: 1 } };
  const bg2 = theme.background.color2 ? fromHex(theme.background.color2) : null;
  const brand = (opts.brandPalette ?? []).map(fromHex).filter((c): c is Color => !!c);

  if (opts.catalog) {
    const [p, a, d, t, i, pp] = opts.catalog.colors.map((h) => fromHex(h) ?? bgColor);
    primary = p; accent = a; deep = d; tint = t; ink = i; paper = pp;
  } else {
    // The theme background is the deep ground; its second stop (or the
    // first brand color) is the primary hue everything else derives from.
    deep = bgColor;
    primary = brand[0] ?? bg2 ?? withLightness(bgColor, Math.min(0.48, rgbToHsl(bgColor).l + 0.18), 0.35);
    accent = brand[1] ?? withLightness(primary, 0.5, 0.55);
    paper = mix(WHITE, primary, 0.045);
    tint = mix(WHITE, primary, 0.13);
    // Near-black carrying a whisper of the hue: a chosen neutral, not #111.
    ink = mix(withLightness(primary, 0.12, 0.2), BLACK, 0.35);
  }
  // Whatever the source, every ink is fixed against the ground it sits on.
  const inkOnDeep = inkFor(deep);
  const inkOnPaper = contrastRatio(ink, paper) >= 4.5 ? ink : fixToAA(ink, paper);
  const colors: DesignSystemColors = {
    deep, primary, accent, tint, paper,
    ink: inkOnPaper,
    inkOnDeep,
    mutedOnDeep: mutedFor(inkOnDeep, deep),
    mutedOnPaper: mutedFor(inkOnPaper, paper),
    accentOnPaper: accentFor(accent, paper, false),
    accentOnDeep: accentFor(accent, deep, true),
  };

  // Backgrounds -------------------------------------------------------------
  const impactBackground: Fill =
    theme.background.kind === "gradient" && !opts.catalog
      ? ({
          type: "gradient",
          gradient: "linear",
          angle: theme.background.angle ?? 145,
          stops: [
            { position: 0, color: deep },
            { position: 1, color: primary },
          ],
        } as Fill)
      : ({ type: "solid", color: deep } as Fill);
  const paperBackground: Fill = { type: "solid", color: paper } as Fill;

  // Fonts -------------------------------------------------------------------
  const seeded = PAIRINGS[(((opts.seed ?? 0) % PAIRINGS.length) + PAIRINGS.length) % PAIRINGS.length];
  const fonts = {
    heading: theme.fontHeading || opts.catalog?.fontHeading || seeded.heading,
    body: theme.fontBody || opts.catalog?.fontBody || seeded.body,
  };

  // Spacing -----------------------------------------------------------------
  const unit = Math.max(4, Math.round(short * 0.012));
  return {
    size: { width, height },
    unit,
    margin: unit * 6,
    gutter: unit * 2,
    columns: 12,
    radius: Math.round(unit * 0.75),
    rule: Math.max(2, Math.round(unit * 0.35)),
    colors,
    fonts,
    impactBackground,
    paperBackground,
    kicker: theme.kicker,
    dir: opts.dir ?? "ltr",
    artDirection: artDirectionFor(opts.mood, colors),
    motion: opts.motion ?? "subtle",
  };
}

/** The six catalog-order slot hexes of a system, for stamping the file's
 *  theme record so the theme picker shows the palette the deck was painted
 *  with. */
export function designSystemSlots(ds: DesignSystem): [string, string, string, string, string, string] {
  const c = ds.colors;
  return [toHex(c.primary), toHex(c.accent), toHex(c.deep), toHex(c.tint), toHex(c.ink), toHex(c.paper)];
}
