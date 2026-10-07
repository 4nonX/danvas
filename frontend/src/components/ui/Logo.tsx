// danvas logo mark: a geometric lowercase "d" (round bowl plus stem) with a
// small square selection handle, the one detail that says "design tool".
// Single color, drawn with currentColor so it recolors per surface: paper on
// the gradient tile, ink on light surfaces. Static copies for non-React
// surfaces (favicon, PWA icons, loader) live in /public/brand.

import { cn } from "@/lib/cn";
import { tr } from "@/lib/i18n";

// The mark's "paper" tone on the gradient tile (part of the logo asset, not
// the app accent system).
const PAPER = "#F7F9FF";

/** The bare danvas mark, in currentColor. viewBox is 48x48. */
export function BrandMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" className={className}>
      <circle cx="19" cy="29" r="10" stroke="currentColor" strokeWidth="5" />
      <path d="M29 7V39" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <rect x="35" y="35" width="7" height="7" rx="1.6" fill="currentColor" />
    </svg>
  );
}

export function LogoMark({ size = 32, variant = "gradient" }: { size?: number; variant?: "gradient" | "light" }) {
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center", variant === "gradient" ? "oc-gradient" : "bg-white/20")}
      // The official tile radius is 22% of the tile edge.
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.22), color: PAPER }}
    >
      <BrandMark size={size * 0.62} />
    </span>
  );
}

export function Logo({
  size = 32,
  variant = "gradient",
  className,
}: {
  size?: number;
  variant?: "gradient" | "light";
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2.5 text-lg font-extrabold tracking-tight", className)}>
      <LogoMark size={size} variant={variant} />
      {variant === "light" ? <span className="text-white">{tr("ui.hycanvas")}</span> : <span className="oc-gradient-text">{tr("ui.hycanvas")}</span>}
    </span>
  );
}
