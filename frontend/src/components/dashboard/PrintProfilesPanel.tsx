// Workspace print profiles: the ICC CMYK output profiles print exports
// convert through and embed. An admin uploads the profile their print shop
// works to (the common coated ones may not be redistributed, so they are not
// shipped); every member sees the list, since every member exports.

import { useCallback, useEffect, useRef, useState } from "react";
import { Printer, Star, Trash2, Upload } from "lucide-react";
import type { PrintProfile } from "@hc/sdk";
import { oc } from "@/lib/sdk";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { userMessage } from "@/lib/errors";
import { createCmykConverter } from "@/lib/print/cms";
import { tr } from "@/lib/i18n";

export function PrintProfilesPanel({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const toast = useToast();
  const [profiles, setProfiles] = useState<PrintProfile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setProfiles(await oc.listPrintProfiles(workspaceId));
    } catch {
      setProfiles([]);
    }
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    void oc.listPrintProfiles(workspaceId).then(
      (list) => { if (!cancelled) setProfiles(list); },
      () => { if (!cancelled) setProfiles([]); },
    );
    return () => { cancelled = true; };
  }, [workspaceId]);

  async function upload(file: File) {
    setBusy(true);
    try {
      // Prove the colour tables work before storing anything: a profile that
      // only has a valid header would fail later, at export time.
      const bytes = new Uint8Array(await file.arrayBuffer());
      try {
        (await createCmykConverter(bytes)).dispose();
      } catch {
        toast.error(tr("dashboard.print_profile_not_usable"));
        return;
      }
      const p = await oc.uploadPrintProfile(workspaceId, file);
      toast.success(tr("dashboard.print_profile_added", { name: p.name }));
      await reload();
    } catch (e) {
      toast.error(userMessage(e, tr("dashboard.could_not_upload_print_profile")));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function makeDefault(p: PrintProfile) {
    try {
      await oc.updatePrintProfile(p.id, { isDefault: true });
      await reload();
    } catch (e) {
      toast.error(userMessage(e, tr("dashboard.could_not_update_print_profile")));
    }
  }

  async function rename() {
    if (!renaming) return;
    const name = renaming.name.trim();
    const id = renaming.id;
    setRenaming(null);
    if (!name || profiles?.find((p) => p.id === id)?.name === name) return;
    try {
      await oc.updatePrintProfile(id, { name });
      await reload();
    } catch (e) {
      toast.error(userMessage(e, tr("dashboard.could_not_update_print_profile")));
    }
  }

  async function remove(p: PrintProfile) {
    if (armedDelete !== p.id) {
      setArmedDelete(p.id);
      setTimeout(() => setArmedDelete((cur) => (cur === p.id ? null : cur)), 3500);
      return;
    }
    setArmedDelete(null);
    try {
      await oc.deletePrintProfile(p.id);
      await reload();
    } catch (e) {
      toast.error(userMessage(e, tr("dashboard.could_not_update_print_profile")));
    }
  }

  const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;

  return (
    <section className="mt-8">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-neutral-400">
        <Printer size={15} /> {tr("dashboard.print_profiles")}
      </h2>
      <p className="mb-3 max-w-xl text-xs text-neutral-500">{tr("dashboard.print_profiles_hint")}</p>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50/60 p-3">
          <p className="min-w-0 flex-1 text-xs text-neutral-500">{tr("dashboard.print_profiles_upload_hint")}</p>
          <input
            ref={fileRef}
            type="file"
            accept=".icc,.icm,application/vnd.iccprofile"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
          />
          <Button size="sm" className="gap-1" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload size={15} /> {busy ? tr("dashboard.checking_profile") : tr("dashboard.upload_icc_profile")}
          </Button>
        </div>
      )}

      <ul className="mt-3 flex flex-col gap-1.5">
        {(profiles ?? []).map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-surface px-3 py-2 text-sm">
            {renaming?.id === p.id ? (
              <input
                autoFocus
                value={renaming.name}
                maxLength={120}
                aria-label={tr("dashboard.profile_name")}
                onChange={(e) => setRenaming({ id: p.id, name: e.target.value })}
                onBlur={() => void rename()}
                onKeyDown={(e) => { if (e.key === "Enter") void rename(); if (e.key === "Escape") setRenaming(null); }}
                className="h-7 min-w-0 flex-1 rounded-md border border-neutral-300 px-2 text-sm outline-none focus:border-brand-400"
              />
            ) : (
              <button
                type="button"
                disabled={!canEdit}
                title={canEdit ? tr("dashboard.rename") : undefined}
                onClick={() => setRenaming({ id: p.id, name: p.name })}
                className="min-w-0 truncate text-start font-medium text-neutral-800 enabled:hover:underline"
              >
                {p.name}
              </button>
            )}
            {p.description && p.description !== p.name && (
              <span className="truncate text-xs text-neutral-400">{p.description}</span>
            )}
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] text-neutral-500">ICC {p.iccVersion} · {mb(p.sizeBytes)}</span>
            {p.isDefault && (
              <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-ink">{tr("dashboard.default")}</span>
            )}
            {canEdit && (
              <span className="ms-auto flex items-center gap-1">
                {!p.isDefault && (
                  <button type="button" onClick={() => void makeDefault(p)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800">
                    <Star size={13} /> {tr("dashboard.make_default")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void remove(p)}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition ${armedDelete === p.id ? "bg-red-50 text-red-600 ring-1 ring-red-300" : "text-neutral-400 hover:bg-neutral-100 hover:text-red-600"}`}
                >
                  <Trash2 size={13} /> {armedDelete === p.id ? tr("dashboard.click_again_to_remove") : tr("dashboard.remove")}
                </button>
              </span>
            )}
          </li>
        ))}
        <li className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-neutral-200 px-3 py-2 text-sm">
          <span className="font-medium text-neutral-600">PSO Uncoated ISO12647 (FOGRA47)</span>
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-500">{tr("dashboard.built_in")}</span>
          {profiles !== null && profiles.length === 0 && (
            <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-ink">{tr("dashboard.default")}</span>
          )}
        </li>
      </ul>
    </section>
  );
}
