// Export settings to a file and import such a file, here or on another danvas
// instance (lib/settingsPackage): a workspace's, where each kind of setting has
// a right of its own to export, or a person's own. What the file holds is listed
// before anything is imported, and an import uses the ordinary rights of what it
// creates.

import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import type { Action } from "@hc/authz";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { oc } from "@/lib/sdk";
import { userMessage } from "@/lib/errors";
import { tr } from "@/lib/i18n";
import { exportSettingsPackage, importSettingsPackage, OPT_IN_PARTS, PART_ACTION, partCount, PERSONAL_PARTS, readSettingsPackage, SETTINGS_PARTS, type ExportSources, type ImportTarget, type SettingsConflict, type SettingsImportResult, type SettingsPackage, type SettingsPart } from "@/lib/settingsPackage";
import { setShortcutOverrides, shortcutOverrides } from "@/lib/shortcuts";

const partLabel = (): Record<SettingsPart, string> => ({
  exportProfiles: tr("dashboard.settings_part_export_profiles"),
  printPresets: tr("dashboard.settings_part_print_presets"),
  colorProfiles: tr("dashboard.settings_part_color_profiles"),
  colorLibraries: tr("dashboard.settings_part_color_libraries"),
  roles: tr("dashboard.settings_part_roles"),
  workspaceRules: tr("dashboard.settings_part_workspace_rules"),
  folderDefaults: tr("dashboard.settings_part_folder_defaults"),
  memberEmails: tr("dashboard.settings_part_member_emails"),
  uiPrefs: tr("dashboard.settings_part_ui_prefs"),
  shortcuts: tr("dashboard.settings_part_shortcuts"),
});

/** The right an import of each part needs. */
const IMPORT_ACTION: Partial<Record<SettingsPart, Action>> = {
  exportProfiles: "print.exportProfiles",
  printPresets: "print.printPresets",
  colorProfiles: "print.colorProfiles",
  colorLibraries: "print.colorProfiles",
  roles: "roles.manage",
  workspaceRules: "roles.manage",
  folderDefaults: "folder.defaults",
  memberEmails: "members.invite",
};

const toBase64 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Where a file's parts come from and go to: a workspace's over its export
 *  routes and ordinary routes, a person's over their own (workspaceId null). */
function sourcesOf(workspaceId: string | null): ExportSources {
  if (workspaceId) {
    return {
      part: (part) => oc.settingsExportPart(workspaceId, part as never),
      iccBytes: () => workspaceIcc(workspaceId),
    };
  }
  return {
    iccBytes: async () => Promise.all((await oc.listMyPrintProfiles()).map(async (p) => ({ id: p.id, bytes: await oc.printProfileData(p.id) }))),
    part: async (part) => {
      if (part === "exportProfiles") return { profiles: await oc.listPersonalExportProfiles("export") };
      if (part === "printPresets") return { profiles: await oc.listPersonalExportProfiles("print") };
      if (part === "colorProfiles") {
        const list = await oc.listMyPrintProfiles();
        return { profiles: await Promise.all(list.map(async (p) => ({ name: p.name, description: p.description, isDefault: p.isDefault, data: toBase64(await oc.printProfileData(p.id)) }))) };
      }
      if (part === "uiPrefs") return { prefs: await oc.uiPrefs() };
      if (part === "shortcuts") return { shortcuts: shortcutOverrides() };
      return {};
    },
  };
}

function targetOf(workspaceId: string | null): ImportTarget {
  if (!workspaceId) {
    return {
      iccBytes: async () => Promise.all((await oc.listMyPrintProfiles()).map(async (p) => ({ id: p.id, bytes: await oc.printProfileData(p.id) }))),
      uploadIcc: (bytes, name) => oc.uploadMyPrintProfile(new Blob([bytes as BlobPart]), name),
      profiles: (kind) => oc.listPersonalExportProfiles(kind),
      createProfile: (kind, p) => oc.createPersonalExportProfile({ kind, ...p }),
      updateProfile: (id, p) => oc.updateExportProfile(id, p),
      libraries: async () => [],
      createLibrary: async () => undefined,
      deleteLibrary: async () => undefined,
      setUiPref: (key, value) => oc.setUiPref(key, value),
      setShortcuts: setShortcutOverrides,
    };
  }
  return {
    iccBytes: () => workspaceIcc(workspaceId),
    uploadIcc: (bytes, name) => oc.uploadPrintProfile(workspaceId, new Blob([bytes as BlobPart]), name),
    profiles: async (kind) => (await oc.listExportProfiles(workspaceId, kind)).profiles.filter((p) => p.scope === "workspace"),
    createProfile: (kind, p) => oc.createExportProfile(workspaceId, { kind, scope: "workspace", ...p }),
    updateProfile: (id, p) => oc.updateExportProfile(id, p),
    libraries: () => oc.listColorLibraries(workspaceId),
    createLibrary: (l) => oc.createColorLibrary(workspaceId, l),
    deleteLibrary: (id) => oc.deleteColorLibrary(id),
    rolesView: () => oc.workspaceRoles(workspaceId),
    createPermission: (p) => oc.createWorkspacePermission(workspaceId, p as never),
    updatePermission: (id, p) => oc.updateWorkspacePermission(id, p as never),
    createRole: (r) => oc.createWorkspaceRole(workspaceId, r),
    updateRole: (id, r) => oc.updateWorkspaceRole(id, r),
    setRules: async (rules) => {
      if (typeof rules.requireApproval === "boolean") await oc.setPrintPolicy(workspaceId, rules.requireApproval);
      if (rules.exportManagedBy) await oc.setExportProfilesManagedBy(workspaceId, rules.exportManagedBy as never, "export");
      if (rules.printManagedBy) await oc.setExportProfilesManagedBy(workspaceId, rules.printManagedBy as never, "print");
    },
    folders: () => oc.listDesignFolders(workspaceId),
    setFolderDefault: (folderId, kind, profileId) => oc.setFolderDefault(folderId, kind, profileId),
    memberEmails: async () => {
      const [members, invites] = await Promise.all([oc.workspaceMembers(workspaceId), oc.workspaceInvitations(workspaceId)]);
      return [...members.map((m) => m.email), ...invites.map((i) => i.email)];
    },
    invite: (email, roleId) => oc.invite(workspaceId, { email, ...(roleId ? { roleId } : {}) }),
  };
}

async function workspaceIcc(workspaceId: string) {
  const list = await oc.listPrintProfiles(workspaceId);
  return Promise.all(list.map(async (p) => ({ id: p.id, bytes: await oc.printProfileData(p.id) })));
}

function ExportDialog({ workspaceId, allowed, onClose }: { workspaceId: string | null; allowed: SettingsPart[]; onClose: () => void }) {
  const toast = useToast();
  const labels = partLabel();
  const [chosen, setChosen] = useState<SettingsPart[]>(allowed.filter((p) => !OPT_IN_PARTS.includes(p)));
  const [busy, setBusy] = useState(false);
  const licensed = chosen.includes("colorProfiles") || chosen.includes("colorLibraries");

  async function run() {
    setBusy(true);
    try {
      const { blob, failed } = await exportSettingsPackage(chosen, sourcesOf(workspaceId));
      const name = `danvas-${tr("dashboard.settings_file_name")}-${new Date().toISOString().slice(0, 10)}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (failed.length) toast.error(tr("dashboard.settings_export_partial", { parts: failed.map((p) => labels[p]).join(", ") }));
      else toast.success(tr("dashboard.settings_exported", { file: name }));
      onClose();
    } catch (e) {
      toast.error(userMessage(e, tr("dashboard.settings_export_failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} title={tr("dashboard.settings_export_title")}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-neutral-500">{tr("dashboard.settings_export_desc")}</p>
        <div className="flex flex-col gap-1.5">
          {allowed.map((p) => (
            <label key={p} className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={chosen.includes(p)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, p] : c.filter((x) => x !== p)))} />
              {labels[p]}
            </label>
          ))}
        </div>
        {licensed && <p className="rounded-lg bg-amber-50 p-2.5 text-[11px] leading-snug text-amber-800">{tr("dashboard.settings_license_note")}</p>}
        {chosen.includes("memberEmails") && <p className="rounded-lg bg-amber-50 p-2.5 text-[11px] leading-snug text-amber-800">{tr("dashboard.settings_member_emails_note")}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{tr("dashboard.cancel")}</Button>
          <Button onClick={() => void run()} disabled={busy || !chosen.length}>{busy ? tr("dashboard.settings_working") : tr("dashboard.settings_export")}</Button>
        </div>
      </div>
    </Modal>
  );
}

function ImportDialog({ workspaceId, pkg, may, onClose, onChanged }: { workspaceId: string | null; pkg: SettingsPackage; may: (p: SettingsPart) => boolean; onClose: () => void; onChanged: () => void }) {
  const labels = partLabel();
  const toast = useToast();
  const inFile = (workspaceId ? SETTINGS_PARTS : PERSONAL_PARTS).filter((p) => partCount(pkg, p) > 0);
  const [chosen, setChosen] = useState<SettingsPart[]>(inFile.filter((p) => may(p) && !OPT_IN_PARTS.includes(p)));
  const [conflict, setConflict] = useState<SettingsConflict>("skip");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SettingsImportResult | null>(null);

  async function run() {
    setBusy(true);
    try {
      setResult(await importSettingsPackage(pkg, chosen, conflict, targetOf(workspaceId)));
      onChanged();
    } catch (e) {
      toast.error(userMessage(e, tr("dashboard.settings_import_failed")));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Modal open onClose={onClose} title={tr("dashboard.settings_import_title")}>
        <div className="flex flex-col gap-2 text-sm text-neutral-700">
          <p>{tr("dashboard.settings_import_result", { added: result.added, replaced: result.replaced, skipped: result.skipped })}</p>
          {result.withoutIcc.length > 0 && <p className="rounded-lg bg-amber-50 p-2.5 text-[11px] leading-snug text-amber-800">{tr("dashboard.settings_import_without_icc", { names: result.withoutIcc.join(", ") })}</p>}
          {result.unmatched.length > 0 && <p className="rounded-lg bg-amber-50 p-2.5 text-[11px] leading-snug text-amber-800">{tr("dashboard.settings_import_unmatched", { names: result.unmatched.join("; ") })}</p>}
          {result.failed.length > 0 && (
            <div className="rounded-lg bg-red-50 p-2.5 text-[11px] leading-snug text-red-700">
              <p className="mb-1 font-semibold">{tr("dashboard.settings_import_failed_items")}</p>
              <ul className="max-h-40 list-disc overflow-y-auto ps-4">
                {result.failed.map((f, i) => <li key={i}>{labels[f.part]}: {f.name} ({userMessage(f.reason, tr("dashboard.settings_import_failed"))})</li>)}
              </ul>
            </div>
          )}
          <div className="flex justify-end"><Button onClick={onClose}>{tr("editor.close")}</Button></div>
        </div>
      </Modal>
    );
  }

  const options: { id: SettingsConflict; label: string }[] = [
    { id: "skip", label: tr("dashboard.settings_conflict_skip") },
    { id: "keep", label: tr("dashboard.settings_conflict_keep") },
    { id: "replace", label: tr("dashboard.settings_conflict_replace") },
  ];
  return (
    <Modal open onClose={busy ? () => {} : onClose} title={tr("dashboard.settings_import_title")}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-neutral-500">{tr("dashboard.settings_import_desc")}</p>
        {inFile.length === 0 && <p className="text-sm text-neutral-600">{tr("dashboard.settings_import_empty")}</p>}
        <div className="flex flex-col gap-1.5">
          {inFile.map((p) => {
            const allowed = may(p);
            return (
              <label key={p} className={`flex items-center gap-2 text-sm ${allowed ? "cursor-pointer text-neutral-700" : "text-neutral-400"}`} title={allowed ? undefined : tr("dashboard.settings_import_no_right")}>
                <input type="checkbox" disabled={!allowed} className="h-4 w-4 accent-brand-600" checked={chosen.includes(p)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, p] : c.filter((x) => x !== p)))} />
                {labels[p]} ({partCount(pkg, p)})
              </label>
            );
          })}
        </div>
        {chosen.includes("memberEmails") && <p className="rounded-lg bg-amber-50 p-2.5 text-[11px] leading-snug text-amber-800">{tr("dashboard.settings_member_invite_note")}</p>}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">{tr("dashboard.settings_conflict")}</span>
          <select value={conflict} onChange={(e) => setConflict(e.target.value as SettingsConflict)} className="h-8 w-full rounded-lg border border-neutral-200 bg-surface px-2 text-xs outline-none focus:border-brand-400">
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{tr("dashboard.cancel")}</Button>
          <Button onClick={() => void run()} disabled={busy || !chosen.length}>{busy ? tr("dashboard.settings_working") : tr("dashboard.settings_import")}</Button>
        </div>
      </div>
    </Modal>
  );
}

/** The two buttons, for those who may do either. Without a workspace: the
 *  person's own settings, which are theirs to take. */
export function SettingsTransfer({ workspaceId, can, onChanged }: { workspaceId: string | null; can?: (a: Action) => boolean; onChanged?: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [pkg, setPkg] = useState<SettingsPackage | null>(null);
  const mayExport = (p: SettingsPart) => !workspaceId || (p in PART_ACTION && !!can?.(PART_ACTION[p as keyof typeof PART_ACTION]));
  const mayImportPart = (p: SettingsPart) => !workspaceId || (!!IMPORT_ACTION[p] && !!can?.(IMPORT_ACTION[p]!));
  const parts = workspaceId ? SETTINGS_PARTS : PERSONAL_PARTS;
  const allowed = parts.filter(mayExport);
  const mayImport = parts.some(mayImportPart);
  if (!allowed.length && !mayImport) return null;

  async function pick(f: File | undefined) {
    if (!f) return;
    try {
      setPkg(await readSettingsPackage(new Uint8Array(await f.arrayBuffer())));
    } catch (e) {
      toast.error(userMessage(e, tr("dashboard.settings_import_failed")));
    }
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2 px-2">
      {allowed.length > 0 && <Button variant="secondary" size="sm" onClick={() => setExporting(true)}><Download size={15} /> {tr("dashboard.settings_export_open")}</Button>}
      {mayImport && <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}><Upload size={15} /> {tr("dashboard.settings_import_open")}</Button>}
      <input ref={fileRef} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void pick(f); }} />
      {exporting && <ExportDialog workspaceId={workspaceId} allowed={allowed} onClose={() => setExporting(false)} />}
      {pkg && <ImportDialog workspaceId={workspaceId} pkg={pkg} may={mayImportPart} onClose={() => setPkg(null)} onChanged={() => onChanged?.()} />}
    </div>
  );
}
