// The order a person gave the templates of a workspace, kept with the account
// (an interface preference, one per workspace). It holds ids and nothing else:
// everyone sees the same templates, each in their own order.

/** A list of ids is about 39 bytes each; preferences are bounded at 32 KB. */
const MAX_IDS = 700;

export const templateOrderKey = (workspaceId: string | null | undefined) => `templateOrder.${workspaceId ?? "none"}`;

/** A stored order, made safe. */
export function normalizeTemplateOrder(raw: unknown): string[] {
  return Array.isArray(raw) ? Array.from(new Set(raw.filter((x): x is string => typeof x === "string"))) : [];
}

/** The templates in the person's order. One not placed yet (new since) comes
 *  first, in the order the server gave it, so a new template is easy to find. */
export function sortTemplates<T extends { id: string }>(list: readonly T[], order: readonly string[]): T[] {
  const at = new Map(order.map((id, i) => [id, i]));
  const unplaced = list.filter((t) => !at.has(t.id));
  const placed = list.filter((t) => at.has(t.id)).sort((a, b) => at.get(a.id)! - at.get(b.id)!);
  return [...unplaced, ...placed];
}

/**
 * The new order after moving `id` to the place of `overId`: moving forward it
 * lands after that template, moving back before it, so every place can be
 * reached, the last one too. `loaded` is what the list holds now. A view of one
 * collection loads only part of the templates; `complete` says it is the whole
 * list, and only then are the ids of templates that are gone dropped.
 */
export function moveTemplate(order: readonly string[], loaded: readonly { id: string }[], id: string, overId: string, complete: boolean): string[] {
  if (id === overId) return [...order];
  const here = new Set(loaded.map((t) => t.id));
  const stored = new Set(order);
  const full = [...loaded.map((t) => t.id).filter((x) => !stored.has(x)), ...order.filter((x) => !complete || here.has(x))];
  const from = full.indexOf(id);
  const to = full.indexOf(overId);
  if (from < 0 || to < 0) return [...order];
  const out = full.filter((x) => x !== id);
  out.splice(out.indexOf(overId) + (from < to ? 1 : 0), 0, id);
  return out.slice(0, MAX_IDS);
}
