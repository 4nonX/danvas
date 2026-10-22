// A folder's print defaults (F44): the export profile and the print preset
// its designs (and those of its subfolders) open with in the download menu
// and the print dialog. One picker per kind, of the workspace's profiles; a
// folder without its own default shows what it inherits from above. Roles
// without folder.defaults see the settings read-only.

import { useEffect, useState } from "react";
import { FileDown, Printer } from "lucide-react";
import type { DesignFolder, ExportProfile, ExportProfileKind, FolderDefaults } from "@hc/sdk";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { oc } from "@/lib/sdk";
import { userMessage } from "@/lib/errors";
import { tr } from "@/lib/i18n";

const field = "h-8 w-full min-w-0 rounded-lg border border-neutral-200 bg-surface px-2 text-xs text-neutral-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:opacity-60";

export function FolderDefaultsDialog({ folder, workspaceId, onClose }: { folder: DesignFolder; workspaceId: string; onClose: () => void }) {
  const toast = useToast();
  const [defaults, setDefaults] = useState<FolderDefaults | null>(null);
  const [profiles, setProfiles] = useState<Record<ExportProfileKind, ExportProfile[]> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      oc.folderDefaults(folder.id),
      oc.listExportProfiles(workspaceId, "export"),
      oc.listExportProfiles(workspaceId, "print"),
    ]).then(
      ([d, ex, pr]) => {
        if (cancelled) return;
        setDefaults(d);
        // Only the workspace's profiles: a personal one is not everyone's.
        setProfiles({ export: ex.profiles.filter((p) => p.scope === "workspace"), print: pr.profiles.filter((p) => p.scope === "workspace") });
      },
      (e) => { if (!cancelled) toast.error(userMessage(e, tr("dashboard.folder_defaults_load_failed"))); },
    );
    return () => { cancelled = true; };
  }, [folder.id, workspaceId, toast]);

  async function choose(kind: ExportProfileKind, profileId: string) {
    setBusy(true);
    try {
      setDefaults(await oc.setFolderDefault(folder.id, kind, profileId || null));
    } catch (e) {
      toast.error(userMessage(e, tr("dashboard.folder_defaults_save_failed")));
    } finally {
      setBusy(false);
    }
  }

  const row = (kind: ExportProfileKind) => {
    const list = profiles?.[kind] ?? [];
    const own = defaults?.own[kind] ?? "";
    const eff = defaults?.effective[kind];
    const inherited = !own && eff && eff.folderId !== folder.id ? eff : null;
    const inheritedName = inherited ? list.find((p) => p.id === inherited.profileId)?.name ?? "" : "";
    const Icon = kind === "print" ? Printer : FileDown;
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={`folder-default-${kind}`} className="flex items-center gap-1.5 text-xs font-medium text-neutral-700">
          <Icon size={14} /> {kind === "print" ? tr("dashboard.folder_default_print") : tr("dashboard.folder_default_export")}
        </label>
        <select id={`folder-default-${kind}`} value={own} disabled={busy || !defaults?.canEdit} onChange={(e) => void choose(kind, e.target.value)} className={field}>
          <option value="">{inherited ? tr("dashboard.folder_default_inherit", { name: inheritedName, folder: inherited.folderName }) : tr("dashboard.folder_default_none")}</option>
          {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {list.length === 0 && <p className="text-[11px] text-neutral-400">{kind === "print" ? tr("dashboard.folder_default_no_presets") : tr("dashboard.folder_default_no_profiles")}</p>}
      </div>
    );
  };

  return (
    <Modal open onClose={busy ? () => {} : onClose} title={tr("dashboard.folder_defaults_title", { name: folder.name })} width="w-[28rem] max-w-full">
      {!defaults || !profiles ? (
        <p className="py-6 text-center text-sm text-neutral-500">{tr("dashboard.folder_defaults_loading")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-neutral-500">{tr("dashboard.folder_defaults_hint")}</p>
          {row("export")}
          {row("print")}
          {!defaults.canEdit && <p className="rounded-lg bg-neutral-50 px-3 py-2 text-[11px] text-neutral-500">{tr("dashboard.folder_defaults_read_only")}</p>}
          <div className="flex justify-end pt-1">
            <Button onClick={onClose} disabled={busy}>{tr("dashboard.folder_defaults_done")}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
