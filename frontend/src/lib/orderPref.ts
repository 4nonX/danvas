// An order of known items a person arranged (rows of a panel, buttons of the
// editor's rail), as kept in an interface preference.

/** A stored order, made safe: unknown and repeated ids dropped, ids added
 *  since it was stored put back after the item that precedes them by
 *  default (else first). */
export function normalizeOrder(raw: unknown, defaults: readonly string[]): string[] {
  const known = new Set(defaults);
  const order = Array.from(new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && known.has(x)) : []));
  for (const [i, id] of defaults.entries()) {
    if (order.includes(id)) continue;
    const prev = defaults.slice(0, i).reverse().find((p) => order.includes(p));
    order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, id);
  }
  return order;
}

/** The order in a stored preference: the list itself (as it is saved), or
 *  an object holding it as `order`. */
export function storedOrder(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw;
  return raw && typeof raw === "object" ? (raw as { order?: unknown }).order : undefined;
}

/** Moves an id before another (or to the end). */
export function moveBefore(order: string[], id: string, beforeId: string | null): string[] {
  if (id === beforeId) return order;
  const out = order.filter((x) => x !== id);
  const at = beforeId ? out.indexOf(beforeId) : -1;
  out.splice(at < 0 ? out.length : at, 0, id);
  return out;
}

/** Moves an id one place up (-1) or down (+1); unchanged at the ends. */
export function moveBy(order: string[], id: string, delta: -1 | 1): string[] {
  const i = order.indexOf(id), j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return order;
  const out = [...order];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
