// Drag controls for an element's geometry in the properties panel, beside the
// number fields: a size slider (proportional, on a logarithmic scale so a
// small element is as easy to set as a large one) and a rotation knob whose
// marker points where the element points. Both apply live while dragging and
// hand the caller the value the gesture started from with its end, so the
// caller can make one drag one undo step.

import { useRef, useState } from "react";

/** The angle (degrees, 0 = up, clockwise, -180..180) of a point seen from a
 *  centre, as a knob reads the pointer. */
export function knobAngle(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  return normalizeAngle((Math.atan2(dx, -dy) * 180) / Math.PI);
}

/** An angle folded into (-180, 180]. */
export function normalizeAngle(a: number): number {
  let r = ((a % 360) + 360) % 360;
  if (r > 180) r -= 360;
  return Math.round(r * 100) / 100 || 0;
}

/** The size slider's range for a page: from a 500th of its longer side to
 *  twice that side, widened to include the current size. */
export function sizeRange(pageW: number, pageH: number, current: number): { min: number; max: number } {
  const long = Math.max(pageW, pageH, 1);
  return { min: Math.max(1, Math.min(long / 500, current)), max: Math.max(long * 2, current) };
}

const STEPS = 1000;
/** Slider position (0..1000) of a size, logarithmic between min and max. */
export function sizeToSlider(v: number, r: { min: number; max: number }): number {
  if (r.max <= r.min) return 0;
  const t = Math.log(Math.max(r.min, Math.min(r.max, v)) / r.min) / Math.log(r.max / r.min);
  return Math.round(t * STEPS);
}
/** The size at a slider position. */
export function sliderToSize(s: number, r: { min: number; max: number }): number {
  return r.min * Math.pow(r.max / r.min, Math.max(0, Math.min(STEPS, s)) / STEPS);
}

interface GestureProps<T> {
  value: T;
  disabled?: boolean;
  /** Every change while dragging (applied without history). */
  onLive: (v: T) => void;
  /** The gesture ends at `v`; it began at `start` (record it as one undo
   *  step). A key press is a gesture of its own. */
  onDone: (v: T, start: T) => void;
}

/** Proportional size: the slider sets the width, the height follows. */
export function SizeSlider({ value, range, label, disabled, onLive, onDone }: GestureProps<number> & { range: { min: number; max: number }; label: string }) {
  // The range is held still for the whole drag: it widens with the size, and
  // a range moving under the pointer would make the thumb run away.
  const [held, setHeld] = useState<{ min: number; max: number } | null>(null);
  const drag = useRef<{ range: { min: number; max: number }; start: number; last: number } | null>(null);
  const r = held ?? range;
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setHeld(null);
    onDone(d.last, d.start);
  };
  return (
    <input
      type="range"
      min={0}
      max={STEPS}
      step={1}
      disabled={disabled}
      aria-label={label}
      title={label}
      value={sizeToSlider(value, r)}
      onPointerDown={() => { if (!drag.current) { drag.current = { range, start: value, last: value }; setHeld(range); } }}
      onChange={(e) => {
        const v = sliderToSize(Number(e.target.value), drag.current?.range ?? range);
        if (drag.current) { drag.current.last = v; onLive(v); }
        else onDone(v, value); // keyboard
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onBlur={end}
      className="h-1 min-w-0 flex-1 cursor-pointer accent-brand-600 disabled:cursor-default disabled:opacity-40"
    />
  );
}

/** A round knob: its marker points at the angle; drag around it to turn
 *  (Shift: 15° steps), double-click for 0°, arrow keys for 1° (Shift 15°). */
export function RotationKnob({ value, label, disabled, onLive, onDone }: GestureProps<number> & { label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ start: number; last: number } | null>(null);
  const angle = normalizeAngle(value);
  const read = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const a = knobAngle(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    return e.shiftKey ? normalizeAngle(Math.round(a / 15) * 15) : Math.round(a);
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    onDone(d.last, d.start);
  };
  const once = (v: number) => onDone(normalizeAngle(v), angle);
  const rad = (angle * Math.PI) / 180;
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={-180}
      aria-valuemax={180}
      aria-valuenow={angle}
      aria-disabled={disabled || undefined}
      title={`${label}: ${angle}°`}
      onPointerDown={(e) => {
        if (disabled) return;
        e.preventDefault();
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        const v = read(e);
        drag.current = { start: angle, last: v };
        onLive(v);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const v = read(e);
        if (v === drag.current.last) return;
        drag.current.last = v;
        onLive(v);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => { if (!disabled) once(0); }}
      onKeyDown={(e) => {
        if (disabled) return;
        const step = e.shiftKey ? 15 : 1;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); once(angle + step); }
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); once(angle - step); }
        else if (e.key === "Home") { e.preventDefault(); once(0); }
      }}
      className={`relative h-9 w-9 shrink-0 touch-none rounded-full border border-neutral-300 bg-neutral-50 shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)] outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${disabled ? "opacity-40" : "cursor-grab active:cursor-grabbing"}`}
    >
      {/* The marker: a line from the centre and a dot at the rim. */}
      <svg viewBox="-18 -18 36 36" className="pointer-events-none absolute inset-0 h-full w-full">
        <line x1={0} y1={0} x2={Math.sin(rad) * 11} y2={-Math.cos(rad) * 11} className="stroke-brand-600" strokeWidth={2} strokeLinecap="round" />
        <circle cx={Math.sin(rad) * 12.5} cy={-Math.cos(rad) * 12.5} r={2.6} className="fill-brand-600" />
        <circle cx={0} cy={0} r={1.6} className="fill-neutral-400" />
      </svg>
    </div>
  );
}
