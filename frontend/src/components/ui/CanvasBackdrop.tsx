// Decorative artwork for onboarding and empty states: a faded canvas dot grid,
// soft brand glows, and floating design-tool primitives (a selection frame,
// a pen curve with its anchors, a type tile, swatches, a layout grid, simple
// shapes). Inline SVG in the brand tokens, so it follows INSTANCE_ACCENT.
// Purely decorative (aria-hidden, pointer-events-none); the global
// prefers-reduced-motion guard freezes the float. Render inside a
// `relative overflow-hidden` parent; it positions absolutely to fill it.
import { type ReactNode } from "react";

const INK = "#10172E";
const LINE = "#9aa3b5";

// A slow-floating element. Reuses the app's oc-float keyframe.
function Float({
  className,
  delay = 0,
  duration = 6,
  shadow = false,
  children,
}: {
  className: string;
  delay?: number;
  duration?: number;
  shadow?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`oc-float absolute ${shadow ? "drop-shadow-[0_8px_16px_rgba(15,23,42,0.12)]" : ""} ${className}`}
      style={{ animationDelay: `${delay}s`, animationDuration: `${duration}s` }}
    >
      {children}
    </div>
  );
}

const brand = (step: number) => ({ fill: `var(--color-brand-${step})` });
const brandStroke = (step: number) => ({ stroke: `var(--color-brand-${step})` });

/** A selected frame: a soft card with a dashed selection box and handles. */
function ArtFrame() {
  return (
    <svg width="96" height="78" viewBox="0 0 96 78" fill="none">
      <rect x="10" y="10" width="76" height="58" rx="6" fill="#fff" />
      <rect x="18" y="20" width="34" height="5" rx="2.5" style={brand(300)} />
      <rect x="18" y="31" width="52" height="4" rx="2" fill="#dfe3ec" />
      <rect x="18" y="40" width="44" height="4" rx="2" fill="#dfe3ec" />
      <rect x="10" y="10" width="76" height="58" rx="6" strokeWidth="1.6" strokeDasharray="4 3" style={brandStroke(600)} />
      {[[10, 10], [86, 10], [10, 68], [86, 68]].map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x - 3.5} y={y - 3.5} width="7" height="7" rx="1.5" fill="#fff" strokeWidth="1.6" style={brandStroke(600)} />
      ))}
    </svg>
  );
}

/** A pen-tool curve with its anchor points and one handle pair. */
function ArtPen() {
  return (
    <svg width="104" height="64" viewBox="0 0 104 64" fill="none">
      <path d="M8 52C26 52 30 12 52 12S78 52 96 52" strokeWidth="3.2" strokeLinecap="round" style={brandStroke(500)} />
      <path d="M36 12H68" stroke={LINE} strokeWidth="1.4" />
      <circle cx="36" cy="12" r="3" fill="#fff" stroke={LINE} strokeWidth="1.4" />
      <circle cx="68" cy="12" r="3" fill="#fff" stroke={LINE} strokeWidth="1.4" />
      {[[8, 52], [52, 12], [96, 52]].map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x - 4} y={y - 4} width="8" height="8" rx="1.5" fill="#fff" strokeWidth="1.8" style={brandStroke(700)} />
      ))}
    </svg>
  );
}

/** A type specimen tile. */
function ArtType() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
      <rect x="4" y="4" width="56" height="56" rx="12" fill="#fff" />
      <text x="32" y="42" textAnchor="middle" fontFamily="Georgia, serif" fontSize="26" fontWeight="700" fill={INK}>Aa</text>
      <rect x="16" y="48" width="32" height="3" rx="1.5" style={brand(400)} />
    </svg>
  );
}

/** Three overlapping color swatches. */
function ArtSwatches() {
  return (
    <svg width="84" height="48" viewBox="0 0 84 48" fill="none">
      <rect x="4" y="6" width="36" height="36" rx="9" style={brand(700)} />
      <rect x="24" y="6" width="36" height="36" rx="9" stroke="#fff" strokeWidth="3" style={brand(500)} />
      <rect x="44" y="6" width="36" height="36" rx="9" stroke="#fff" strokeWidth="3" style={brand(300)} />
    </svg>
  );
}

/** A small layout grid (a page of blocks). */
function ArtLayout() {
  return (
    <svg width="70" height="86" viewBox="0 0 70 86" fill="none">
      <rect x="3" y="3" width="64" height="80" rx="6" fill="#fff" />
      <rect x="11" y="11" width="48" height="26" rx="3" style={brand(200)} />
      <rect x="11" y="43" width="22" height="16" rx="3" style={brand(100)} />
      <rect x="37" y="43" width="22" height="16" rx="3" style={brand(100)} />
      <rect x="11" y="65" width="48" height="4" rx="2" fill="#dfe3ec" />
      <rect x="11" y="73" width="30" height="4" rx="2" fill="#dfe3ec" />
    </svg>
  );
}

function ArtCircle() {
  return (
    <svg width="46" height="46" viewBox="0 0 46 46" fill="none">
      <circle cx="23" cy="23" r="17" style={brand(400)} opacity="0.85" />
      <circle cx="23" cy="23" r="21" strokeWidth="1.6" style={brandStroke(600)} />
    </svg>
  );
}

function ArtTriangle() {
  return (
    <svg width="44" height="40" viewBox="0 0 44 40" fill="none">
      <path d="M22 5L39 34H5Z" strokeLinejoin="round" strokeWidth="3" style={{ ...brandStroke(700), fill: "var(--color-brand-100)" }} />
    </svg>
  );
}

/** A tiny four-point spark. */
function ArtSpark({ step = 500 }: { step?: number }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <path d="M9 1L10.6 7.4L17 9L10.6 10.6L9 17L7.4 10.6L1 9L7.4 7.4Z" style={brand(step)} />
    </svg>
  );
}

function Glows() {
  return (
    <>
      <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-brand-400/30 blur-3xl" />
      <div className="absolute -bottom-32 -right-24 h-[28rem] w-[28rem] rounded-full bg-accent-400/25 blur-3xl" />
      <div className="absolute left-1/2 top-1/4 h-80 w-80 -translate-x-1/2 rounded-full bg-brand-200/30 blur-3xl" />
    </>
  );
}

/** The decorative scene. `compact` shows a lighter subset (e.g. behind the
 *  narrower sign-in form); the full scene is the wide accept-invite backdrop. */
export function CanvasBackdrop({ compact = false }: { compact?: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <Glows />

      {/* canvas dot grid, faded toward the edges */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(color-mix(in srgb, var(--color-brand-600) 12%, transparent) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
          maskImage: "radial-gradient(ellipse 62% 62% at 50% 45%, black 0%, transparent 80%)",
          WebkitMaskImage: "radial-gradient(ellipse 62% 62% at 50% 45%, black 0%, transparent 80%)",
        }}
      />

      <Float className="left-[9%] top-[14%] -rotate-6" duration={7} shadow>
        <ArtFrame />
      </Float>
      <Float className="right-[9%] top-[12%] rotate-6 hidden sm:block" delay={1.1} duration={8} shadow>
        <ArtSwatches />
      </Float>
      <Float className="left-[11%] bottom-[14%] rotate-3" delay={0.6} duration={9}>
        <ArtPen />
      </Float>
      <Float className="right-[10%] bottom-[16%] -rotate-6 hidden sm:block" delay={1.5} duration={8.5} shadow>
        <ArtType />
      </Float>
      <Float className="left-[6%] top-[46%] hidden sm:block" delay={0.9} duration={7.5}>
        <ArtCircle />
      </Float>
      <Float className="right-[15%] top-[42%] hidden sm:block" delay={1.3} duration={8}>
        <ArtTriangle />
      </Float>
      <Float className="left-[28%] top-[8%]" delay={0.3} duration={6.5}>
        <ArtSpark />
      </Float>
      <Float className="right-[26%] bottom-[26%]" delay={1.9} duration={7}>
        <ArtSpark step={300} />
      </Float>

      {!compact && (
        <>
          <Float className="left-[20%] bottom-[30%] -rotate-3 hidden lg:block" delay={0.8} duration={8} shadow>
            <ArtLayout />
          </Float>
          <Float className="right-[22%] top-[22%] hidden lg:block" delay={1.6} duration={7.5}>
            <ArtSpark step={700} />
          </Float>
        </>
      )}
    </div>
  );
}

/** A tight, contained art cluster for the dashboard hero's right edge, fading
 *  into the gradient toward the headline (left). */
export function HeroArt() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 right-0 hidden w-[22rem] overflow-hidden md:block"
      style={{
        maskImage: "linear-gradient(to right, transparent 0%, black 42%)",
        WebkitMaskImage: "linear-gradient(to right, transparent 0%, black 42%)",
      }}
    >
      <Float className="right-[6%] top-[14%] -rotate-6" duration={7} shadow>
        <ArtFrame />
      </Float>
      <Float className="right-[40%] top-[48%] rotate-3" delay={0.6} duration={8}>
        <ArtPen />
      </Float>
      <Float className="right-[44%] top-[12%]" delay={0.3} duration={6.5}>
        <ArtSpark />
      </Float>
      <Float className="right-[8%] bottom-[12%]" delay={1.4} duration={7}>
        <ArtCircle />
      </Float>
    </div>
  );
}

/** Bottom backdrop for the dashboard left rail: a soft brand glow rising from
 *  the floor with a small cluster of primitives. Absolutely positioned and
 *  pointer-events-none; the rail it lives in must be `relative`. */
export function RailArt() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 overflow-hidden dark:opacity-40">
      <div className="absolute inset-0 bg-gradient-to-t from-brand-50/80 via-brand-50/20 to-transparent" />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(color-mix(in srgb, var(--color-brand-500) 11%, transparent) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
          maskImage: "linear-gradient(to top, black 30%, transparent 92%)",
          WebkitMaskImage: "linear-gradient(to top, black 30%, transparent 92%)",
        }}
      />
      <Float className="left-12 bottom-40" delay={0.3} duration={6.5}>
        <ArtSpark />
      </Float>
      <Float className="right-14 bottom-44" delay={0.7} duration={7.5}>
        <ArtSpark step={300} />
      </Float>
      <Float className="left-3 bottom-16 -rotate-6" delay={0.6} duration={9} shadow>
        <ArtSwatches />
      </Float>
      <Float className="left-1/2 bottom-2 -translate-x-1/2 rotate-2" duration={8} shadow>
        <ArtLayout />
      </Float>
    </div>
  );
}

/** A small centered still-life for empty panels (no designs / no favorites). */
export function EmptyArt() {
  return (
    <div aria-hidden className="mb-5 flex items-end justify-center gap-3 opacity-95">
      <div className="-rotate-6">
        <ArtSwatches />
      </div>
      <div className="rotate-2">
        <ArtLayout />
      </div>
      <div className="rotate-6">
        <ArtType />
      </div>
    </div>
  );
}
