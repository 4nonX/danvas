import { tr } from "@/lib/i18n";
// Brand loading state: the animated danvas mark (brand asset
// /brand/loader.svg; the stem draws, the bowl closes, the handle snaps in, on
// a 2.4s loop, resting complete under prefers-reduced-motion). The SVG's CSS
// animation runs fine inside an <img>.

export function BrandLoader({ size = 104, label }: { size?: number; label?: string }) {
  return (
    <span className="inline-flex flex-col items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/loader.svg" width={size} height={size} alt="" aria-hidden />
      <span role="status" className="text-sm text-neutral-500">
        {label ?? tr("ui.loading")}
      </span>
    </span>
  );
}

/** Full-viewport centered loader for app boot / auth resolution. */
export function FullScreenLoader({ label }: { label?: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-neutral-50">
      <BrandLoader label={label} />
    </div>
  );
}
