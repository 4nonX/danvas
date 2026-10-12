// The caller's Canva imports in the dashboard: a line per run in the sidebar
// (CanvaImportRail), the recent runs under "Import from Canva"
// (CanvaRecentImports) and a run's details dialog (CanvaImportDetailsHost).
// Nothing floats over the page, and the editor shows none of it. The server
// runs the imports, so closing the tab or the browser does not stop them;
// the dashboard only polls their state.

import { useEffect } from "react";
import { CheckCircle2, Clock, FileWarning, Loader2, X } from "lucide-react";
import type { CanvaImportFailure, CanvaImportRun } from "@hc/sdk";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { tr } from "@/lib/i18n";
import { useAuth } from "@/store/auth";
import { detailsRun, pollCanvaImports, runActive, useCanvaImport } from "@/store/canvaImport";

// Progress counts what is left to import: designs already in danvas (the
// run's "skipped", known as soon as the folders are read) are not part of it.
function toImport(run: CanvaImportRun): number {
  return Math.max(0, (run.total ?? 0) - run.skipped);
}

function processed(run: CanvaImportRun): number {
  return Math.min(toImport(run), run.imported + run.failed);
}

function percent(run: CanvaImportRun): number {
  if (run.total !== null && toImport(run) > 0) return Math.round((processed(run) / toImport(run)) * 100);
  return runActive(run) && run.total === null ? 0 : 100;
}

function when(iso: string): string {
  const lang = typeof document !== "undefined" ? document.documentElement.lang || undefined : undefined;
  return new Date(iso).toLocaleString(lang, { dateStyle: "short", timeStyle: "short" });
}

function haltMessage(run: CanvaImportRun): string {
  switch (run.halted) {
    case "rate_limit":
      return tr("dashboard.canva_rate_limit_persistent");
    case "access_lost":
      return tr("dashboard.canva_halt_access_lost");
    case "not_connected":
      return tr("dashboard.canva_halt_not_connected");
    default:
      return tr("dashboard.canva_halt_error", { detail: run.haltedDetail ?? "" });
  }
}

function failureMessage(f: CanvaImportFailure): string {
  switch (f.code) {
    case "export_failed":
      return tr("dashboard.canva_export_failed", { reason: f.detail ?? "" });
    case "export_timed_out":
      return tr("dashboard.canva_export_timed_out");
    case "no_export":
      return f.detail ? tr("dashboard.canva_fail_no_export_offered", { formats: f.detail }) : tr("errors.api_canva_no_export");
    case "too_large":
      return tr("dashboard.canva_fail_too_large");
    case "convert_failed":
      return tr("dashboard.canva_fail_convert", { detail: f.detail ?? "" });
    default:
      return f.detail ? `${tr("dashboard.canva_import_failed")} (${f.detail})` : tr("dashboard.canva_import_failed");
  }
}

/** What the run is doing, or how it ended. */
function statusLine(run: CanvaImportRun): string {
  switch (run.status) {
    case "queued":
      return tr("dashboard.canva_run_queued");
    case "paused":
      return tr("dashboard.canva_run_paused", { time: run.resumeAt ? when(run.resumeAt) : "" });
    case "done":
      return tr("dashboard.import_finished");
    case "stopped":
      return tr("dashboard.import_stopped");
    case "halted":
      return haltMessage(run);
  }
  if (run.stopRequested) return tr("dashboard.canva_run_stopping");
  if (run.waiting) return tr("dashboard.canva_waiting_rate_limit");
  if (run.total === null) return run.current ? tr("dashboard.canva_reading_folder", { name: run.current }) : tr("dashboard.canva_reading_folders");
  return run.current;
}

function progressLine(run: CanvaImportRun): string {
  if (run.total === null) return runActive(run) ? statusLine(run) : tr("dashboard.canva_import_summary", { imported: run.imported, skipped: run.skipped, failed: run.failed });
  return tr("dashboard.canva_n_of_m_to_import", { n: processed(run), m: toImport(run) });
}

/** Polls the caller's runs while the dashboard is open and shows the details
 *  dialog of the run that was opened. Mounted once in the dashboard. */
export function CanvaImportDetailsHost() {
  const signedIn = useAuth((s) => !!s.user);
  useEffect(() => (signedIn ? pollCanvaImports() : undefined), [signedIn]);
  const open = useCanvaImport(detailsRun);
  return open ? <CanvaImportDetails run={open} /> : null;
}

function RunIcon({ run, size = 16 }: { run: CanvaImportRun; size?: number }) {
  if (run.status === "queued" || run.status === "paused") return <Clock size={size} className="shrink-0 text-neutral-500" />;
  if (run.status === "running") return <Loader2 size={size} className="shrink-0 animate-spin text-brand-ink" />;
  if (run.failed > 0 || run.status === "halted") return <FileWarning size={size} className="shrink-0 text-amber-600" />;
  return <CheckCircle2 size={size} className="shrink-0 text-emerald-600" />;
}

/** What a run shows in one line: its progress while it goes, else its result. */
function runLabel(run: CanvaImportRun): string {
  if (!runActive(run)) return tr("dashboard.canva_import_summary", { imported: run.imported, skipped: run.skipped, failed: run.failed });
  return run.status === "running" && run.total !== null && !run.waiting && !run.stopRequested ? progressLine(run) : statusLine(run);
}

/** The sidebar's lines for the caller's imports: one per run that is going,
 *  or that ended and was not dismissed yet. It takes its own room in the
 *  sidebar and covers nothing. Click a line for the details. */
export function CanvaImportRail({ collapsed }: { collapsed: boolean }) {
  const runs = useCanvaImport((s) => s.runs);
  const { setDetailsOpen, dismiss } = useCanvaImport.getState();
  if (!runs.length) return null;
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1">
        {runs.map((run) => (
          <button
            key={run.id}
            type="button"
            onClick={() => setDetailsOpen(run.id)}
            title={`${tr("dashboard.canva_import_label")}: ${runLabel(run)}`}
            aria-label={tr("dashboard.canva_import_show")}
            className="rounded-lg p-2 hover:bg-neutral-500/10"
          >
            <RunIcon run={run} />
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      {runs.map((run) => {
        const active = runActive(run);
        return (
          <div key={run.id} className="flex items-start gap-1 rounded-xl border border-white/60 bg-surface/40 p-2 ps-3 backdrop-blur-[6px] dark:border-white/10">
            <button type="button" onClick={() => setDetailsOpen(run.id)} title={tr("dashboard.canva_import_show")} className="flex min-w-0 flex-1 items-start gap-2 text-start">
              <span className="mt-0.5"><RunIcon run={run} size={14} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium text-neutral-700">{tr("dashboard.canva_import_label")}</span>
                <span className="block truncate text-[11px] text-neutral-500">{runLabel(run)}</span>
                {active && (
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-neutral-500/15">
                    <span className="oc-gradient block h-full rounded-full transition-[width]" style={{ width: `${percent(run)}%` }} />
                  </span>
                )}
              </span>
            </button>
            {!active && (
              <button type="button" onClick={() => void dismiss(run.id)} aria-label={tr("ui.dismiss")} className="shrink-0 rounded-md p-0.5 text-neutral-400 hover:text-neutral-700">
                <X size={13} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The caller's running and recent imports, dismissed ones too, for the
 *  import dialog: the place to look an import up again. */
export function CanvaRecentImports({ onOpen }: { onOpen: (id: string) => void }) {
  const recent = useCanvaImport((s) => s.recent);
  useEffect(() => {
    void useCanvaImport.getState().loadRecent().catch(() => undefined);
  }, []);
  if (!recent.length) return null;
  return (
    <div className="mb-3">
      <p className="mb-1 text-xs font-medium text-neutral-700">{tr("dashboard.canva_recent_imports")}</p>
      <ul className="oc-scroll max-h-32 overflow-y-auto rounded-xl border border-neutral-200 p-1">
        {recent.map((run) => (
          <li key={run.id}>
            <button type="button" onClick={() => onOpen(run.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-start text-xs hover:bg-neutral-50">
              <RunIcon run={run} size={14} />
              <span className="shrink-0 tabular-nums text-neutral-500">{when(run.createdAt)}</span>
              <span className="min-w-0 flex-1 truncate text-neutral-700">{runLabel(run)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CanvaImportDetails({ run }: { run: CanvaImportRun }) {
  const { setDetailsOpen, stop, dismiss } = useCanvaImport.getState();
  const active = runActive(run);
  const pct = percent(run);
  const close = () => setDetailsOpen(null);
  return (
    <Modal open onClose={close} title={tr("dashboard.import_from_canva")} width="w-[34rem]">
      <div className="mb-2 flex items-center justify-between text-sm text-neutral-600">
        <span>{run.total !== null ? tr("dashboard.canva_n_of_m_to_import", { n: processed(run), m: toImport(run) }) : statusLine(run)}</span>
        <span className="tabular-nums text-neutral-400">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
        <div className="h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 flex min-h-5 items-center gap-1.5 truncate text-xs text-neutral-500">
        {run.status === "running" && <Loader2 size={13} className="shrink-0 animate-spin" />}
        <span className="truncate">{statusLine(run)}</span>
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-emerald-50 py-2"><div className="text-lg font-semibold text-emerald-700">{run.imported}</div><div className="text-[11px] text-emerald-700">{tr("dashboard.imported")}</div></div>
        <div className="rounded-xl bg-neutral-100 py-2"><div className="text-lg font-semibold text-neutral-700">{run.skipped}</div><div className="text-[11px] text-neutral-500">{tr("dashboard.canva_already_imported")}</div></div>
        <div className="rounded-xl bg-red-50 py-2"><div className="text-lg font-semibold text-red-700">{run.failed}</div><div className="text-[11px] text-red-700">{tr("dashboard.failed")}</div></div>
      </div>
      {run.asImages > 0 && <p className="mt-3 text-xs text-neutral-500">{tr("dashboard.canva_n_as_images", { count: run.asImages })}</p>}
      {run.failures.length > 0 && (
        <ul className="oc-scroll mt-3 max-h-40 overflow-y-auto rounded-xl border border-red-100 p-2 text-xs">
          {run.failures.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex gap-1.5 py-0.5 text-red-700">
              <FileWarning size={13} className="mt-0.5 shrink-0" />
              <span className="min-w-0"><span className="font-medium">{f.name}</span>: {failureMessage(f)}</span>
            </li>
          ))}
        </ul>
      )}
      {!active && (run.failed > 0 || run.status === "halted" || run.status === "stopped") && (
        <p className="mt-2 text-xs text-neutral-500">{tr("dashboard.canva_rerun_hint")}</p>
      )}
      {active && <p className="mt-3 text-xs text-neutral-500">{tr("dashboard.canva_server_progress_hint")}</p>}
      <div className="mt-5 flex justify-end gap-2">
        {active ? (
          <>
            <Button variant="ghost" onClick={() => void stop(run.id)} disabled={run.stopRequested}>{tr("dashboard.stop_import")}</Button>
            <Button variant="secondary" onClick={close}>{tr("dashboard.canva_continue_in_background")}</Button>
          </>
        ) : run.dismissed ? (
          <Button variant="secondary" onClick={close}>{tr("ui.close")}</Button>
        ) : (
          <Button onClick={() => void dismiss(run.id)}><CheckCircle2 size={16} /> {tr("dashboard.done")}</Button>
        )}
      </div>
    </Modal>
  );
}
