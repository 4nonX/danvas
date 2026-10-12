// Import from Canva (docs/roadmap/41-canva-import.md): the selection the
// import dialog builds. The server plans and runs the import
// (backend/internal/canvaimport); this module only shapes what it is sent.

import type { CanvaImportPick, CanvaItem } from "@hc/sdk";

/** A ticked entry of the tree: a design or a folder ("root" = everything),
 *  with the ids of the folders above it, for "a ticked folder covers what is
 *  below it". */
export interface CanvaPick {
  item: CanvaItem;
  ancestors: string[];
}

/** The picks as the server takes them. */
export function toImportPicks(picks: CanvaPick[]): CanvaImportPick[] {
  return picks.map((p) => ({ type: p.item.type, id: p.item.id, name: p.item.name, ancestors: p.ancestors }));
}
