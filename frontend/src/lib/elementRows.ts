// The editor's Elements panel as rows: each row (shapes, frames, charts, ...)
// shows one line of tiles, and "See all" opens the whole row. What a person
// arranged is kept with their account (ui pref "editor.elements"): the order
// of the rows, hidden rows, the order of the tiles in a row, pinned tiles and
// how often each tile was used. A row's line shows its pinned tiles first, in
// the person's order, then the tiles used most.

export const ELEMENT_ROWS_PREF = "editor.elements";

/** The rows in their default order. */
export const DEFAULT_ROW_ORDER = ["recent", "shapes", "frames", "data", "graphics", "animated"] as const;

/** Tiles in a row's line. */
export const STRIP_SIZE = 5;
/** Recently used tiles kept. */
const RECENT_SIZE = 10;
/** Tiles with a use count kept (the least used drop out beyond it). */
const USES_SIZE = 200;

export interface ElementRowsPref {
  /** Row ids, in the person's order. */
  order: string[];
  /** Rows the person hid. */
  hidden: string[];
  /** Tile ids pinned to their row's line. */
  pins: string[];
  /** Per row, tile ids in the person's order. */
  tileOrder: Record<string, string[]>;
  /** How often each tile was inserted. */
  uses: Record<string, number>;
  /** Tile ids, the last inserted first. */
  recent: string[];
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const unique = (xs: string[]) => Array.from(new Set(xs));

export function defaultRowsPref(): ElementRowsPref {
  return { order: [...DEFAULT_ROW_ORDER], hidden: [], pins: [], tileOrder: {}, uses: {}, recent: [] };
}

/** A stored preference, made safe: unknown rows dropped, rows added since
 *  it was stored put back where they belong by default. */
export function normalizeRowsPref(raw: unknown): ElementRowsPref {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const known = new Set<string>(DEFAULT_ROW_ORDER);
  const order = unique(strings(r.order).filter((id) => known.has(id)));
  for (const [i, id] of DEFAULT_ROW_ORDER.entries()) {
    if (order.includes(id)) continue;
    // After the row that precedes it by default, else first.
    const prev = DEFAULT_ROW_ORDER.slice(0, i).reverse().find((p) => order.includes(p));
    order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, id);
  }
  const tileOrder: Record<string, string[]> = {};
  if (r.tileOrder && typeof r.tileOrder === "object") {
    for (const [k, v] of Object.entries(r.tileOrder as Record<string, unknown>)) if (known.has(k)) tileOrder[k] = unique(strings(v));
  }
  const uses: Record<string, number> = {};
  if (r.uses && typeof r.uses === "object") {
    for (const [k, v] of Object.entries(r.uses as Record<string, unknown>)) if (typeof v === "number" && Number.isFinite(v) && v > 0) uses[k] = Math.floor(v);
  }
  return {
    order,
    hidden: unique(strings(r.hidden).filter((id) => known.has(id) && id !== "recent")),
    pins: unique(strings(r.pins)),
    tileOrder,
    uses,
    recent: unique(strings(r.recent)).slice(0, RECENT_SIZE),
  };
}

/** Tiles in the person's order for the row; tiles they never moved keep
 *  their place after the moved ones' positions, in the built-in order. */
export function sortTiles<T extends { id: string }>(tiles: T[], order: string[] | undefined): T[] {
  if (!order?.length) return tiles;
  const at = (id: string) => { const i = order.indexOf(id); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  return tiles.map((t, i) => ({ t, i })).sort((a, b) => at(a.t.id) - at(b.t.id) || a.i - b.i).map((x) => x.t);
}

/** A row's line: pinned tiles in the row's order, then the most used. */
export function stripTiles<T extends { id: string }>(sorted: T[], pref: ElementRowsPref, size = STRIP_SIZE): T[] {
  const pinned = sorted.filter((t) => pref.pins.includes(t.id));
  const rest = sorted
    .filter((t) => !pref.pins.includes(t.id))
    .map((t, i) => ({ t, i, n: pref.uses[t.id] ?? 0 }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.t);
  return [...pinned, ...rest].slice(0, size);
}

/** Moves a row before another (or to the end). */
export function moveRowBefore(pref: ElementRowsPref, id: string, beforeId: string | null): ElementRowsPref {
  if (id === beforeId) return pref;
  const order = pref.order.filter((x) => x !== id);
  const at = beforeId ? order.indexOf(beforeId) : -1;
  order.splice(at < 0 ? order.length : at, 0, id);
  return { ...pref, order };
}

/** Moves a row one place up (-1) or down (+1). */
export function moveRowBy(pref: ElementRowsPref, id: string, delta: -1 | 1): ElementRowsPref {
  const order = [...pref.order];
  const i = order.indexOf(id), j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return pref;
  [order[i], order[j]] = [order[j], order[i]];
  return { ...pref, order };
}

/** Moves a tile before another in its row. Dropped into the row's line, the
 *  tile is pinned there, so it stays where it was put. */
export function moveTileBefore(pref: ElementRowsPref, rowId: string, current: string[], id: string, beforeId: string, pin: boolean): ElementRowsPref {
  if (id === beforeId || !current.includes(beforeId)) return pref;
  const order = current.filter((x) => x !== id);
  order.splice(order.indexOf(beforeId), 0, id);
  const pins = pin && !pref.pins.includes(id) ? [...pref.pins, id] : pref.pins;
  return { ...pref, tileOrder: { ...pref.tileOrder, [rowId]: order }, pins };
}

export function togglePin(pref: ElementRowsPref, id: string): ElementRowsPref {
  return { ...pref, pins: pref.pins.includes(id) ? pref.pins.filter((p) => p !== id) : [...pref.pins, id] };
}

export function setRowHidden(pref: ElementRowsPref, id: string, hidden: boolean): ElementRowsPref {
  if (id === "recent") return pref;
  const rest = pref.hidden.filter((h) => h !== id);
  return { ...pref, hidden: hidden ? [...rest, id] : rest };
}

/** A tile was inserted: counts toward "most used" and leads "recent". */
export function recordUse(pref: ElementRowsPref, id: string): ElementRowsPref {
  let uses: Record<string, number> = { ...pref.uses, [id]: (pref.uses[id] ?? 0) + 1 };
  const keys = Object.keys(uses);
  if (keys.length > USES_SIZE) {
    const keep = new Set(keys.sort((a, b) => uses[b] - uses[a]).slice(0, USES_SIZE));
    keep.add(id);
    uses = Object.fromEntries(Object.entries(uses).filter(([k]) => keep.has(k)));
  }
  return { ...pref, uses, recent: [id, ...pref.recent.filter((r) => r !== id)].slice(0, RECENT_SIZE) };
}

/** Back to the built-in arrangement. What was used stays (it is history, not
 *  arrangement). */
export function resetArrangement(pref: ElementRowsPref): ElementRowsPref {
  return { ...defaultRowsPref(), uses: pref.uses, recent: pref.recent };
}
