// The design's measurement unit (schema v29 `measureUnit`): lengths are shown
// and entered in mm, cm, in, pt or px, while the geometry stays in design px
// at the design's dpi. A length typed in mm is stored as the exact, unrounded
// px value, so 50 mm stays 50 mm through the editor and every export.

import { MEASURE_UNITS, type MeasureUnit } from "@hc/schema";
import { evalExpression } from "@hc/editor";

export { MEASURE_UNITS, type MeasureUnit };

/** How many of each unit make an inch (px has none: it is the design's own). */
const PER_INCH: Record<Exclude<MeasureUnit, "px">, number> = { mm: 25.4, cm: 2.54, in: 1, pt: 72 };

/** Decimals a value is shown with: 0.01 mm, 0.001 cm and in, 0.01 pt and px. */
export const UNIT_DECIMALS: Record<MeasureUnit, number> = { mm: 2, cm: 3, in: 3, pt: 2, px: 2 };

/** The design's unit; an absent or unknown value is px. */
export function measureUnitOf(doc: { measureUnit?: string } | null | undefined): MeasureUnit {
  const u = doc?.measureUnit;
  return (MEASURE_UNITS as readonly string[]).includes(u ?? "") ? (u as MeasureUnit) : "px";
}

/** True for the physical units (everything but px). */
export const isPhysical = (unit: MeasureUnit) => unit !== "px";

/** Design px per one `unit` at `dpi`. */
export function pxPerUnit(unit: MeasureUnit, dpi: number): number {
  return unit === "px" ? 1 : dpi / PER_INCH[unit];
}

/** A length in design px as `unit`. */
export const toUnit = (px: number, unit: MeasureUnit, dpi: number) => px / pxPerUnit(unit, dpi);

/** A length in `unit` as design px (exact, not rounded). */
export const fromUnit = (value: number, unit: MeasureUnit, dpi: number) => value * pxPerUnit(unit, dpi);

/** A value rounded to the unit's shown precision, as the plain number text an
 *  input field holds ("50", "1.5", "12.35"). */
export function unitInputText(px: number, unit: MeasureUnit, dpi: number): string {
  const f = 10 ** UNIT_DECIMALS[unit];
  return String(Math.round(toUnit(px, unit, dpi) * f) / f);
}

/** A length for reading, in the interface's language, with its unit
 *  ("50 mm", "1,5 mm", "12.35 pt"). */
export function formatLength(px: number, unit: MeasureUnit, dpi: number, withUnit = true): string {
  const n = toUnit(px, unit, dpi).toLocaleString(undefined, { maximumFractionDigits: UNIT_DECIMALS[unit] });
  return withUnit ? `${n} ${unit}` : n;
}

const SUFFIX = /\s*(mm|cm|in|pt|px|")\s*$/i;

/**
 * A typed length as design px, or null when it is not a valid entry. The
 * number (or arithmetic, "+5", "*2", "100/3", see evalExpression) is in the
 * design's unit unless the entry names another one: "10mm", "1 in", "2\"",
 * "72pt", "100px". A relative entry ("+2") is relative to `currentPx`.
 */
export function parseLength(text: string, unit: MeasureUnit, dpi: number, currentPx: number): number | null {
  const m = SUFFIX.exec(text);
  const typed: MeasureUnit = m ? ((m[1] === '"' ? "in" : m[1].toLowerCase()) as MeasureUnit) : unit;
  const body = m ? text.slice(0, m.index) : text;
  const v = evalExpression(body, toUnit(currentPx, typed, dpi));
  return v === null ? null : fromUnit(v, typed, dpi);
}

/** Ruler marks for a length of `extentPx` design px shown in `unit`: majors
 *  about 60 screen px apart at round values of the unit (1, 2, 5, 10, ...),
 *  each with its label value, and minors between them. Positions in px. */
export function unitRulerTicks(zoom: number, extentPx: number, unit: MeasureUnit, dpi: number): { majors: { px: number; value: number }[]; minors: number[] } {
  const per = pxPerUnit(unit, dpi);
  const target = 60 / Math.max(0.01, zoom) / per; // in units
  const exp = 10 ** Math.floor(Math.log10(Math.max(target, 1e-6)));
  const step = [1, 2, 5, 10].map((k) => k * exp).find((c) => c >= target - 1e-9) ?? 10 * exp;
  const extent = extentPx / per;
  const majors: { px: number; value: number }[] = [];
  for (let i = 0; i * step <= extent + 1e-9; i++) {
    const value = Math.round(i * step * 1e6) / 1e6;
    majors.push({ px: value * per, value });
  }
  const divisions = step * per * zoom >= 75 ? 5 : 2;
  const minors: number[] = [];
  for (let i = 1; (i * step) / divisions <= extent + 1e-9; i++) {
    if (i % divisions === 0) continue;
    minors.push(((i * step) / divisions) * per);
  }
  return { majors, minors };
}

/** Arrow-key steps in the unit (plain, Shift): 0.1 and 1 mm, 0.01 and 0.1
 *  cm or in, 1 and 10 pt or px. */
export const NUDGE_STEPS: Record<MeasureUnit, [number, number]> = { mm: [0.1, 1], cm: [0.01, 0.1], in: [0.01, 0.1], pt: [1, 10], px: [1, 10] };

/** A position rounded to the unit's fine step (a guide dropped on the canvas
 *  lands on 0.1 mm, or a whole px). */
export function snapLength(px: number, unit: MeasureUnit, dpi: number): number {
  const step = NUDGE_STEPS[unit][0];
  return fromUnit(Math.round(toUnit(px, unit, dpi) / step) * step, unit, dpi);
}

/** A length for the canvas overlays (ruler pointer, distances, live size):
 *  whole px, or one decimal of mm and pt, two of cm and in; no unit name. */
export function shortLength(px: number, unit: MeasureUnit, dpi: number): string {
  const digits = { px: 0, mm: 1, pt: 1, cm: 2, in: 2 }[unit];
  return toUnit(px, unit, dpi).toLocaleString(undefined, { maximumFractionDigits: digits });
}

/** Line widths in a physical-unit design are shown in pt, as print software
 *  does; in a px design they stay px. */
export const strokeUnitOf = (unit: MeasureUnit): MeasureUnit => (isPhysical(unit) ? "pt" : "px");
