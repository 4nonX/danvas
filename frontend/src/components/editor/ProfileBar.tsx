// The profile picker of the download menu (export profiles) and the print
// dialog (print presets): choose saved settings, see what they do, update
// the chosen one or save the menu's settings as a new one. Opening the menu
// starts from the default (the user's, else the workspace's). The full list
// with rename, describe, duplicate, default and delete is on the settings
// pages (ProfileManager).

import { useEffect, useId, useState } from "react";
import type { ExportProfile, ExportProfileKind, ExportProfileView } from "@hc/sdk";
import { oc } from "@/lib/sdk";
import { defaultProfile, freeName } from "@/lib/exportProfiles";
import { useToast } from "@/components/ui/Toast";
import { userMessage } from "@/lib/errors";
import { ManageProfilesLinks } from "@/components/editor/ManageProfilesLinks";
import { tr } from "@/lib/i18n";

export interface ProfileBarProps<T> {
  kind: ExportProfileKind;
  open: boolean;
  workspaceId: string | null;
  /** The menu's settings now. */
  current: T;
  normalize: (raw: unknown) => T;
  /** Whether `current` still matches the saved settings. */
  same: (current: T, saved: T) => boolean;
  describe: (settings: T) => string;
  /** Load settings into the menu. */
  onApply: (settings: T) => void;
}

async function loadView(kind: ExportProfileKind, workspaceId: string | null): Promise<ExportProfileView> {
  if (workspaceId) return oc.listExportProfiles(workspaceId, kind);
  return { profiles: await oc.listPersonalExportProfiles(kind), managedBy: "admins", canManageWorkspace: false, canConfigure: false };
}

export function ProfileBar<T>({ kind, open, workspaceId, current, normalize, same, describe, onApply }: ProfileBarProps<T>) {
  const toast = useToast();
  const id = useId();
  const [view, setView] = useState<ExportProfileView | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; description: string; scope: "personal" | "workspace"; isDefault: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const print = kind === "print";
  // Two kinds, two vocabularies: both texts are literal keys.
  const t = (exportText: string, printText: string) => (print ? printText : exportText);

  // Load when the menu opens; start from the default.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void loadView(kind, workspaceId).then(
      (v) => {
        if (cancelled) return;
        setView(v);
        const def = defaultProfile(v.profiles);
        if (def) {
          setActiveId(def.id);
          onApply(normalize(def.settings));
        }
      },
      () => { if (!cancelled) setView(null); },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onApply/normalize only set the menu's state; reload on open/workspace/kind is the intent
  }, [open, workspaceId, kind]);

  if (!view) return null;

  const active = view.profiles.find((p) => p.id === activeId) ?? null;
  const saved = active ? normalize(active.settings) : null;
  const modified = !!saved && !same(current, saved);
  const canEdit = (p: ExportProfile) => p.scope === "personal" || view.canManageWorkspace;
  const taken = (scope: "personal" | "workspace") => view.profiles.filter((p) => p.scope === scope).map((p) => p.name);

  async function reload() {
    try { setView(await loadView(kind, workspaceId)); } catch { /* the list stays as it was */ }
  }

  function pick(pid: string) {
    const p = view?.profiles.find((x) => x.id === pid) ?? null;
    setActiveId(p?.id ?? null);
    setForm(null);
    if (p) onApply(normalize(p.settings));
  }

  async function save() {
    if (!form) return;
    const name = form.name.trim();
    if (!name) return;
    if (taken(form.scope).some((n) => n.trim().toLowerCase() === name.toLowerCase())) {
      toast.error(tr("editor.export_profile_name_taken", { name }));
      return;
    }
    setBusy(true);
    try {
      const input = { kind, name, description: form.description.trim(), settings: current as unknown as ExportProfile["settings"], isDefault: form.isDefault };
      const created = workspaceId
        ? await oc.createExportProfile(workspaceId, { ...input, scope: form.scope })
        : await oc.createPersonalExportProfile(input);
      await reload();
      setActiveId(created.id);
      setForm(null);
      toast.success(t(tr("editor.export_profile_saved", { name: created.name }), tr("editor.print_preset_saved", { name: created.name })));
    } catch (e) {
      toast.error(userMessage(e, t(tr("editor.could_not_save_export_profile"), tr("editor.could_not_save_print_preset"))));
    } finally {
      setBusy(false);
    }
  }

  async function update() {
    if (!active) return;
    setBusy(true);
    try {
      await oc.updateExportProfile(active.id, { settings: current as unknown as ExportProfile["settings"] });
      await reload();
      toast.success(t(tr("editor.export_profile_updated", { name: active.name }), tr("editor.print_preset_updated", { name: active.name })));
    } catch (e) {
      toast.error(userMessage(e, t(tr("editor.could_not_save_export_profile"), tr("editor.could_not_save_print_preset"))));
    } finally {
      setBusy(false);
    }
  }

  const ws = view.profiles.filter((p) => p.scope === "workspace");
  const mine = view.profiles.filter((p) => p.scope === "personal");
  const label = (p: ExportProfile) => (p.isDefault ? `${p.name} (${tr("editor.export_profile_default")})` : p.name);
  const field = "h-8 w-full min-w-0 rounded-lg border border-neutral-200 bg-surface px-2 text-xs text-neutral-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";
  const seg = (on: boolean) => `flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${on ? "bg-surface text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`;

  return (
    <div className="mb-3 flex flex-col gap-1.5 rounded-lg border border-neutral-200 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`${id}-pick`} className="text-xs font-medium text-neutral-700">{t(tr("editor.export_profile"), tr("editor.print_preset"))}</label>
        <ManageProfilesLinks kind={print ? "print-presets" : "export-profiles"} newTab />
      </div>
      <select id={`${id}-pick`} value={activeId ?? ""} onChange={(e) => pick(e.target.value)} className={field}>
        <option value="">{t(tr("editor.export_profile_none"), tr("editor.print_preset_none"))}</option>
        {ws.length > 0 && <optgroup label={tr("editor.export_profiles_workspace")}>{ws.map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}</optgroup>}
        {mine.length > 0 && <optgroup label={tr("editor.export_profiles_personal")}>{mine.map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}</optgroup>}
      </select>
      {active && saved && (
        <p className="text-[11px] leading-snug text-neutral-500">
          {active.description && <span className="block text-neutral-700">{active.description}</span>}
          {describe(saved)}
        </p>
      )}
      {modified && <p className="text-[11px] font-medium text-amber-700">{tr("editor.export_profile_modified")}</p>}
      {!form && (
        <div className="flex flex-wrap gap-1.5">
          {active && modified && canEdit(active) && (
            <button type="button" disabled={busy} onClick={() => void update()} className="rounded-md bg-brand-600 px-2 py-1 text-[11px] font-medium text-white transition hover:bg-brand-700 disabled:opacity-50">
              {tr("editor.export_profile_update", { name: active.name })}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => setForm({ name: active && modified ? freeName(active.name, taken("personal")) : "", description: "", scope: "personal", isDefault: false })}
            className="rounded-md border border-neutral-200 px-2 py-1 text-[11px] font-medium text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-50"
          >
            {tr("editor.export_profile_save_as")}
          </button>
        </div>
      )}
      {form && (
        <div className="flex flex-col gap-1.5 rounded-md bg-neutral-50 p-2">
          <input
            autoFocus
            value={form.name}
            maxLength={120}
            placeholder={t(tr("editor.export_profile_name_placeholder"), tr("editor.print_preset_name_placeholder"))}
            aria-label={tr("editor.export_profile_name")}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") { e.stopPropagation(); setForm(null); }
            }}
            className={field}
          />
          <input
            value={form.description}
            maxLength={500}
            placeholder={tr("editor.export_profile_description_placeholder")}
            aria-label={tr("editor.export_profile_description")}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className={field}
          />
          {view.canManageWorkspace && workspaceId && (
            <div role="radiogroup" aria-label={tr("editor.export_profile_scope")} className="flex gap-1 rounded-lg bg-neutral-100 p-0.5">
              <button type="button" role="radio" aria-checked={form.scope === "personal"} onClick={() => setForm({ ...form, scope: "personal" })} className={seg(form.scope === "personal")}>{tr("editor.export_profile_scope_personal")}</button>
              <button type="button" role="radio" aria-checked={form.scope === "workspace"} onClick={() => setForm({ ...form, scope: "workspace" })} className={seg(form.scope === "workspace")}>{tr("editor.export_profile_scope_workspace")}</button>
            </div>
          )}
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-neutral-600">
            <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} className="h-3.5 w-3.5 accent-brand-600" />
            {form.scope === "workspace" ? tr("editor.export_profile_default_workspace") : tr("editor.export_profile_default_personal")}
          </label>
          <p className="text-[11px] leading-snug text-neutral-400">{describe(current)}</p>
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => setForm(null)} className="rounded-md px-2 py-1 text-[11px] font-medium text-neutral-500 hover:text-neutral-800">{tr("editor.export_profile_cancel")}</button>
            <button type="button" disabled={busy || !form.name.trim()} onClick={() => void save()} className="rounded-md bg-brand-600 px-2 py-1 text-[11px] font-medium text-white transition hover:bg-brand-700 disabled:opacity-50">
              {tr("editor.export_profile_save")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
