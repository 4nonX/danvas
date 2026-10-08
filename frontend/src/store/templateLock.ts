// Template lock store: who stands behind the template locks of the open design,
// whether the caller may lift them, the caller's own "edit the template" switch,
// and the notice shown when someone runs into a lock.
//
// Rights come from the server (GET /designs/{id}/template-locks): a lock may be
// lifted by people with manage-locks in the workspace that set it, also when the
// design is a copy elsewhere. Rights holders are protected too, so a template is
// not changed by accident; they switch protection off for this design while
// they edit it ("Edit template") and back on when done. The switch is local and
// never saved.

import { create } from "zustand";
import { tr } from "@/lib/i18n";
import type { EffectiveLock, EditKind, TemplateLock } from "@/lib/templateLock";
import { forbids } from "@/lib/templateLock";

const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8005/api";

export interface LockContact {
  name: string;
  email: string;
}

export interface LockWorkspace {
  workspaceId: string;
  name: string;
  contacts: LockContact[];
  canManage: boolean;
}

/** The lock card: either a blocked attempt (why, and whom to ask) or the
 *  protection settings for objects (opened from the layers panel or menu). */
export interface LockNotice {
  /** The objects the card is about. */
  ids: string[];
  /** The lock that blocked an attempt, and the node carrying it. */
  holderId: string | null;
  lock: TemplateLock | null;
  /** The attempted edit; null when the card was opened to manage. */
  kind: EditKind | null;
  /** Bumped per notice so a repeat attempt re-shows a dismissed card. */
  seq: number;
}

interface TemplateLockState {
  designId: string | null;
  /** The design's own workspace: new locks are set on its behalf. */
  workspaceId: string | null;
  workspaceName: string;
  /** Whether the caller may set locks for the design's own workspace. */
  canManage: boolean;
  workspaces: Record<string, LockWorkspace>;
  /** The caller switched template protection off for this design. */
  editingTemplate: boolean;
  notice: LockNotice | null;
  /** Layers panel: show only protected objects. */
  protectedOnly: boolean;

  setDesign(designId: string | null, workspaceId: string | null): void;
  /** Reload rights and contacts; `extra` asks about lock workspaces the
   *  saved design does not name yet (described when the caller belongs). */
  refresh(extra?: string[]): Promise<void>;
  /** Whether the caller may lift locks of a workspace. */
  mayLift(workspaceId: string): boolean;
  /** Whether a lock stops the caller from an edit of this kind right now. */
  blocks(eff: EffectiveLock | null, kind: EditKind): boolean;
  setEditingTemplate(on: boolean): void;
  notify(eff: EffectiveLock, kind: EditKind): void;
  /** Open the card for objects: their protection, and its settings for
   *  people who may change it. */
  openFor(ids: string[], eff: EffectiveLock | null): void;
  dismiss(): void;
  setProtectedOnly(on: boolean): void;
}

let seq = 0;
/** Lock workspaces already asked about for the open design (asked once). */
let asked = new Set<string>();

export const useTemplateLock = create<TemplateLockState>((set, get) => ({
  designId: null,
  workspaceId: null,
  workspaceName: "",
  canManage: false,
  workspaces: {},
  editingTemplate: false,
  notice: null,
  protectedOnly: false,

  setDesign: (designId, workspaceId) => {
    asked = new Set();
    set({ designId, workspaceId, workspaceName: "", canManage: false, workspaces: {}, editingTemplate: false, notice: null, protectedOnly: false });
    if (designId) void get().refresh();
  },

  refresh: async (extra = []) => {
    const id = get().designId;
    if (!id) return;
    try {
      const q = [...new Set([...asked, ...extra])].filter(Boolean).map((w) => `ws=${encodeURIComponent(w)}`).join("&");
      const res = await fetch(`${baseUrl}/v1/designs/${encodeURIComponent(id)}/template-locks${q ? `?${q}` : ""}`, { credentials: "include" });
      if (!res.ok) return;
      const body = (await res.json()) as { workspaces?: LockWorkspace[]; canManage?: boolean; workspaceId?: string; workspaceName?: string };
      if (get().designId !== id) return;
      const workspaces: Record<string, LockWorkspace> = {};
      for (const w of body.workspaces ?? []) workspaces[w.workspaceId] = w;
      set({ workspaces, canManage: !!body.canManage, workspaceId: body.workspaceId ?? get().workspaceId, workspaceName: body.workspaceName ?? "" });
    } catch {
      /* rights unknown: every lock applies, nobody may lift one here */
    }
  },

  mayLift: (workspaceId) => {
    const s = get();
    if (!workspaceId || workspaceId === s.workspaceId) return s.canManage;
    return !!s.workspaces[workspaceId]?.canManage;
  },

  blocks: (eff, kind) => {
    if (!eff || !forbids(eff.lock, kind)) return false;
    const s = get();
    return !(s.editingTemplate && s.mayLift(eff.lock.workspaceId));
  },

  setEditingTemplate: (on) => set({ editingTemplate: on, notice: null }),

  notify: (eff, kind) => {
    // A lock the saved design did not have yet (a template applied in this
    // session): ask about its workspace now.
    const ws = eff.lock.workspaceId;
    if (ws && !get().workspaces[ws] && !asked.has(ws)) {
      asked.add(ws);
      void get().refresh([...asked]);
    }
    set({ notice: { ids: [eff.holderId], holderId: eff.holderId, lock: eff.lock, kind, seq: ++seq } });
  },

  openFor: (ids, eff) => {
    if (eff) {
      const ws = eff.lock.workspaceId;
      if (ws && !get().workspaces[ws] && !asked.has(ws)) {
        asked.add(ws);
        void get().refresh([...asked]);
      }
    }
    set({ notice: { ids, holderId: eff?.holderId ?? null, lock: eff?.lock ?? null, kind: null, seq: ++seq } });
  },

  dismiss: () => set({ notice: null }),
  setProtectedOnly: (on) => set({ protectedOnly: on }),
}));

/** The name of the workspace behind a lock, for messages. */
export function lockWorkspaceName(workspaceId: string): string {
  const s = useTemplateLock.getState();
  const own = !workspaceId || workspaceId === s.workspaceId ? s.workspaceName : "";
  return s.workspaces[workspaceId]?.name || own || tr("editor.template_lock_unknown_workspace");
}
