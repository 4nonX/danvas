// Copy or move designs and folders to another workspace (with the uploads and
// library fonts they use), or copy them to a folder of this workspace; the
// server does the work as a job. Opened from a design's or folder's menu, or
// for the selection from the selection bar.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Folder as FolderIcon, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import type { DesignFolder, DesignTransferResult, WorkspaceWithRole } from "@hc/sdk";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { oc } from "@/lib/sdk";
import { tr } from "@/lib/i18n";
import { userMessage } from "@/lib/errors";
import { childrenMap, type DragItems } from "./Folders";

type Mode = "copy" | "move";

const ERROR_TEXT = (): Record<string, string> => ({
  load_failed: tr("dashboard.transfer_error_load"),
  quota: tr("dashboard.transfer_error_quota"),
  forbidden: tr("dashboard.transfer_error_forbidden"),
  folder_failed: tr("dashboard.transfer_error_folder"),
  source_kept: tr("dashboard.transfer_error_source_kept"),
  failed: tr("dashboard.transfer_error_failed"),
});

export function TransferDialog({
  items, initialMode, initialTarget, excludeFolders, workspaces, currentWorkspaceId, titleOf, onClose, onDone, onOpenWorkspace,
}: {
  items: DragItems;
  initialMode: Mode;
  /** The workspace preselected (this one for "Copy to folder"). */
  initialTarget?: string;
  /** Folders of this workspace the items cannot go into: the folders being
   *  copied or moved and everything inside them. */
  excludeFolders?: Set<string>;
  workspaces: WorkspaceWithRole[];
  currentWorkspaceId: string;
  titleOf: (designId: string) => string;
  onClose: () => void;
  /** After a finished transfer; `changedHere`: this workspace's list changed
   *  (originals moved away, or copies added to it). */
  onDone: (changedHere: boolean) => void;
  onOpenWorkspace: (workspaceId: string) => void;
}) {
  // Workspaces the user may add designs to (member and up), this one first.
  const targets = workspaces
    .filter((w) => w.role !== "viewer")
    .sort((a, b) => Number(b.id === currentWorkspaceId) - Number(a.id === currentWorkspaceId));
  const [mode, setMode] = useState<Mode>(initialMode);
  const [target, setTarget] = useState<string>(
    targets.find((w) => w.id === initialTarget)?.id ?? targets.find((w) => w.id !== currentWorkspaceId)?.id ?? targets[0]?.id ?? "",
  );
  const here = target === currentWorkspaceId;
  // The target's folders, tagged with the workspace they were loaded for, so
  // a switch of target shows "loading" until its own folders arrive.
  const [loaded, setLoaded] = useState<{ ws: string; folders: DesignFolder[] } | null>(null);
  const folders = loaded && loaded.ws === target ? loaded.folders : null;
  const [folder, setFolder] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<DesignTransferResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);

  useEffect(() => {
    if (!target) return;
    let stop = false;
    oc.listDesignFolders(target)
      .then((f) => { if (!stop) setLoaded({ ws: target, folders: f }); })
      .catch(() => { if (!stop) setLoaded({ ws: target, folders: [] }); });
    return () => { stop = true; };
  }, [target]);

  const nDesigns = items.designIds.length;
  const nFolders = items.folderIds.length;
  const what = nFolders === 0 && nDesigns === 1
    ? tr("dashboard.transfer_one_design", { title: titleOf(items.designIds[0]) })
    : tr("dashboard.transfer_n_items", { designs: nDesigns, folders: nFolders });

  const start = async () => {
    setError(null);
    setProgress({ done: 0, total: 0 });
    try {
      const { jobId } = await oc.transferDesigns({
        designIds: items.designIds, folderIds: items.folderIds,
        targetWorkspaceId: target, targetFolderId: folder, move: mode === "move",
      });
      for (;;) {
        await new Promise((r) => setTimeout(r, 800));
        if (cancelled.current) return;
        const job = await oc.getJob<DesignTransferResult | { done: number; total: number }>(jobId);
        if (job.status === "completed") {
          const res = job.result as DesignTransferResult;
          setResult(res);
          setProgress(null);
          onDone((res.moved || here) && (res.designs.some((d) => !d.error) || res.folders > 0));
          return;
        }
        if (job.status === "failed") throw new Error(job.error || "transfer failed");
        const p = job.result as { done?: number; total?: number } | undefined;
        if (p && typeof p.done === "number" && typeof p.total === "number") setProgress({ done: p.done, total: p.total });
      }
    } catch (e) {
      setProgress(null);
      setError(userMessage(e, tr("dashboard.transfer_failed")));
    }
  };

  const busy = progress !== null;
  const kids = childrenMap(folders ?? []);
  const row = (f: DesignFolder | null, depth: number): ReactNode => {
    const id = f?.id ?? null;
    // Within this workspace a folder cannot go into itself.
    const children = (kids.get(id ?? "") ?? []).filter((c) => !(here && excludeFolders?.has(c.id)));
    const isOpen = id === null || expanded.has(id);
    return (
      <li key={id ?? "root"}>
        <div className={`flex items-center gap-1 rounded-lg pe-2 transition ${folder === id ? "bg-brand-50 text-brand-ink" : "hover:bg-neutral-50"}`} style={{ paddingInlineStart: depth * 16 }}>
          <button
            type="button"
            aria-label={isOpen ? tr("dashboard.collapse") : tr("dashboard.expand")}
            disabled={id === null || children.length === 0}
            onClick={() => id && setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
            className="grid h-7 w-6 shrink-0 place-items-center text-neutral-400 disabled:invisible"
          ><ChevronRight size={14} className={`transition ${isOpen ? "rotate-90" : ""}`} /></button>
          <button type="button" disabled={busy} onClick={() => setFolder(id)} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-start text-sm">
            <FolderIcon size={15} className="shrink-0 text-brand-600" />
            <span className="truncate">{f ? f.name : tr("dashboard.projects")}</span>
          </button>
        </div>
        {isOpen && children.length > 0 && <ul>{children.map((c) => row(c, depth + 1))}</ul>}
      </li>
    );
  };

  const targetName = targets.find((w) => w.id === target)?.name ?? "";
  const folderName = folder ? (folders?.find((f) => f.id === folder)?.name ?? "") : tr("dashboard.projects");

  // The outcome.
  if (result) {
    const ok = result.designs.filter((d) => !d.error);
    const failed = result.designs.filter((d) => d.error);
    const errors = ERROR_TEXT();
    return (
      <Modal open onClose={onClose} title={result.moved ? tr("dashboard.transfer_moved_title") : tr("dashboard.transfer_copied_title")} width="w-[30rem]">
        <p className="flex items-start gap-2 text-sm text-neutral-700">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
          <span>
            {here
              ? (result.moved ? tr("dashboard.transfer_moved_here", { folder: folderName }) : tr("dashboard.transfer_copied_here", { count: ok.length, folder: folderName }))
              : result.moved ? tr("dashboard.transfer_moved_n", { n: ok.length, workspace: targetName }) : tr("dashboard.transfer_copied_n", { n: ok.length, workspace: targetName })}
            {result.assets > 0 && <> {tr("dashboard.transfer_assets_n", { n: result.assets })}</>}
          </span>
        </p>
        {failed.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
            <div className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle size={13} /> {tr("dashboard.transfer_some_failed", { n: failed.length })}</div>
            <ul className="list-disc ps-4">
              {failed.map((d) => <li key={d.sourceId}>{d.title || titleOf(d.sourceId)}: {errors[d.error ?? "failed"] ?? errors.failed}</li>)}
            </ul>
          </div>
        )}
        {result.missingFonts.length > 0 && (
          <p className="mt-3 rounded-lg border border-neutral-200 p-2.5 text-xs text-neutral-600">{tr("dashboard.transfer_missing_fonts", { families: result.missingFonts.join(", ") })}</p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{tr("ui.close")}</Button>
          {ok.length > 0 && !here && <Button onClick={() => onOpenWorkspace(target)}>{tr("dashboard.transfer_open_workspace", { workspace: targetName })}</Button>}
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={() => { if (!busy) onClose(); }} title={tr("dashboard.transfer_title")} width="w-[30rem]">
      {targets.length === 0 ? (
        <p className="text-sm text-neutral-600">{tr("dashboard.transfer_no_targets")}</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-neutral-700">{what}</p>
          <div role="radiogroup" className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-neutral-100 p-1">
            {(["copy", "move"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                disabled={busy}
                onClick={() => setMode(m)}
                className={`rounded-md py-1.5 text-sm font-medium transition ${mode === m ? "bg-surface text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"}`}
              >
                {m === "copy" ? tr("dashboard.transfer_copy") : tr("dashboard.transfer_move")}
              </button>
            ))}
          </div>
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">{tr("dashboard.transfer_target_workspace")}</span>
            <select
              value={target}
              disabled={busy}
              onChange={(e) => { setTarget(e.target.value); setFolder(null); }}
              className="w-full rounded-lg border border-neutral-200 bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand-400"
            >
              {targets.map((w) => <option key={w.id} value={w.id}>{w.id === currentWorkspaceId ? tr("dashboard.transfer_this_workspace", { workspace: w.name }) : w.name}</option>)}
            </select>
          </label>
          <span className="mb-1 block text-xs font-medium text-neutral-500">{tr("dashboard.transfer_target_folder")}</span>
          {folders === null ? (
            <div className="flex h-20 items-center justify-center rounded-xl border border-neutral-200"><Loader2 size={16} className="animate-spin text-neutral-400" /></div>
          ) : (
            <ul className="oc-scroll max-h-[30vh] overflow-y-auto rounded-xl border border-neutral-200 p-1">{row(null, 0)}</ul>
          )}
          <p className="mt-3 text-[11px] leading-snug text-neutral-500">
            {here
              ? (mode === "move" ? tr("dashboard.transfer_move_hint_here") : tr("dashboard.transfer_copy_hint_here"))
              : mode === "move" ? tr("dashboard.transfer_move_hint") : tr("dashboard.transfer_copy_hint")}
          </p>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          {busy && (
            <div className="mt-3">
              <div className="mb-1 text-xs text-neutral-500">
                {progress.total ? tr("dashboard.transfer_progress", { done: progress.done, total: progress.total }) : tr("dashboard.transfer_preparing")}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
                <div className="h-full bg-brand-600 transition-[width]" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 5}%` }} />
              </div>
            </div>
          )}
        </>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("dashboard.cancel")}</Button>
        {targets.length > 0 && (
          <Button onClick={() => void start()} disabled={busy || !target || folders === null}>
            {busy && <Loader2 size={14} className="animate-spin" />}
            {mode === "move" ? tr("dashboard.transfer_move_action") : tr("dashboard.transfer_copy_action")}
          </Button>
        )}
      </div>
    </Modal>
  );
}
