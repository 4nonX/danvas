// Template locks (schema v27, node.templateLock): objects of a template that
// stay fixed in every design made from it, on behalf of the workspace that set
// them. Pure helpers over the document; the editor store gates its actions with
// them and the server re-checks every save (backend/internal/templatelock).
//
// Levels: "content" fixes the frame (place, size, parent) and leaves the text
// or picture editable; "locked" fixes everything. A lock covers the node and
// all nodes inside it. A level this build does not know reads as "locked".

import type { DesignFile, Node } from "@hc/schema";

export type TemplateLockLevel = "locked" | "content";

/** Mirrors `TemplateLock` in @hc/schema (v27). */
export interface TemplateLock {
  level: TemplateLockLevel;
  workspaceId: string;
}

/** What kind of edit is being attempted: "structure" moves, resizes, restyles
 *  or removes; "content" changes the text or picture inside a fixed frame. */
export type EditKind = "structure" | "content";

/** A node's own lock, level normalized. */
export function lockOf(node: Node | null | undefined): TemplateLock | null {
  const raw = (node as { templateLock?: { level?: unknown; workspaceId?: unknown } } | null | undefined)?.templateLock;
  if (!raw || typeof raw !== "object") return null;
  return { level: raw.level === "content" ? "content" : "locked", workspaceId: typeof raw.workspaceId === "string" ? raw.workspaceId : "" };
}

/** Nodes stored inside a node: container children and a mask's subject. */
function inner(node: Node): Node[] {
  const n = node as { children?: Node[]; child?: Node };
  const out = Array.isArray(n.children) ? [...n.children] : [];
  if (n.child && typeof n.child === "object") out.push(n.child);
  return out;
}

export interface EffectiveLock {
  lock: TemplateLock;
  /** The node that carries the lock (the node itself or an ancestor). */
  holderId: string;
}

/** The lock that applies to a node: its own, else its nearest locked ancestor's. */
export function effectiveLock(doc: DesignFile, id: string): EffectiveLock | null {
  let found: EffectiveLock | null | undefined;
  const walk = (nodes: Node[], inherited: EffectiveLock | null): boolean => {
    for (const n of nodes) {
      const own = lockOf(n);
      const eff = own ? { lock: own, holderId: n.id } : inherited;
      if (n.id === id) {
        found = eff;
        return true;
      }
      if (walk(inner(n), eff)) return true;
    }
    return false;
  };
  for (const page of doc.pages) if (walk(page.children, null)) break;
  return found ?? null;
}

/** Every lock inside a node (not the node's own). */
export function locksBelow(node: Node): EffectiveLock[] {
  const out: EffectiveLock[] = [];
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      const own = lockOf(n);
      if (own) out.push({ lock: own, holderId: n.id });
      walk(inner(n));
    }
  };
  walk(inner(node));
  return out;
}

/** Every lock on a page. */
export function locksOnPage(page: { children: Node[] }): EffectiveLock[] {
  return page.children.flatMap((n) => {
    const own = lockOf(n);
    return [...(own ? [{ lock: own, holderId: n.id }] : []), ...locksBelow(n)];
  });
}

/** Whether a lock forbids an edit of this kind. */
export function forbids(lock: TemplateLock, kind: EditKind): boolean {
  return kind === "structure" || lock.level === "locked";
}

/** Copies made by copy/paste or duplicate are the user's own objects: they
 *  drop the template lock (the original stays protected). */
export function stripTemplateLocks<T extends Node>(nodes: T[]): T[] {
  const walk = (n: Node) => {
    delete (n as { templateLock?: unknown }).templateLock;
    inner(n).forEach(walk);
  };
  nodes.forEach(walk);
  return nodes;
}
