// The caller's Canva imports: their progress shows in the dashboard's sidebar
// and under "Import from Canva" (components/dashboard/CanvaImportStatus).
//
// The server runs the imports (backend/internal/canvaimport): one design at a
// time, Canva exports it (PPTX when every page supports it, else PNG pages),
// the server converts it with the same importers as a file import, creates it
// in its folder and records it, so a later run skips it. A run goes on with
// the tab or the browser closed and after a server restart; the daily limit
// pauses it until Canva allows more. This store only starts, stops and
// dismisses runs and polls their state: often while one is going, rarely
// otherwise, so a run started on another device shows up here too.

import { create } from "zustand";
import type { CanvaImportRun } from "@hc/sdk";
import { oc } from "@/lib/sdk";
import { toImportPicks, type CanvaPick } from "@/lib/canvaImport";
import { tr } from "@/lib/i18n";

/** Polling while a run is going, and while none is. */
export const ACTIVE_POLL_MS = 3_000;
export const IDLE_POLL_MS = 60_000;

export function runActive(r: CanvaImportRun): boolean {
  return r.status === "queued" || r.status === "running" || r.status === "paused";
}

export interface CanvaImportStart {
  workspaceId: string;
  targetFolderId: string | null;
  picks: CanvaPick[];
}

export interface CanvaImportState {
  /** The caller's runs that are not dismissed, oldest first. */
  runs: CanvaImportRun[];
  /** The caller's most recent runs, dismissed ones too, newest first (loaded
   *  on demand by `loadRecent`). */
  recent: CanvaImportRun[];
  /** The run whose progress dialog is open. */
  detailsOpen: string | null;
  /** Bumped whenever runs imported designs, so open views refresh. */
  changes: number;
  /** The workspaces the last bump was for. */
  changedWorkspaceIds: string[];
  /** Queue a run on the server and open its progress. Throws when the server refuses. */
  start(opts: CanvaImportStart): Promise<void>;
  stop(id: string): Promise<void>;
  /** Hide an ended run from the sidebar; it stays among the recent runs. */
  dismiss(id: string): Promise<void>;
  loadRecent(): Promise<void>;
  setDetailsOpen(id: string | null): void;
  /** Fetch the runs now. */
  refresh(): Promise<void>;
}

/** The run whose details are open: a current one, or one of the recent runs. */
export function detailsRun(s: Pick<CanvaImportState, "runs" | "recent" | "detailsOpen">): CanvaImportRun | undefined {
  if (!s.detailsOpen) return undefined;
  return s.runs.find((r) => r.id === s.detailsOpen) ?? s.recent.find((r) => r.id === s.detailsOpen);
}

/** Whether any of the caller's runs is still going. */
export function canvaImportActive(): boolean {
  return useCanvaImport.getState().runs.some(runActive);
}

export const useCanvaImport = create<CanvaImportState>((set, get) => {
  // Replace the runs, noting the workspaces where designs arrived.
  const apply = (runs: CanvaImportRun[]) => {
    const before = new Map(get().runs.map((r) => [r.id, r]));
    const changed = new Set<string>();
    for (const r of runs) {
      const was = before.get(r.id);
      if (was ? was.imported !== r.imported || runActive(was) !== runActive(r) : r.imported > 0) changed.add(r.workspaceId);
    }
    // Keep the recent runs in step, so an open details dialog follows along.
    const fresh = new Map(runs.map((r) => [r.id, r]));
    set((s) => ({
      runs,
      recent: s.recent.map((r) => fresh.get(r.id) ?? r),
      ...(changed.size ? { changes: s.changes + 1, changedWorkspaceIds: [...changed] } : {}),
    }));
  };
  const upsert = (run: CanvaImportRun) => {
    const runs = get().runs;
    apply(runs.some((r) => r.id === run.id) ? runs.map((r) => (r.id === run.id ? run : r)) : [...runs, run]);
  };

  return {
    runs: [],
    recent: [],
    detailsOpen: null,
    changes: 0,
    changedWorkspaceIds: [],
    start: async ({ workspaceId, targetFolderId, picks }) => {
      const run = await oc.startCanvaImport(workspaceId, { picks: toImportPicks(picks), targetFolderId, untitled: tr("dashboard.untitled") });
      upsert(run);
      set({ detailsOpen: run.id });
      schedule(0);
    },
    stop: async (id) => {
      upsert(await oc.stopCanvaImport(id));
    },
    dismiss: async (id) => {
      await oc.dismissCanvaImport(id);
      set((s) => ({
        recent: s.recent.map((r) => (r.id === id ? { ...r, dismissed: true } : r)),
        detailsOpen: s.detailsOpen === id ? null : s.detailsOpen,
      }));
      apply(get().runs.filter((r) => r.id !== id));
    },
    loadRecent: async () => {
      set({ recent: await oc.listCanvaImports(true) });
    },
    setDetailsOpen: (id) => set({ detailsOpen: id }),
    refresh: async () => {
      apply(await oc.listCanvaImports());
    },
  };
});

// --- polling -----------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | null = null;
let polling = false;

function schedule(ms: number) {
  if (!polling) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void tick(), ms);
}

async function tick() {
  timer = null;
  try {
    await useCanvaImport.getState().refresh();
  } catch {
    // Offline or signed out for a moment: try again later.
  }
  schedule(canvaImportActive() ? ACTIVE_POLL_MS : IDLE_POLL_MS);
}

/** Poll the caller's runs until the returned function is called (while
 *  signed in). Also refreshes when the tab comes back into view. */
export function pollCanvaImports(): () => void {
  polling = true;
  schedule(0);
  const doc = typeof document !== "undefined" ? document : null;
  const onVisible = () => {
    if (doc?.visibilityState === "visible") schedule(0);
  };
  doc?.addEventListener("visibilitychange", onVisible);
  return () => {
    polling = false;
    if (timer) clearTimeout(timer);
    timer = null;
    doc?.removeEventListener("visibilitychange", onVisible);
    useCanvaImport.setState({ runs: [], recent: [], detailsOpen: null });
  };
}
