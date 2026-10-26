// Copy brand kits into other workspaces (brand.copy here, brand.kits there):
// tick the brands, or all of them, and the workspaces they go to. The server
// copies the uploads and fonts they use; the brands here stay as they are.

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import type { BrandKit, BrandKitCopyResult } from "@hc/sdk";
import { hasAction } from "@hc/authz";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/store/auth";
import { useWorkspaceActions } from "@/store/workspaceActions";
import { runBrandCopy } from "@/lib/brandCopy";
import { userMessage } from "@/lib/errors";
import { tr } from "@/lib/i18n";
import { KitChecklist, kitChoiceEmpty, type KitChoice } from "./KitChecklist";

export function BrandKitCopyDialog({ workspaceId, kits, initialKitId, onClose }: {
  workspaceId: string;
  kits: BrandKit[];
  /** The brand shown when the dialog opened: ticked to start with. */
  initialKitId?: string;
  onClose: () => void;
}) {
  const workspaces = useAuth((s) => s.workspaces).filter((w) => w.id !== workspaceId);
  const actions = useWorkspaceActions((s) => s.byWorkspace);
  const loadingActions = useWorkspaceActions((s) => s.loading);
  useEffect(() => {
    for (const w of workspaces) void useWorkspaceActions.getState().load(w.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaces.length]);
  const allowed = (id: string) => hasAction(actions[id]?.actions ?? null, "brand.kits");

  const [choice, setChoice] = useState<KitChoice>({ all: false, kitIds: initialKitId ? [initialKitId] : [] });
  const [targets, setTargets] = useState<string[]>([]);
  const [replace, setReplace] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<BrandKitCopyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);

  const busy = progress !== null;
  const nameOf = (id: string) => workspaces.find((w) => w.id === id)?.name ?? "";
  const box = "h-4 w-4 shrink-0 rounded border-neutral-300 accent-brand-500";

  const start = async () => {
    setError(null);
    setProgress({ done: 0, total: 0 });
    try {
      const res = await runBrandCopy(
        { sourceWorkspaceId: workspaceId, all: choice.all, kitIds: choice.kitIds, targetWorkspaceIds: targets, replace },
        (done, total) => setProgress({ done, total }),
        () => cancelled.current,
      );
      if (res) setResult(res);
    } catch (e) {
      setError(userMessage(e, tr("brand.copy_failed")));
    } finally {
      setProgress(null);
    }
  };

  return (
    <Modal open onClose={busy ? () => {} : onClose} title={tr("brand.copy_title")} width="w-[34rem] max-w-full">
      <div className="flex max-h-[75vh] flex-col gap-4 overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pe-1">
          {result ? (
            <div className="flex flex-col gap-2">
              {result.kits.map((it, i) => (
                <p key={i} className="flex items-start gap-2 text-sm">
                  {it.error
                    ? <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />
                    : <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-brand-600" />}
                  <span>
                    {it.error
                      ? tr("brand.copy_item_failed", { kit: it.kit, workspace: nameOf(it.workspaceId) })
                      : it.replaced
                        ? tr("brand.copy_item_replaced", { kit: it.kit, workspace: nameOf(it.workspaceId), name: it.name ?? it.kit })
                        : tr("brand.copy_item_new", { kit: it.kit, workspace: nameOf(it.workspaceId), name: it.name ?? it.kit })}
                  </span>
                </p>
              ))}
              {result.missingFonts.length > 0 && (
                <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-800">{tr("brand.copy_missing_fonts", { fonts: result.missingFonts.join(", ") })}</p>
              )}
            </div>
          ) : (
            <>
              <p className="text-sm text-neutral-500">{tr("brand.copy_hint")}</p>
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{tr("brand.copy_kits")}</h3>
                <KitChecklist kits={kits} value={choice} onChange={setChoice} disabled={busy} />
              </section>
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{tr("brand.copy_targets")}</h3>
                {workspaces.length === 0 ? (
                  <p className="text-sm text-neutral-500">{tr("brand.copy_no_targets")}</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {workspaces.map((w) => {
                      const known = actions[w.id] !== undefined || !loadingActions[w.id];
                      const ok = allowed(w.id);
                      return (
                        <label key={w.id} className={`flex items-center gap-2 text-sm ${ok ? "cursor-pointer text-neutral-700" : "text-neutral-400"}`}>
                          <input
                            type="checkbox"
                            checked={targets.includes(w.id)}
                            disabled={busy || !ok}
                            onChange={(e) => setTargets((t) => (e.target.checked ? [...t, w.id] : t.filter((x) => x !== w.id)))}
                            className={box}
                          />
                          <span className="truncate">{w.name}</span>
                          {!ok && known && <span className="shrink-0 text-[11px]">{tr("brand.copy_not_allowed")}</span>}
                          {!known && <Loader2 size={12} className="shrink-0 animate-spin" />}
                        </label>
                      );
                    })}
                  </div>
                )}
              </section>
              <label className="flex cursor-pointer items-start gap-2 text-sm text-neutral-700">
                <input type="checkbox" checked={replace} disabled={busy} onChange={(e) => setReplace(e.target.checked)} className={`${box} mt-0.5`} />
                <span>{tr("brand.copy_replace")}</span>
              </label>
              {error && <p className="rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-700">{error}</p>}
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 pt-3">
          {progress && (
            <span className="me-auto flex items-center gap-1.5 text-xs text-neutral-500">
              <Loader2 size={13} className="animate-spin" />
              {progress.total ? tr("brand.copy_progress", { done: progress.done, total: progress.total }) : tr("brand.copy_starting")}
            </span>
          )}
          {result ? (
            <Button onClick={onClose}>{tr("brand.copy_close")}</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={onClose} disabled={busy}>{tr("dashboard.cancel")}</Button>
              <Button onClick={() => void start()} disabled={busy || kitChoiceEmpty(choice) || targets.length === 0}>{tr("brand.copy_start")}</Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
