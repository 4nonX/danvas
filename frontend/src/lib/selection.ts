// An item's own menu acts on the whole selection when the item is part of it
// (as in a file manager), else on the item alone.
export function actOn(id: string, selected: ReadonlySet<string>): string[] {
  return selected.has(id) && selected.size > 1 ? [...selected] : [id];
}
