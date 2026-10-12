// The Canva import's progress, on every page while a run exists: a small
// indicator (click to open the details), the details dialog (closable while
// the run goes on), and the browser's "leave this page?" prompt while it
// runs, since closing or reloading the tab stops it. Mounted once in _app.

import { useEffect } from "react";
import { CheckCircle2, FileWarning, Loader2, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { tr } from "@/lib/i18n";
import { useCanvaImport, type CanvaImportRunState } from "@/store/canvaImport";

function counts(run: CanvaImportRunState) {
  const by = (s: string) => run.results.filter((r) => r.status === s).length;
  return { imported: by("imported"), skipped: by("skipped"), failed: by("failed") };
}

function percent(run: CanvaImportRunState): number {
  if (run.total) return Math.round((run.results.length / run.total) * 100);
  return run.done ? 100 : 0;
}

function statusLine(run: CanvaImportRunState): string {
  if (run.done) return run.halted ?? (run.stopped ? tr("dashboard.import_stopped") : tr("dashboard.import_finished"));
  return run.waiting ? tr("dashboard.canva_waiting_rate_limit") : run.current;
}

export function CanvaImportProgress() {
  const run = useCanvaImport((s) => s.run);
  const detailsOpen = useCanvaImport((s) => s.detailsOpen);
  const running = !!run && !run.done;

  // Closing or reloading the tab ends the run: let the browser ask first.
  useEffect(() => {
    if (!running) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [running]);

  if (!run) return null;
  return detailsOpen ? <CanvaImportDetails run={run} /> : <CanvaImportIndicator run={run} />;
}

function CanvaImportIndicator({ run }: { run: CanvaImportRunState }) {
  const { setDetailsOpen, dismiss } = useCanvaImport.getState();
  const c = counts(run);
  const label = run.done
    ? tr("dashboard.canva_import_summary", { imported: c.imported, skipped: c.skipped, failed: c.failed })
    : run.total === null
      ? tr("dashboard.canva_reading_folders")
      : tr("dashboard.canva_n_of_m_designs", { n: run.results.length, m: run.total });
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-16 end-4 z-[90] flex w-72 items-center gap-2 rounded-xl border border-neutral-200 bg-surface p-2 ps-3 text-sm shadow-lg"
    >
      <button
        type="button"
        onClick={() => setDetailsOpen(true)}
        title={tr("dashboard.canva_import_show")}
        className="flex min-w-0 flex-1 items-center gap-2 text-start"
      >
        {run.done ? (
          c.failed > 0 || run.halted ? <FileWarning size={16} className="shrink-0 text-amber-600" /> : <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
        ) : (
          <Loader2 size={16} className="shrink-0 animate-spin text-brand-ink" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-neutral-800">{tr("dashboard.canva_import_label")}</span>
          <span className="block truncate text-xs text-neutral-500">{run.waiting && !run.done ? tr("dashboard.canva_waiting_rate_limit") : label}</span>
          {!run.done && (
            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-neutral-100">
              <span className="block h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${percent(run)}%` }} />
            </span>
          )}
        </span>
      </button>
      {run.done && (
        <button type="button" onClick={dismiss} aria-label={tr("ui.dismiss")} className="shrink-0 rounded-md p-1 text-neutral-400 hover:text-neutral-700">
          <X size={15} />
        </button>
      )}
    </div>
  );
}

function CanvaImportDetails({ run }: { run: CanvaImportRunState }) {
  const { setDetailsOpen, stop, dismiss } = useCanvaImport.getState();
  const c = counts(run);
  const failed = run.results.filter((r) => r.status === "failed");
  const images = run.results.filter((r) => r.status === "imported" && r.detail);
  const pct = percent(run);
  const close = () => (run.done ? dismiss() : setDetailsOpen(false));
  return (
    <Modal open onClose={close} title={tr("dashboard.import_from_canva")} width="w-[34rem]">
      <div className="mb-2 flex items-center justify-between text-sm text-neutral-600">
        <span>{run.total !== null ? tr("dashboard.canva_n_of_m_designs", { n: run.results.length, m: run.total }) : tr("dashboard.canva_reading_folders")}</span>
        <span className="tabular-nums text-neutral-400">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
        <div className="h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 flex min-h-5 items-center gap-1.5 truncate text-xs text-neutral-500">
        {!run.done && <Loader2 size={13} className="shrink-0 animate-spin" />}
        <span className="truncate">{statusLine(run)}</span>
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-emerald-50 py-2"><div className="text-lg font-semibold text-emerald-700">{c.imported}</div><div className="text-[11px] text-emerald-700">{tr("dashboard.imported")}</div></div>
        <div className="rounded-xl bg-neutral-100 py-2"><div className="text-lg font-semibold text-neutral-700">{c.skipped}</div><div className="text-[11px] text-neutral-500">{tr("dashboard.canva_already_imported")}</div></div>
        <div className="rounded-xl bg-red-50 py-2"><div className="text-lg font-semibold text-red-700">{c.failed}</div><div className="text-[11px] text-red-700">{tr("dashboard.failed")}</div></div>
      </div>
      {images.length > 0 && (
        <p className="mt-3 text-xs text-neutral-500">{tr("dashboard.canva_n_as_images", { count: images.length })}</p>
      )}
      {failed.length > 0 && (
        <ul className="oc-scroll mt-3 max-h-40 overflow-y-auto rounded-xl border border-red-100 p-2 text-xs">
          {failed.map((r, i) => (
            <li key={`${r.name}-${i}`} className="flex gap-1.5 py-0.5 text-red-700">
              <FileWarning size={13} className="mt-0.5 shrink-0" />
              <span className="min-w-0"><span className="font-medium">{r.name}</span>{r.detail ? `: ${r.detail}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
      {run.done && failed.length > 0 && <p className="mt-2 text-xs text-neutral-500">{tr("dashboard.canva_rerun_hint")}</p>}
      {!run.done && <p className="mt-3 text-xs text-neutral-500">{tr("dashboard.canva_background_hint")}</p>}
      <div className="mt-5 flex justify-end gap-2">
        {run.done ? (
          <Button onClick={dismiss}><CheckCircle2 size={16} /> {tr("dashboard.done")}</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={stop} disabled={run.stopped}>{tr("dashboard.stop_import")}</Button>
            <Button variant="secondary" onClick={() => setDetailsOpen(false)}>{tr("dashboard.canva_continue_in_background")}</Button>
          </>
        )}
      </div>
    </Modal>
  );
}
