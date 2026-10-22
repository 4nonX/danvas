// The full list of export profiles or print presets: the user's own (the
// settings page) or a workspace's (its Members page, next to its colour
// profiles). Create, edit every setting, rename, describe, make default,
// duplicate, copy a shared one into one's own, delete. The settings can also
// be changed where they are used: pick the profile in the download menu or
// print dialog, change it, "Update"; "Save as" there starts a new one.

import { useCallback, useEffect, useState } from "react";
import { Copy, CopyPlus, FileDown, Pencil, Plus, Printer, Star, Trash2 } from "lucide-react";
import type { ExportProfile, ExportProfileKind, ExportProfileView } from "@hc/sdk";
import Link from "next/link";
import { oc } from "@/lib/sdk";
import { dashboardPath } from "@/components/dashboard/views";
import { useToast } from "@/components/ui/Toast";
import { userMessage } from "@/lib/errors";
import { describeSettings, defaultExportSettings, freeName, normalizeSettings } from "@/lib/exportProfiles";
import { defaultPrintSettings, describePrintSettings, normalizePrintSettings } from "@/lib/printPresets";
import { listProfileOptions, type ProfileOption } from "@/lib/print/profiles";
import { useDateFormat } from "@/lib/datetime";
import { tr } from "@/lib/i18n";
import { ProfileSettingsEditor } from "./ProfileSettingsEditor";

type Props =
  | { kind: ExportProfileKind; scope: "personal" }
  | { kind: ExportProfileKind; scope: "workspace"; workspaceId: string };

export function ProfileManager(props: Props) {
  const { kind, scope } = props;
  const workspaceId = props.scope === "workspace" ? props.workspaceId : null;
  const print = kind === "print";
  const toast = useToast();
  const df = useDateFormat();
  const [view, setView] = useState<ExportProfileView | null>(null);
  const [icc, setIcc] = useState<ProfileOption[]>([]);
  const [editing, setEditing] = useState<{ id: string; field: "name" | "description"; value: string } | null>(null);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const [editingSettings, setEditingSettings] = useState<ExportProfile | null>(null);
  const [busy, setBusy] = useState(false);
  // Two kinds, two vocabularies: both texts are literal keys.
  const t = (exportText: string, printText: string) => (print ? printText : exportText);

  const load = useCallback(async (): Promise<ExportProfileView> => {
    if (workspaceId) return oc.listExportProfiles(workspaceId, kind);
    return { profiles: await oc.listPersonalExportProfiles(kind), managedBy: "admins", canManageWorkspace: false, canConfigure: false };
  }, [kind, workspaceId]);

  const reload = useCallback(async () => {
    try { setView(await load()); } catch { setView({ profiles: [], managedBy: "admins", canManageWorkspace: false, canConfigure: false }); }
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void load().then(
      (v) => { if (!cancelled) setView(v); },
      () => { if (!cancelled) setView({ profiles: [], managedBy: "admins", canManageWorkspace: false, canConfigure: false }); },
    );
    if (!print) void listProfileOptions(workspaceId).then((list) => { if (!cancelled) setIcc(list); }, () => undefined);
    return () => { cancelled = true; };
  }, [load, print, workspaceId]);

  if (!view) return null;

  // Only this scope's profiles: the workspace list also carries the user's own.
  const list = view.profiles.filter((p) => p.scope === scope);
  const canEdit = scope === "personal" || view.canManageWorkspace;
  const describe = (p: ExportProfile) => (print ? describePrintSettings(normalizePrintSettings(p.settings)) : describeSettings(normalizeSettings(p.settings), (id) => icc.find((o) => o.id === id)?.name));

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await fn();
      await reload();
      if (done) toast.success(done);
    } catch (e) {
      toast.error(userMessage(e, t(tr("editor.could_not_save_export_profile"), tr("editor.could_not_save_print_preset"))));
    } finally {
      setBusy(false);
    }
  }

  function create(into: "personal" | "workspace", name: string, settings: ExportProfile["settings"], description = "") {
    const taken = (view?.profiles ?? []).filter((p) => p.scope === into).map((p) => p.name);
    const input = { kind, name: freeName(name, taken), description, settings };
    return into === "workspace" && workspaceId
      ? oc.createExportProfile(workspaceId, { ...input, scope: "workspace" })
      : oc.createPersonalExportProfile(input);
  }

  async function commitEdit() {
    if (!editing) return;
    const { id, field, value } = editing;
    setEditing(null);
    const p = list.find((x) => x.id === id);
    const v = value.trim();
    if (!p || (field === "name" && !v) || p[field] === v) return;
    await run(() => oc.updateExportProfile(id, { [field]: v }));
  }

  async function remove(p: ExportProfile) {
    if (armedDelete !== p.id) {
      setArmedDelete(p.id);
      setTimeout(() => setArmedDelete((cur) => (cur === p.id ? null : cur)), 3500);
      return;
    }
    setArmedDelete(null);
    await run(() => oc.deleteExportProfile(p.id), t(tr("editor.export_profile_deleted", { name: p.name }), tr("editor.print_preset_deleted", { name: p.name })));
  }

  const blank = () => (print ? defaultPrintSettings() : defaultExportSettings()) as unknown as ExportProfile["settings"];
  const action = "flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-50";
  const input = "h-7 min-w-0 flex-1 rounded-md border border-neutral-300 px-2 text-sm outline-none focus:border-brand-400";
  const Icon = print ? Printer : FileDown;

  return (
    <section className={scope === "workspace" ? "mt-8" : ""}>
      <h2 className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-neutral-400">
        <Icon size={15} /> {t(tr("editor.export_profiles"), tr("editor.print_presets"))}
      </h2>
      <p className="mb-3 max-w-xl text-xs text-neutral-500">
        {scope === "workspace"
          ? t(tr("editor.export_profiles_workspace_hint"), tr("editor.print_presets_workspace_hint"))
          : t(tr("editor.export_profiles_personal_hint"), tr("editor.print_presets_personal_hint"))}
      </p>

      {scope === "workspace" && view.canConfigure && workspaceId && (
        <label className="mb-3 flex max-w-xl flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-neutral-50/60 p-3 text-xs text-neutral-600">
          <span>{t(tr("editor.export_profiles_managed_by"), tr("editor.print_presets_managed_by"))}</span>
          <select
            value={view.managedBy}
            disabled={busy}
            onChange={(e) => void run(() => oc.setExportProfilesManagedBy(workspaceId, e.target.value as ExportProfileView["managedBy"], kind))}
            className="h-8 rounded-lg border border-neutral-200 bg-surface px-2 text-xs text-neutral-800"
          >
            <option value="admins">{tr("editor.managed_by_admins")}</option>
            <option value="members">{tr("editor.managed_by_members")}</option>
          </select>
          {/* F42: the switch sets the Member role's bundle; any other role is set on the roles page. */}
          <span className="basis-full text-[11px] text-neutral-500">
            {tr("roles.managed_by_hint")}{" "}
            <Link href={dashboardPath("roles")} className="font-semibold text-brand-ink hover:text-brand-800">
              {tr("roles.title")}
            </Link>
          </span>
        </label>
      )}

      {canEdit && (
        <button type="button" disabled={busy} onClick={() => void run(() => create(scope, t(tr("editor.export_profile_new_name"), tr("editor.print_preset_new_name")), blank()))} className={`${action} mb-2 border border-neutral-200`}>
          <Plus size={13} /> {t(tr("editor.export_profile_new"), tr("editor.print_preset_new"))}
        </button>
      )}

      {list.length === 0 && (
        <p className="rounded-xl border border-dashed border-neutral-200 px-3 py-3 text-xs text-neutral-400">
          {t(tr("editor.export_profiles_empty"), tr("editor.print_presets_empty"))}
        </p>
      )}

      <ul className="flex flex-col gap-1.5">
        {list.map((p) => (
          <li key={p.id} className="flex flex-col gap-1 rounded-xl border border-neutral-200 bg-surface px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              {editing?.id === p.id && editing.field === "name" ? (
                <input
                  autoFocus
                  value={editing.value}
                  maxLength={120}
                  aria-label={tr("editor.export_profile_name")}
                  onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                  onBlur={() => void commitEdit()}
                  onKeyDown={(e) => { if (e.key === "Enter") void commitEdit(); if (e.key === "Escape") setEditing(null); }}
                  className={input}
                />
              ) : (
                <button
                  type="button"
                  disabled={!canEdit}
                  title={canEdit ? tr("dashboard.rename") : undefined}
                  onClick={() => setEditing({ id: p.id, field: "name", value: p.name })}
                  className="min-w-0 truncate text-start font-medium text-neutral-800 enabled:hover:underline"
                >
                  {p.name}
                </button>
              )}
              {p.isDefault && (
                <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-ink">{tr("dashboard.default")}</span>
              )}
              <span className="ms-auto flex flex-wrap items-center gap-1">
                {canEdit && (
                  <button type="button" disabled={busy} onClick={() => setEditingSettings(p)} className={action}>
                    <Pencil size={13} /> {tr("editor.profile_edit")}
                  </button>
                )}
                {canEdit && (
                  <button type="button" disabled={busy} onClick={() => void run(() => oc.updateExportProfile(p.id, { isDefault: !p.isDefault }))} className={action}>
                    <Star size={13} className={p.isDefault ? "fill-current" : ""} /> {p.isDefault ? tr("editor.export_profile_unset_default") : tr("dashboard.make_default")}
                  </button>
                )}
                {canEdit && (
                  <button type="button" disabled={busy} onClick={() => void run(() => create(scope, p.name, p.settings, p.description))} className={action}>
                    <CopyPlus size={13} /> {tr("editor.export_profile_duplicate")}
                  </button>
                )}
                {scope === "workspace" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => create("personal", p.name, p.settings, p.description), tr("editor.export_profile_copied", { name: p.name }))}
                    className={action}
                  >
                    <Copy size={13} /> {tr("editor.export_profile_copy_to_mine")}
                  </button>
                )}
                {canEdit && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void remove(p)}
                    className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition ${armedDelete === p.id ? "bg-red-50 text-red-600 ring-1 ring-red-300" : "text-neutral-400 hover:bg-neutral-100 hover:text-red-600"}`}
                  >
                    <Trash2 size={13} /> {armedDelete === p.id ? tr("dashboard.click_again_to_remove") : tr("dashboard.remove")}
                  </button>
                )}
              </span>
            </div>
            {editing?.id === p.id && editing.field === "description" ? (
              <input
                autoFocus
                value={editing.value}
                maxLength={500}
                placeholder={tr("editor.export_profile_description_placeholder")}
                aria-label={tr("editor.export_profile_description")}
                onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                onBlur={() => void commitEdit()}
                onKeyDown={(e) => { if (e.key === "Enter") void commitEdit(); if (e.key === "Escape") setEditing(null); }}
                className={input}
              />
            ) : (
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => setEditing({ id: p.id, field: "description", value: p.description })}
                className="text-start text-xs text-neutral-600 enabled:hover:underline"
              >
                {p.description || (canEdit ? <span className="text-neutral-400">{tr("editor.export_profile_add_description")}</span> : null)}
              </button>
            )}
            <span className="text-[11px] leading-snug text-neutral-400">{describe(p)}</span>
            {scope === "workspace" && p.updatedByName && (
              <span className="text-[11px] text-neutral-400">{tr("editor.export_profile_changed_by", { name: p.updatedByName, when: df.relative(p.updatedAt) })}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 max-w-xl text-[11px] text-neutral-400">{t(tr("editor.export_profiles_edit_hint"), tr("editor.print_presets_edit_hint"))}</p>
      {editingSettings && (
        <ProfileSettingsEditor
          profile={editingSettings}
          print={print}
          workspaceId={workspaceId}
          onClose={() => setEditingSettings(null)}
          onSave={async (settings) => {
            // Errors reach the editor, which stays open with the changes.
            await oc.updateExportProfile(editingSettings.id, { settings });
            await reload();
            toast.success(t(tr("editor.export_profile_updated", { name: editingSettings.name }), tr("editor.print_preset_updated", { name: editingSettings.name })));
          }}
        />
      )}
    </section>
  );
}
