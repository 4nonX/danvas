// HyCanvas brand theme: the SINGLE SOURCE OF TRUTH for product/app colors.
//
// To rebrand the whole app, edit the values here and run `npm run gen:theme`
// (the frontend build runs it automatically). The generator writes the CSS
// tokens into src/styles/globals.css (and, in later phases, the canvas/engine
// theme and the Go presence palette), so you change colors in ONE place.
//
// This is the PRODUCT accent (the app shell). It is intentionally separate from
// the per-workspace Brand Kit, which themes user design content, not the app.
//
// Plain ESM (no types, no deps) so both Node (the generator) and the Next app
// can import it. Hex values are sRGB. Scales follow Tailwind's 50..950 steps.

export const theme = {
  // App accent: the danvas cobalt (brand-600 #2F55D4) with a sky gradient end.
  // A deployment can override it at run time with INSTANCE_ACCENT.
  name: "danvas",

  // Primary brand accent. brand-600 is the main interactive color (buttons,
  // active states); brand-500 drives focus rings. Currently: danvas cobalt.
  brand: {
    50: "#EEF2FD",
    100: "#DCE4FB",
    200: "#B9C9F6",
    300: "#8DA6EE",
    400: "#5F81E4",
    500: "#4068DB",
    600: "#2F55D4",
    700: "#2444AE",
    800: "#1D378B",
    900: "#172C6E",
    950: "#0E1B45",
  },

  // Secondary accent (used sparingly + as the gradient end). Currently cobalt.
  accent: {
    50: "#EEF2FD",
    100: "#DCE4FB",
    200: "#B9C9F6",
    300: "#8DA6EE",
    400: "#5F81E4",
    500: "#4068DB",
    600: "#2F55D4",
    700: "#2444AE",
    800: "#1D378B",
    900: "#172C6E",
    950: "#0E1B45",
  },

  // Identity gradient stops, promoted to first-class tokens (neutral names so
  // they survive any rebrand). `mid` references the brand scale so it tracks the
  // primary automatically. start/end are bespoke so the sweep can be richer than
  // a single scale step. Currently: deep cobalt -> cobalt -> sky.
  gradient: {
    angle: "135deg",
    start: "#2444AE",
    mid: "var(--color-brand-600)",
    end: "#3FA9E0",
  },

  // Dark mode for the APP CHROME only (design content is never themed; the
  // Brand Kit owns that). The app runs light by default; setting `dark` on
  // <html> swaps these token values via the generated `.dark` region in
  // globals.css. `page` is the document background, `surface` the elevated
  // card/popover color (both are white in light mode). The neutral ramp
  // mirrors Tailwind's neutral scale in reverse so the ~2k existing
  // `neutral-*` call sites read correctly on dark without edits. `brand`
  // remaps ONLY the light tint steps (chip/hover/ring backgrounds); solid
  // accent steps (500+) keep their light-mode values so buttons and the
  // gradient stay identical. `brandInk` is the accent TEXT color on chrome
  // (light mode uses brand-700); it exists because text and backgrounds share
  // scale steps and cannot be swapped wholesale.
  // The app's neutral ramp: emitted as the DEFAULT chrome tokens and as the
  // `.light` escape hatch (document surfaces like sheets and present mode pin
  // themselves light even when the app chrome is dark). These are not brand
  // colors.
  //
  // Steps 400 and 500 depart from Tailwind's defaults on purpose. Tailwind's
  // neutral-400 (#a3a3a3) is 2.58:1 on white, and the app uses it for real
  // secondary text (timestamps, hints, counts) at 10-12px, which fails WCAG
  // 1.4.3 AA; a live axe-core scan flagged it on the editor and settings
  // surfaces. Both steps now clear 4.5:1 against every chrome background the
  // app puts text on (white, neutral-50, neutral-100), so secondary text
  // passes AA everywhere by construction rather than per component. Adjust
  // the tone here if it reads too heavy; keep 400 >= 4.5:1 on #f5f5f5.
  neutral: {
    50: "#fafafa",
    100: "#f5f5f5",
    200: "#e5e5e5",
    300: "#d4d4d4",
    400: "#6f6f6f", // AA on white 5.02, neutral-50 4.81, neutral-100 4.61
    500: "#5f5f5f", // stays a step darker than 400
    600: "#525252",
    700: "#404040",
    800: "#262626",
    900: "#171717",
    950: "#0a0a0a",
  },

  dark: {
    page: "#111114",
    surface: "#1b1b20",
    neutral: {
      50: "#161619",
      100: "#1e1e23",
      200: "#2a2a31",
      300: "#3a3a42",
      400: "#8f8f9a",
      500: "#a5a5b0",
      600: "#c2c2cb",
      700: "#d8d8de",
      800: "#e8e8ed",
      900: "#f4f4f6",
      950: "#fbfbfc",
    },
    brand: {
      50: "#141A2E",
      100: "#18213D",
      200: "#1E2B55",
    },
    brandInk: "#8DA6EE",
    // Status colors (red, amber, green, ...): Tailwind's palettes are light
    // ramps, so a warning callout (`bg-amber-50 border-amber-200
    // text-amber-800`) would be a bright patch on the dark chrome. In dark
    // mode the tints become the hue's 500 shade mixed into the page at these
    // strengths (percent), and the inks take the light end of the same ramp
    // (700 shows as 300, ...), so the same classes read right in both themes.
    // 400-600 stay as they are: solid fills, dots and icons work on both.
    status: {
      palettes: ["red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose"],
      tint: { 50: 12, 100: 18, 200: 32, 300: 46 },
      ink: { 700: 300, 800: 200, 900: 100, 950: 50 },
    },
  },

  // High-contrast mode for the APP CHROME only (F38 FR-4), an axis orthogonal
  // to light/dark: the `hc` class on <html> strengthens the same tokens dark
  // mode swaps, so secondary text reaches ~7:1 and borders stop being subtle.
  // `light` (the light-hc ramp, applied by `.hc`) darkens the mid greys that
  // sit around 3:1 on white; `dark` (applied by `.hc.dark`) brightens text
  // toward white and lifts borders. Design content is never restyled: the
  // `.light` escape hatch on document surfaces re-declares its own tokens on a
  // nearer ancestor, so it wins inside those subtrees automatically.
  contrast: {
    light: {
      neutral: {
        50: "#f8f8f8",
        100: "#ededed",
        200: "#bdbdbd",
        300: "#8f8f8f",
        400: "#4f4f4f",
        500: "#454545",
        600: "#333333",
        700: "#232323",
        800: "#141414",
        900: "#000000",
        950: "#000000",
      },
      brandInk: "#172C6E",
    },
    dark: {
      page: "#000000",
      surface: "#0d0d0d",
      neutral: {
        50: "#0d0d0d",
        100: "#161616",
        200: "#3d3d3d",
        300: "#5c5c5c",
        400: "#b3b3b3",
        500: "#cccccc",
        600: "#e0e0e0",
        700: "#ededed",
        800: "#f7f7f7",
        900: "#ffffff",
        950: "#ffffff",
      },
      brandInk: "#B9C9F6",
    },
  },

  // Editor canvas overlay colors. The engine paints to Canvas2D and cannot read
  // CSS, so these are also pushed in as data in a later phase. `selection` is a
  // deliberate cool hue kept DISTINCT from the brand so selections stay legible
  // against brand-colored content (it is not meant to track the accent).
  overlay: {
    selection: "#2563eb",
    guideSubtle: "#3b82f6",
    guideActive: "#06b6d4",
    guideConflict: "#f43f5e",
    penPreview: "#2444AE",
    ruler: "#9ca3af",
  },

  // Collaborator presence palette (assigned per user by a stable hash). Shared
  // with the Go backend via the generator in a later phase. Order is meaningful:
  // changing it reassigns existing users' colors, so append rather than reorder.
  presence: {
    palette: [
      "#ef4444",
      "#f97316",
      "#eab308",
      "#22c55e",
      "#06b6d4",
      "#3b82f6",
      "#8b5cf6",
      "#ec4899",
      "#14b8a6",
      "#a855f7",
    ],
    fallback: "#ef4444",
  },

  // Avatar swatches for collaborators (a distinct rainbow for telling people
  // apart; not brand colors). Centralized here; consumed by lib/avatar.ts.
  avatars: [
    "#e11d48",
    "#ea580c",
    "#d97706",
    "#16a34a",
    "#0891b2",
    "#2563eb",
    "#7c3aed",
    "#db2777",
  ],

  // Engine asset-state colors: a neutral placeholder and an error red for
  // missing/unloaded media. NOT brand colors. The engine (packages/engine
  // render2d.ts) keeps these inline to stay dependency-free and avoid touching
  // its fragile render path; this block is the canonical record and
  // scripts/check-theme-tokens.mjs verifies render2d.ts still matches.
  engine: {
    placeholderFill: "rgba(0, 0, 0, 0.06)",
    placeholderStroke: "rgba(0, 0, 0, 0.25)",
    missingFill: "rgba(220, 38, 38, 0.10)",
    missingStroke: "rgba(220, 38, 38, 0.6)",
  },
};

export default theme;
