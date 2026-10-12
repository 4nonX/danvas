// The Canva import run, kept at the app level so it outlives the dialog that
// started it: the dialog can be closed and the user keeps working (other
// dashboard views, the editor, settings) while designs arrive. A progress
// indicator shows the run on every page (CanvaImportProgress).
//
// The run itself is unchanged from the dialog it came out of: one design at a
// time, Canva exports it (PPTX when every page supports it, else PNG pages),
// the browser downloads it through the server and converts it with the same
// importers as a file import, then the design is created, moved into its
// folder and recorded, so a later run skips it. Exports are paced under
// Canva's limits; a rate limit waits and carries on, the daily limit stops
// the run. It runs in this tab: closing or reloading the tab stops it (the
// browser asks first), and running it again continues where it stopped.

import { create } from "zustand";
import type { DesignFolder } from "@hc/sdk";
import { ApiError } from "@hc/sdk";
import { oc } from "@/lib/sdk";
import { designFromFile } from "@/lib/importDesignFile";
import { ExportPacer, imagePagesDesign, planImport, type CanvaPick } from "@/lib/canvaImport";
import { tr } from "@/lib/i18n";

const RATE_WAIT_MS = 60_000;
const POLL_MS = 2_000;
const EXPORT_TIMEOUT_MS = 15 * 60_000;
/** Rate limits in a row on one call before the run gives up on Canva. */
const MAX_RATE_RETRIES = 6;

export type CanvaImportResult = { name: string; status: "imported" | "skipped" | "failed"; detail?: string };

export interface CanvaImportRunState {
  workspaceId: string;
  /** Designs in the plan, null while the folders are still being read. */
  total: number | null;
  results: CanvaImportResult[];
  /** What the run is on right now (a design path, or "reading folders"). */
  current: string;
  /** Waiting out a Canva rate limit. */
  waiting: boolean;
  done: boolean;
  /** Why the run ended early (daily limit, an error); empty when stopped by the user. */
  halted: string | null;
  /** The user stopped it. */
  stopped: boolean;
}

export interface CanvaImportStart {
  workspaceId: string;
  targetFolderId: string | null;
  folders: DesignFolder[];
  picks: CanvaPick[];
  errorMessage: (e: unknown) => string;
}

interface CanvaImportState {
  run: CanvaImportRunState | null;
  /** The progress dialog is open (else the small indicator shows). */
  detailsOpen: boolean;
  /** Bumped whenever the run created folders or designs, so open views refresh. */
  changes: number;
  start(opts: CanvaImportStart): void;
  stop(): void;
  /** Forget a finished run (hides the indicator). */
  dismiss(): void;
  setDetailsOpen(open: boolean): void;
}

const codeOf = (e: unknown) => (e instanceof ApiError ? (e.body as { code?: string } | null)?.code : undefined);

class StopRun extends Error {}

let stopFlag = false;

/** Whether a run is still going (not finished). */
export function canvaImportActive(): boolean {
  const r = useCanvaImport.getState().run;
  return !!r && !r.done;
}

export const useCanvaImport = create<CanvaImportState>((set, get) => {
  const patch = (p: Partial<CanvaImportRunState>) => set((s) => (s.run ? { run: { ...s.run, ...p } } : {}));
  const addResult = (r: CanvaImportResult) => set((s) => (s.run ? { run: { ...s.run, results: [...s.run.results, r] } } : {}));
  const changed = () => set((s) => ({ changes: s.changes + 1 }));

  async function execute(o: CanvaImportStart): Promise<void> {
    const { workspaceId, targetFolderId, folders, picks, errorMessage } = o;
    const stopped = () => stopFlag;
    const sleep = (ms: number) => new Promise<void>((r) => {
      const until = Date.now() + ms;
      const tick = () => (stopFlag || Date.now() >= until ? r() : setTimeout(tick, 250));
      tick();
    });
    // A Canva call that waits out rate limits; the daily limit ends the run.
    const canva = async <T,>(call: () => Promise<T>): Promise<T> => {
      for (let attempt = 0; ; attempt++) {
        try {
          const out = await call();
          patch({ waiting: false });
          return out;
        } catch (e) {
          const code = codeOf(e);
          if (code === "canva_daily_limit") throw new StopRun(tr("dashboard.canva_daily_limit_reached"));
          if (code !== "canva_rate_limited") throw e;
          if (attempt >= MAX_RATE_RETRIES) throw new StopRun(tr("dashboard.canva_rate_limit_persistent"));
          patch({ waiting: true });
          await sleep(RATE_WAIT_MS);
          if (stopFlag) throw new StopRun("");
        }
      }
    };

    try {
      patch({ current: tr("dashboard.canva_reading_folders") });
      const p = await planImport(picks, (id, c) => canva(() => oc.listCanvaFolder(workspaceId, id, c)), {
        stopped,
        untitled: { design: tr("dashboard.untitled"), folder: tr("dashboard.untitled") },
        onFolder: (name) => patch({ current: name ? tr("dashboard.canva_reading_folder", { name }) : tr("dashboard.canva_reading_folders") }),
      });
      patch({ total: p.designs.length });
      if (stopFlag) return;

      // Mirror the folders (existing ones of the same name are reused).
      const folderIds = new Map<string, string>();
      for (const f of folders) folderIds.set(`${f.parentId ?? ""}/${f.name.toLowerCase()}`, f.id);
      const ensureFolder = async (path: string[]): Promise<string | null> => {
        let parent = targetFolderId;
        for (const name of path) {
          const key = `${parent ?? ""}/${name.toLowerCase()}`;
          let id = folderIds.get(key);
          if (!id) {
            id = (await oc.createDesignFolder(workspaceId, { name, parentId: parent })).id;
            folderIds.set(key, id);
            changed();
          }
          parent = id;
        }
        return parent;
      };
      for (const path of p.folders) {
        if (stopFlag) return;
        await ensureFolder(path);
      }

      const imported = await oc.canvaImported(workspaceId).catch(() => ({} as Record<string, string>));
      const pacer = new ExportPacer();
      for (const d of p.designs) {
        if (stopFlag) break;
        const label = [...d.path, d.title].join(" / ");
        if (imported[d.id]) {
          addResult({ name: label, status: "skipped" });
          continue;
        }
        patch({ current: label });
        try {
          await pacer.wait(stopped);
          if (stopFlag) break;
          const exp = await canva(() => oc.startCanvaExport(workspaceId, d.id));
          const deadline = Date.now() + EXPORT_TIMEOUT_MS;
          let st = await canva(() => oc.getCanvaExport(workspaceId, exp.jobId));
          while (st.status === "in_progress") {
            if (Date.now() > deadline) throw new Error(tr("dashboard.canva_export_timed_out"));
            await sleep(POLL_MS);
            if (stopFlag) throw new StopRun("");
            st = await canva(() => oc.getCanvaExport(workspaceId, exp.jobId));
          }
          if (st.status !== "success" || st.files === 0) throw new Error(tr("dashboard.canva_export_failed", { reason: st.error ?? st.status }));
          const blobs: Blob[] = [];
          for (let i = 0; i < st.files; i++) blobs.push(await canva(() => oc.canvaExportFile(workspaceId, exp.jobId, i)));
          const file = exp.format === "pptx"
            ? { ...(await designFromFile(new File([blobs[0]], `${d.title}.pptx`, { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }))).file, title: d.title }
            : await imagePagesDesign(d.title, blobs);
          const folderId = await ensureFolder(d.path);
          const rec = await oc.createDesign({ workspaceId, title: d.title, from: file });
          if (folderId) await oc.moveToFolder(workspaceId, { designIds: [rec.id], folderId });
          await oc.recordCanvaImport(workspaceId, d.id, rec.id).catch(() => undefined);
          addResult({ name: label, status: "imported", detail: exp.format === "png" ? tr("dashboard.canva_as_images") : undefined });
          changed();
        } catch (e) {
          if (e instanceof StopRun) throw e;
          addResult({ name: label, status: "failed", detail: errorMessage(e) });
        }
      }
    } catch (e) {
      if (e instanceof StopRun) {
        if (e.message) patch({ halted: e.message });
      } else {
        patch({ halted: errorMessage(e) });
      }
    } finally {
      patch({ waiting: false, current: "", done: true, stopped: stopFlag });
      changed();
    }
  }

  return {
    run: null,
    detailsOpen: false,
    changes: 0,
    start: (o) => {
      if (canvaImportActive()) return; // one run at a time
      stopFlag = false;
      set({
        run: { workspaceId: o.workspaceId, total: null, results: [], current: tr("dashboard.canva_reading_folders"), waiting: false, done: false, halted: null, stopped: false },
        detailsOpen: true,
      });
      void execute(o);
    },
    stop: () => {
      if (!canvaImportActive()) return;
      stopFlag = true;
      patch({ stopped: true });
    },
    dismiss: () => {
      if (canvaImportActive()) return;
      set({ run: null, detailsOpen: false });
    },
    setDetailsOpen: (open) => set({ detailsOpen: open && !!get().run }),
  };
});

