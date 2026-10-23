// The editor's view aids as the user left them: rulers, grid (with its spacing
// and subdivisions), scrollbars and snapping. They belong to the person, not
// to the design, so they live in this browser's storage and no design file
// changes when someone turns the grid on.
//
// The grid spacing is kept with its unit (10 mm, 0.25 in, 50 px), so the
// same setting gives the same physical grid on every design; it becomes design
// px through each design's dpi.

import { MEASURE_UNITS, pxPerUnit, type MeasureUnit } from "@/lib/units";

export interface GridSettings {
  /** Distance between the main grid lines, in `unit`. */
  value: number;
  unit: MeasureUnit;
  /** Finer lines between two main lines (1 = none). Objects snap to the
   *  finest lines drawn. */
  subdivisions: number;
}

export interface ViewPrefs {
  showRulers: boolean;
  showGrid: boolean;
  showScrollbars: boolean;
  snapEnabled: boolean;
  grid: GridSettings;
}

export const DEFAULT_GRID: GridSettings = { value: 10, unit: "mm", subdivisions: 1 };
export const DEFAULT_VIEW_PREFS: ViewPrefs = { showRulers: false, showGrid: false, showScrollbars: true, snapEnabled: true, grid: DEFAULT_GRID };

export const MAX_SUBDIVISIONS = 10;
const STORAGE_KEY = "oc.editor.view.v1";

/** A grid setting made safe: a positive finite spacing, a known unit,
 *  1 to 10 subdivisions. */
export function cleanGrid(g: Partial<GridSettings> | null | undefined): GridSettings {
  const unit = MEASURE_UNITS.includes(g?.unit as MeasureUnit) ? (g!.unit as MeasureUnit) : DEFAULT_GRID.unit;
  const value = typeof g?.value === "number" && Number.isFinite(g.value) && g.value > 0 ? g.value : DEFAULT_GRID.value;
  const sub = typeof g?.subdivisions === "number" && Number.isFinite(g.subdivisions) ? Math.round(g.subdivisions) : DEFAULT_GRID.subdivisions;
  return { value, unit, subdivisions: Math.min(MAX_SUBDIVISIONS, Math.max(1, sub)) };
}

export function loadViewPrefs(): ViewPrefs {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VIEW_PREFS;
    const p = JSON.parse(raw) as Partial<ViewPrefs>;
    const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
    return {
      showRulers: bool(p.showRulers, DEFAULT_VIEW_PREFS.showRulers),
      showGrid: bool(p.showGrid, DEFAULT_VIEW_PREFS.showGrid),
      showScrollbars: bool(p.showScrollbars, DEFAULT_VIEW_PREFS.showScrollbars),
      snapEnabled: bool(p.snapEnabled, DEFAULT_VIEW_PREFS.snapEnabled),
      grid: cleanGrid(p.grid),
    };
  } catch {
    return DEFAULT_VIEW_PREFS;
  }
}

export function saveViewPrefs(p: ViewPrefs): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* storage full or blocked: the setting lasts for this session */
  }
}

/** The grid in design px: the main spacing and the finest (snap) spacing. */
export function gridStep(grid: GridSettings, dpi: number): { major: number; minor: number } {
  const major = grid.value * pxPerUnit(grid.unit, dpi);
  return { major, minor: major / Math.max(1, grid.subdivisions) };
}

/** The grid lines along one page side (0..extent) worth drawing at this zoom:
 *  main lines while they are at least 4 screen px apart, the finer ones while
 *  those are at least 6 px apart. Null when even the main lines are too
 *  dense to show. */
export function gridLines(extent: number, step: { major: number; minor: number }, zoom: number): { majors: number[]; minors: number[] } | null {
  if (!(step.major > 0) || step.major * zoom < 4) return null;
  const majors: number[] = [];
  const minors: number[] = [];
  const n = Math.floor(extent / step.major + 1e-6);
  for (let i = 0; i <= n; i++) majors.push(i * step.major);
  if (step.minor < step.major && step.minor * zoom >= 6) {
    const per = Math.round(step.major / step.minor);
    const m = Math.floor(extent / step.minor + 1e-6);
    for (let i = 0; i <= m; i++) if (i % per !== 0) minors.push(i * step.minor);
  }
  return { majors, minors };
}

/** Snap a box to the grid: the nearer of its two edges on each axis moves
 *  onto the nearest line when within `threshold`. Returns the shift. */
export function snapToGrid(box: { x: number; y: number; width: number; height: number }, spacing: number, threshold: number): { dx: number; dy: number } {
  const axis = (lo: number, size: number) => {
    let best = 0;
    let bestDist = Infinity;
    for (const edge of [lo, lo + size]) {
      const d = Math.round(edge / spacing) * spacing - edge;
      if (Math.abs(d) <= threshold && Math.abs(d) < bestDist) { best = d; bestDist = Math.abs(d); }
    }
    return best;
  };
  if (!(spacing > 0)) return { dx: 0, dy: 0 };
  return { dx: axis(box.x, box.width), dy: axis(box.y, box.height) };
}

/** One scrollbar: where its thumb sits and how large it is on a track of
 *  `track` px, for content spanning [lo, hi] and the view showing
 *  [start, start + visible] (all in the same units). The scroll range is the
 *  content with a margin, widened to include what is in view. Null when
 *  everything is in view. */
export function scrollThumb(lo: number, hi: number, start: number, visible: number, track: number, margin: number, minThumb = 24):
  { offset: number; size: number; rangeLo: number; range: number } | null {
  const rangeLo = Math.min(lo - margin, start);
  const rangeHi = Math.max(hi + margin, start + visible);
  const range = rangeHi - rangeLo;
  if (range <= visible + 0.5 || track <= 0) return null;
  const size = Math.max(minThumb, (visible / range) * track);
  const offset = ((start - rangeLo) / (range - visible)) * (track - size);
  return { offset: Math.max(0, Math.min(track - size, offset)), size, rangeLo, range };
}
