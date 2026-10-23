// Save-as-template dialog. Captures a title, category, and
// visibility, then saves the current design as a reusable template via the SDK.
// Uses the design's id when available (server loads its latest snapshot) and
// otherwise sends the in-memory file so unsaved work can still be templatized.
// From the dashboard it takes the chosen designs instead: one keeps the name
// field, several each become a template under their own name.

import { useState } from "react";
import type { TemplateVisibility } from "@hc/sdk";
import { oc } from "@/lib/sdk";
import { useEditor } from "@/store/editor";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { tr } from "@/lib/i18n";

const visibilities = (): { value: TemplateVisibility; label: string; hint: string }[] => [
  { value: "private", label: tr("editor.only_me"), hint: tr("editor.visible_only_to_you") },
  { value: "workspace", label: tr("editor.my_team"), hint: tr("editor.visible_to_workspace_members") },
  { value: "public", label: tr("editor.everyone"), hint: tr("editor.public_template_free_to_all") },
];

export function SaveAsTemplateDialog({
  open,
  onClose,
  designId,
  workspaceId,
  designs,
}: {
  open: boolean;
  onClose: () => void;
  designId: string | null;
  workspaceId: string | null;
  /** Saved designs chosen on the dashboard (instead of the open one). */
  designs?: { id: string; title: string }[];
}) {
  const toast = useToast();
  const docTitle = useEditor((s) => s.doc.title);
  const many = (designs?.length ?? 0) > 1;
  const [title, setTitle] = useState(designs?.[0]?.title ?? docTitle);
  const [category, setCategory] = useState("");
  const [visibility, setVisibility] = useState<TemplateVisibility>("workspace");
  const [busy, setBusy] = useState(false);

  async function saveMany(list: { id: string; title: string }[]) {
    if (!workspaceId) return;
    setBusy(true);
    let saved = 0;
    for (const d of list) {
      try {
        await oc.saveAsTemplate({ workspaceId, designId: d.id, title: d.title, category: category.trim() || undefined, visibility });
        saved++;
      } catch { /* counted below */ }
    }
    setBusy(false);
    if (saved) toast.success(tr("editor.saved_as_templates", { count: saved }));
    if (saved < list.length) toast.error(tr("editor.templates_not_saved", { count: list.length - saved }));
    if (saved === list.length) onClose();
  }

  async function save() {
    if (many && designs) return saveMany(designs);
    if (!workspaceId || !title.trim()) return;
    const target = designs?.[0]?.id ?? designId;
    setBusy(true);
    try {
      await oc.saveAsTemplate({
        workspaceId,
        // Prefer the saved design (latest snapshot); fall back to the live file.
        designId: target ?? undefined,
        file: target ? undefined : useEditor.getState().doc,
        title: title.trim(),
        category: category.trim() || undefined,
        visibility,
      });
      toast.success(tr("editor.saved_as_template"));
      onClose();
    } catch {
      toast.error(tr("editor.could_not_save_template"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={tr("editor.save_as_template")}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="flex flex-col gap-4"
      >
        {many ? (
          <p className="text-sm text-neutral-600">{tr("editor.save_as_templates_many", { count: designs!.length })}</p>
        ) : (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">{tr("editor.name")}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={tr("editor.template_name")}
            className="h-11 rounded-xl border border-neutral-200 bg-surface px-3.5 text-sm text-neutral-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </label>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">{tr("editor.category_optional")}</span>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder={tr("editor.e_g_social_poster_resume")}
            className="h-11 rounded-xl border border-neutral-200 bg-surface px-3.5 text-sm text-neutral-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </label>
        <fieldset className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">{tr("editor.who_can_use_it")}</span>
          <div className="flex flex-col gap-1.5">
            {visibilities().map((v) => (
              <label
                key={v.value}
                className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-sm ${
                  visibility === v.value ? "border-brand-500 bg-brand-50" : "border-neutral-200"
                }`}
              >
                <input
                  type="radio"
                  name="visibility"
                  checked={visibility === v.value}
                  onChange={() => setVisibility(v.value)}
                  className="accent-brand-600"
                />
                <span className="font-medium text-neutral-800">{v.label}</span>
                <span className="ms-auto text-xs text-neutral-400">{v.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            {tr("editor.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={busy || (!many && !title.trim()) || !workspaceId}>
            {busy ? tr("editor.saving") : tr("editor.save_template")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
