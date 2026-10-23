// Color picker field (picker, eyedropper, contrast, CVD, CMYK). A
// swatch-button trigger that opens an HSV popover: saturation/value square, hue
// + alpha sliders, hex/RGB inputs, the print colour (automatic through the
// export's profile, exact CMYK values, or a named spot colour with its own
// plate), a color-vision (CVD) simulation preview, an optional WCAG contrast
// badge (when a background color is supplied), plus brand-palette/recent
// swatches and the screen eyedropper. Colour math comes from @hc/color; exact
// print colours are shown through the bundled ICC profile (lib/print/printColor).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Color } from "@hc/schema";
import {
  toHex, fromHex, rgbToCmyk, gamutCheck, simulateCvd, wcag, type CvdType,
} from "@hc/color";
import { Pipette } from "lucide-react";
import { tr } from "@/lib/i18n";
import { cmykColor, estimateCmyk, loadScreenProof, printColorLabel, spotColor, type Cmyk4 } from "@/lib/print/printColor";

type PrintMode = "auto" | "cmyk" | "spot";
const printModeOf = (c: Color): PrintMode => (c.spot?.name ? "spot" : c.cmyk ? "cmyk" : "auto");

type HSV = { h: number; s: number; v: number };

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function rgbToHsv(c: Color): HSV {
  const { r, g, b } = c.srgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToColor(h: number, s: number, v: number, a: number): Color {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { srgb: { r: r + m, g: g + m, b: b + m, a } };
}

function rgba(c: Color): string {
  const { r, g, b, a } = c.srgb;
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a ?? 1})`;
}

const cvdLabels = (): { v: "" | CvdType; label: string }[] => [
  { v: "", label: "Normal vision" },
  { v: "protanopia", label: tr("editor.protanopia_red_blind") },
  { v: "deuteranopia", label: tr("editor.deuteranopia_green_blind") },
  { v: "tritanopia", label: tr("editor.tritanopia_blue_blind") },
  { v: "achromatopsia", label: tr("editor.achromatopsia_mono") },
];

export interface ColorFieldProps {
  value: Color;
  onChange: (c: Color) => void;
  /** Background color to grade contrast against (shows a WCAG badge). */
  bg?: Color;
  /** Allow editing the alpha channel (default true). */
  allowAlpha?: boolean;
  /** Brand/preset swatches shown as quick picks. */
  palette?: string[];
  /** Recently-used hex swatches. */
  recents?: string[];
  /** Called with the chosen hex so the host can persist a recents list. */
  onRemember?: (hex: string) => void;
  title?: string;
  /** Stretch the trigger to fill its row (default true). */
  block?: boolean;
}

export function ColorField({
  value, onChange, bg, allowAlpha = true, palette, recents, onRemember, title, block = true,
}: ColorFieldProps) {
  const [open, setOpen] = useState(false);
  const [cvd, setCvd] = useState<"" | CvdType>("");
  // The print colour mode follows the value; "spot" may be chosen before a
  // name is typed, so it is also kept while the value has no print data.
  const [printMode, setPrintMode] = useState<PrintMode>(printModeOf(value));
  const [seenMode, setSeenMode] = useState<PrintMode>(printModeOf(value));
  if (seenMode !== printModeOf(value)) { setSeenMode(printModeOf(value)); setPrintMode(printModeOf(value)); }
  const [, setProofReady] = useState(false);
  useEffect(() => {
    if (open) void loadScreenProof().then((c) => setProofReady(!!c));
  }, [open]);
  const wrapRef = useRef<HTMLDivElement>(null);

  // localHue preserves the chosen hue while dragging through grayscale (where
  // the value's hue is undefined). It is updated only in event handlers; when
  // the value is chromatic the hue comes straight from it.
  const { h: valueHue, s, v } = rgbToHsv(value);
  const [localHue, setLocalHue] = useState(valueHue);
  const hue = s > 0.001 && v > 0 ? valueHue : localHue;
  const alpha = value.srgb.a ?? 1;
  const hex = toHex(value).toUpperCase();

  // The popover is fixed-positioned and clamped to the viewport: an absolute
  // popover anchored to the trigger gets clipped by the properties panel's
  // scroll container whenever the trigger sits left of the panel's right edge
  // (the panel is barely wider than the 240px picker). Fixed positioning
  // escapes ancestor overflow clipping for every trigger position.
  const popRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    // Position written imperatively (no state): measuring and placing in the
    // same layout pass avoids a visible jump and re-render loops.
    const place = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      const el = popRef.current;
      if (!r || !el) return;
      const pw = el.offsetWidth || 288;
      const ph = el.offsetHeight || 420;
      // Centered under the trigger, clamped to the viewport.
      const left = Math.min(Math.max(8, r.left + r.width / 2 - pw / 2), Math.max(8, window.innerWidth - pw - 8));
      let top = r.bottom + 6;
      if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.visibility = "visible";
    };
    place();
    // Track ancestor scrolls (capture) and resizes so the popover stays glued
    // to its trigger while the panel scrolls.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const emit = (c: Color) => {
    onChange(c);
    onRemember?.(toHex(c));
  };
  const setHSV = (h: number, ss: number, vv: number) => {
    setLocalHue(h);
    emit(hsvToColor(h, ss, vv, alpha));
  };
  // Opacity keeps a print colour (it prints as a tint of the same values).
  const setAlpha = (a: number) => emit({ ...value, srgb: { ...value.srgb, a } });
  // Print colour: exact CMYK, or a named spot colour with fallback CMYK.
  const baseCmyk = (): Cmyk4 => value.cmyk ?? value.spot?.fallback ?? estimateCmyk(value.srgb);
  const choosePrintMode = (m: PrintMode) => {
    setPrintMode(m);
    if (m === "auto" && (value.cmyk || value.spot)) emit({ srgb: { ...value.srgb } });
    if (m === "cmyk") emit(cmykColor(baseCmyk(), alpha));
  };
  const setPrintChannel = (k: keyof Cmyk4, pct: number) => {
    const next = { ...baseCmyk(), [k]: clamp01(pct / 100) };
    emit(value.spot?.name ? spotColor(value.spot.name, next, alpha) : cmykColor(next, alpha));
  };
  const setSpotName = (name: string) => {
    const n = name.trim();
    if (n) emit(spotColor(n, baseCmyk(), alpha));
  };
  const setHex = (raw: string) => {
    const c = fromHex(raw);
    if (c) emit({ srgb: { ...c.srgb, a: allowAlpha ? alpha : 1 } });
  };
  const setChannel = (k: "r" | "g" | "b", n: number) =>
    emit({ srgb: { ...value.srgb, [k]: clamp01(n / 255) } });

  // SV square pointer dragging.
  const svRef = useRef<HTMLDivElement>(null);
  const onSvPointer = (e: React.PointerEvent) => {
    const el = svRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const move = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      const ns = clamp01((clientX - r.left) / r.width);
      const nv = clamp01(1 - (clientY - r.top) / r.height);
      setHSV(hue, ns, nv);
    };
    move(e.clientX, e.clientY);
    const onMove = (ev: PointerEvent) => move(ev.clientX, ev.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const cmyk = rgbToCmyk(value);
  const inGamut = gamutCheck(value).inGamut;
  const contrast = bg ? wcag(value, bg) : null;
  const preview = cvd ? simulateCvd(value, cvd) : value;

  return (
    // h-full: a caller sizes the swatch by giving the wrapper a height and the
    // swatch h-full ("[&_.oc-color-trigger]:h-full"). Without a height of its
    // own this box left that percentage nothing to resolve against, and the
    // swatch collapsed to its 2 px border. With no height given it stays auto.
    // A swatch of its own fixed size (the toolbar's 24 px circle in a 32 px
    // cell) is centred in that height instead of sitting at the top.
    <div ref={wrapRef} className={`relative h-full items-center justify-center ${block ? "flex flex-1" : "inline-flex"}`}>
      <button
        type="button"
        title={[title ?? tr("editor.edit_color"), printColorLabel(value)].filter(Boolean).join(" · ")}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`oc-color-trigger h-8 ${block ? "w-full" : "w-9"} rounded-lg border border-neutral-200`}
        style={{
          backgroundImage:
            `linear-gradient(${rgba(value)}, ${rgba(value)}), ` +
            "linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%)," +
            "linear-gradient(45deg,#ccc 25%,#fff 25%,#fff 75%,#ccc 75%)",
          backgroundSize: "100% 100%, 10px 10px, 10px 10px",
          backgroundPosition: "0 0, 0 0, 5px 5px",
        }}
      />
      {open && typeof document !== "undefined" && createPortal(
        // Portaled to <body>: inside the toolbar or panels the popover would
        // share their stacking context and slide under canvas overlays.
        <div
          ref={popRef}
          role="dialog"
          aria-label={title ?? tr("editor.edit_color")}
          // Floating: a panel that opened this picker must not take a click
          // in it for a click outside (see isInFloating).
          data-oc-floating=""
          className="fixed z-[1000] w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-neutral-200 bg-surface p-3 shadow-xl"
          style={{ left: -9999, top: -9999, visibility: "hidden" }}
        >
          {/* Saturation / value square */}
          <div
            ref={svRef}
            onPointerDown={onSvPointer}
            className="relative h-36 w-full cursor-crosshair touch-none rounded-lg"
            style={{
              backgroundColor: rgba(hsvToColor(hue, 1, 1, 1)),
              backgroundImage: "linear-gradient(to right,#fff,transparent),linear-gradient(to top,#000,transparent)",
            }}
          >
            <span
              className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.25)]"
              style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: rgba({ srgb: { ...value.srgb, a: 1 } }) }}
            />
          </div>

          {/* Hue + alpha tracks */}
          <div className="mt-3 flex items-center gap-2.5">
            <div className="flex flex-1 flex-col gap-2.5">
              <Track
                label={tr("editor.hue")}
                value={hue / 360}
                onChange={(t) => setHSV(t * 360, Math.max(s, 0.0001), Math.max(v, 0.0001))}
                background="linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)"
                thumb={rgba(hsvToColor(hue, 1, 1, 1))}
              />
              {allowAlpha && (
                <Track
                  label={tr("editor.alpha")}
                  value={alpha}
                  onChange={setAlpha}
                  background={`linear-gradient(to right, ${rgba({ srgb: { ...value.srgb, a: 0 } })}, ${rgba({ srgb: { ...value.srgb, a: 1 } })}), repeating-conic-gradient(#d4d4d4 0 25%, #fff 0 50%) 0 0 / 8px 8px`}
                  thumb={rgba(value)}
                />
              )}
            </div>
            <span
              className="h-9 w-9 shrink-0 rounded-lg border border-neutral-200"
              style={{ background: `linear-gradient(${rgba(value)}, ${rgba(value)}), repeating-conic-gradient(#d4d4d4 0 25%, #fff 0 50%) 0 0 / 8px 8px` }}
              aria-hidden
            />
          </div>

          {/* Hex, R, G, B (+ alpha %) */}
          <div className="mt-3 flex items-end gap-1.5">
            <EyeDropperButton onPick={(h) => setHex(h)} />
            <NumBox label={tr("editor.hex")} wide value={hex} onCommit={setHex} />
            {(["r", "g", "b"] as const).map((k) => (
              <NumBox key={k} label={k.toUpperCase()} value={String(Math.round(value.srgb[k] * 255))} onCommit={(t) => { const n = Number(t); if (Number.isFinite(n)) setChannel(k, Math.max(0, Math.min(255, n))); }} />
            ))}
            {allowAlpha && (
              <NumBox label="%" value={String(Math.round(alpha * 100))} onCommit={(t) => { const n = Number(t); if (Number.isFinite(n)) setAlpha(clamp01(n / 100)); }} />
            )}
          </div>

          {/* Print colour: automatic (through the export's profile), exact
              CMYK, or a spot colour on a plate of its own. */}
          <div className="mt-3 border-t border-neutral-100 pt-2.5">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-neutral-500">{tr("editor.print_ink")}</span>
              <div role="radiogroup" aria-label={tr("editor.print_ink")} className="flex w-full rounded-md bg-neutral-100 p-0.5">
                {(["auto", "cmyk", "spot"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={printMode === m}
                    onClick={() => choosePrintMode(m)}
                    className={`min-w-0 flex-1 truncate rounded px-1.5 py-0.5 text-[10px] font-medium transition ${printMode === m ? "bg-surface text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}
                  >{{ auto: tr("editor.print_color_auto"), cmyk: tr("editor.print_color_cmyk"), spot: tr("editor.print_color_spot") }[m]}</button>
                ))}
              </div>
            </div>
            {printMode === "spot" && (
              <div className="mt-1.5">
                <NumBox label={tr("editor.spot_color_name")} wide text value={value.spot?.name ?? ""} onCommit={setSpotName} />
              </div>
            )}
            {printMode !== "auto" && (
              <>
                <div className="mt-1.5 flex items-end gap-1.5">
                  {(["c", "m", "y", "k"] as const).map((k) => (
                    <NumBox key={k} label={k.toUpperCase()} value={String(Math.round(baseCmyk()[k] * 1000) / 10)} onCommit={(t) => { const n = Number(t.replace(",", ".")); if (Number.isFinite(n)) setPrintChannel(k, Math.max(0, Math.min(100, n))); }} />
                  ))}
                  <span className="pb-1.5 text-[10px] text-neutral-400">%</span>
                </div>
                <p className="mt-1 text-[10px] leading-snug text-neutral-400">
                  {printMode === "spot" ? (value.spot?.name ? tr("editor.spot_color_hint") : tr("editor.spot_color_name_first")) : tr("editor.print_cmyk_hint")}
                </p>
              </>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[10px] text-neutral-500">
            {printMode === "auto" && (
              <span className="font-mono" title="CMYK">CMYK {Math.round(cmyk.c * 100)}/{Math.round(cmyk.m * 100)}/{Math.round(cmyk.y * 100)}/{Math.round(cmyk.k * 100)}</span>
            )}
            {printMode === "auto" && !inGamut && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700" title={tr("editor.outside_cmyk_print_gamut")}>{tr("editor.out_of_gamut")}</span>
            )}
            {contrast && (
              <span className="ms-auto flex items-center gap-1.5">
                <span className="inline-grid h-4 w-4 place-items-center rounded text-[9px] font-bold" style={{ background: rgba(bg!), color: rgba(value) }}>A</span>
                <span className="font-mono">{contrast.ratio.toFixed(1)}:1</span>
                <span className={`rounded px-1 py-0.5 font-medium ${contrast.aaNormal ? "bg-emerald-100 text-emerald-700" : contrast.aaLarge ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>
                  {contrast.aaNormal ? "AA" : contrast.aaLarge ? tr("editor.aa_large") : "fails AA"}
                </span>
              </span>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <select
              value={cvd}
              onChange={(e) => setCvd(e.target.value as "" | CvdType)}
              className="h-7 min-w-0 flex-1 rounded-md border border-neutral-200 bg-surface px-1.5 text-[11px] text-neutral-600 outline-none focus:border-brand-400"
              aria-label={tr("editor.color_vision_simulation")}
            >
              {cvdLabels().map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
            {cvd && (
              <span className="h-7 w-9 shrink-0 rounded-md border border-neutral-200" style={{ background: rgba(preview) }} title={tr("editor.how_this_color_appears_with_the_selected_col")} />
            )}
          </div>

          {/* Palette + recent swatches, one even grid each */}
          {palette?.length ? <SwatchGrid colors={palette} current={hex} onPick={setHex} /> : null}
          {recents?.length ? <SwatchGrid colors={recents.filter((c) => !palette?.includes(c))} current={hex} onPick={setHex} /> : null}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** True when a DOM target lies in a floating picker (the colour popover is
 *  rendered at the end of <body>): a panel's outside-click handler must leave
 *  such clicks alone, or picking a colour closes the panel holding the field
 *  before the click lands. */
export function isInFloating(target: EventTarget | null): boolean {
  return !!(target as Element | null)?.closest?.("[data-oc-floating]");
}

/** A horizontal colour track (hue / alpha) with a round thumb; drag or click. */
function Track({ label, value, onChange, background, thumb }: { label: string; value: number; onChange: (t: number) => void; background: string; thumb: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onPointer = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const move = (x: number) => {
      const r = el.getBoundingClientRect();
      onChange(clamp01((x - r.left) / r.width));
    };
    move(e.clientX);
    const onMove = (ev: PointerEvent) => move(ev.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  return (
    <div
      ref={ref}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      tabIndex={0}
      onPointerDown={onPointer}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onChange(clamp01(value - 0.01));
        if (e.key === "ArrowRight") onChange(clamp01(value + 0.01));
      }}
      className="relative h-3 cursor-pointer touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
      style={{ background }}
    >
      <span
        className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.25)]"
        style={{ left: `${value * 100}%`, background: thumb }}
      />
    </div>
  );
}

/** A small labelled text box that commits on Enter / blur. */
function NumBox({ label, value, onCommit, wide, text }: { label: string; value: string; onCommit: (v: string) => void; wide?: boolean; text?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <label className={`flex min-w-0 flex-col items-center gap-0.5 ${wide ? "flex-[2.2]" : "flex-1"}`}>
      <input
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
        spellCheck={false}
        inputMode={wide || text ? "text" : "decimal"}
        className={`h-7 w-full rounded-md border border-neutral-200 bg-surface px-1 text-[11px] text-neutral-800 outline-none focus:border-brand-400 ${text ? "px-2 text-start" : wide ? "text-center font-mono uppercase" : "text-center tabular-nums"}`}
        aria-label={label}
      />
      <span className="text-[9px] font-medium uppercase tracking-wide text-neutral-400">{label}</span>
    </label>
  );
}

/** Swatches on an even 8-column grid; the current colour is ringed. */
function SwatchGrid({ colors, current, onPick }: { colors: string[]; current: string; onPick: (hex: string) => void }) {
  const list = [...new Set(colors.map((c) => c.toUpperCase()))].slice(0, 16);
  if (!list.length) return null;
  return (
    <div className="mt-2.5 grid grid-cols-8 gap-1.5 border-t border-neutral-100 pt-2.5">
      {list.map((c) => (
        <button
          key={c}
          type="button"
          title={c}
          onClick={() => onPick(c)}
          className={`aspect-square w-full rounded-md shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)] transition hover:scale-110 ${c === current ? "ring-2 ring-brand-500 ring-offset-1" : ""}`}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}

/** Sample the design canvas pixel under a click: the fallback eyedropper for
 *  browsers without the screen EyeDropper API (Firefox, Safari). The next
 *  click anywhere is swallowed (it must not select or deselect anything, nor
 *  close the picker); Escape cancels. */
function pickFromCanvas(): Promise<string | null> {
  return new Promise((resolve) => {
    // A crosshair everywhere while picking: elements that set their own
    // cursor (the canvas, buttons) would otherwise hide that it is active.
    const cursor = document.createElement("style");
    cursor.textContent = "*, *::before, *::after { cursor: crosshair !important; }";
    document.head.appendChild(cursor);
    let done = false;
    const swallow = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
    const finish = (hex: string | null) => {
      if (done) return;
      done = true;
      cursor.remove();
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      // The rest of this click (mousedown, up, click) is swallowed too.
      setTimeout(() => ["mousedown", "pointerup", "mouseup", "click"].forEach((t) => window.removeEventListener(t, swallow, true)), 400);
      resolve(hex);
    };
    const onDown = (e: PointerEvent) => {
      swallow(e);
      const c = document.elementsFromPoint(e.clientX, e.clientY).find((el): el is HTMLCanvasElement => el instanceof HTMLCanvasElement);
      let hex: string | null = null;
      if (c) {
        try {
          const r = c.getBoundingClientRect();
          const x = Math.floor(((e.clientX - r.left) * c.width) / r.width);
          const y = Math.floor(((e.clientY - r.top) * c.height) / r.height);
          const [cr, cg, cb] = c.getContext("2d")!.getImageData(x, y, 1, 1).data;
          hex = `#${[cr, cg, cb].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
        } catch { /* a tainted or non-2D canvas cannot be read */ }
      }
      finish(hex);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { swallow(e); finish(null); } };
    ["mousedown", "pointerup", "mouseup", "click"].forEach((t) => window.addEventListener(t, swallow, true));
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
  });
}

function EyeDropperButton({ onPick }: { onPick: (hex: string) => void }) {
  const [picking, setPicking] = useState(false);
  return (
    <button
      type="button"
      title={tr("editor.pick_a_color_from_the_screen")}
      aria-label={tr("editor.pick_a_color_from_the_screen")}
      aria-pressed={picking}
      onClick={async () => {
        if (typeof window === "undefined") return;
        const Native = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
        if (Native) {
          try { onPick((await new Native().open()).sRGBHex); } catch { /* cancelled */ }
          return;
        }
        setPicking(true);
        const hex = await pickFromCanvas();
        setPicking(false);
        if (hex) onPick(hex);
      }}
      className={`mb-[15px] grid h-7 w-7 shrink-0 place-items-center rounded-md border transition hover:bg-neutral-100 ${picking ? "border-brand-400 bg-brand-50 text-brand-ink" : "border-neutral-200 text-neutral-500"}`}
    ><Pipette size={13} /></button>
  );
}
