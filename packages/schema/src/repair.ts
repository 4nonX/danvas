// Repairs for files an earlier writer got subtly wrong. Unlike a migration a
// repair is not keyed on the schema version: the file already claims the
// current version, so it runs on every load and import, works in place so an
// unknown key survives, and is idempotent.

import type { DesignFile } from "./schema";
import { roundedCorners } from "./factory";
import { walkNodes } from "./visitor";

/** A shape radius written as a bare number. The format's radius is the
 *  per-corner record, and every renderer reads that record, so a number drew
 *  square corners and failed validation on import. The AI composer and two
 *  editor writers (the accent rule, the image placeholder) wrote the number
 *  before 2026-09-29; a file they touched is put right here. */
export function repairCornerRadius(file: DesignFile): DesignFile {
  for (const page of file.pages ?? []) {
    walkNodes(page.children ?? [], (node) => {
      const n = node as { cornerRadius?: unknown };
      if (typeof n.cornerRadius === "number" && Number.isFinite(n.cornerRadius)) {
        n.cornerRadius = roundedCorners(n.cornerRadius);
      }
    });
  }
  return file;
}

/** A container (group, frame, photo grid) without its `children` list. A
 *  realtime merge of two nodes that shared an id (pasted copies got ids from
 *  a counter that restarted at every page load, before 2026-10-23) could drop
 *  a group's keys, and the server's structural check let the file through;
 *  every walker reads `children` as a list, so the editor did not open. The
 *  container comes back empty (what it holds now), and a mask or boolean
 *  that lost its nested node list is left to the validator. */
export function repairContainers(file: DesignFile): DesignFile {
  const walk = (nodes: unknown) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const n = node as { type?: unknown; children?: unknown; child?: unknown; operands?: unknown };
      if ((n.type === "group" || n.type === "frame" || n.type === "grid") && !Array.isArray(n.children)) n.children = [];
      walk(n.children);
      if (n.child && typeof n.child === "object") walk([n.child]);
      walk(n.operands);
    }
  };
  for (const page of file.pages ?? []) {
    if (!Array.isArray(page.children)) (page as { children: unknown }).children = [];
    walk(page.children);
  }
  return file;
}
