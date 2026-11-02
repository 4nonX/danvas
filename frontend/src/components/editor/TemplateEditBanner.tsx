// Shown while a template is being edited (the dashboard's "Edit template"):
// the design open here is a working copy. Saving replaces the template's design
// with it and moves the copy to the trash; discarding only moves it to the
// trash. Either way the template's id, name, collection and visibility stay,
// and designs already made from it are untouched.

import { useState } from "react";
import { useRouter } from "next/router";
import { oc } from "@/lib/sdk";
import { useEditor } from "@/store/editor";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { confirmAction } from "@/lib/promptDialog";
import { userMessage } from "@/lib/errors";
import { getDesignDoc } from "@/lib/useRealtime";
import { noteServerState } from "@/lib/offlineCopy";
import { tr } from "@/lib/i18n";

export function TemplateEditBanner({ designId, templateId, name }: { designId: string; templateId: string; name: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function leave() {
    // The copy is in the trash now: nothing left to save or warn about.
    useEditor.getState().markClean();
    await router.push("/dashboard");
  }

  async function save() {
    const ok = await confirmAction({ title: tr("editor.template_edit_save_title"), message: tr("editor.template_edit_save_message", { name }), confirmText: tr("editor.template_edit_save") });
    if (!ok) return;
    const file = getDesignDoc()?.snapshot() ?? useEditor.getState().doc;
    if (!Array.isArray(file.pages) || file.pages.length === 0) return;
    setBusy(true);
    try {
      // What is on screen right now, not the last automatic save.
      const saved = await oc.saveSnapshot(designId, { file, kind: "checkpoint" });
      noteServerState(designId, saved?.id, file);
      await oc.saveTemplateEdit(templateId, designId);
    } catch (e) {
      toast.error(userMessage(e, tr("editor.could_not_save_template")));
      setBusy(false);
      return;
    }
    toast.success(tr("editor.template_edit_saved", { name }));
    // The template is saved; a copy left behind stays a normal design.
    await oc.deleteDesign(designId).catch(() => undefined);
    await leave();
  }

  async function discard() {
    const ok = await confirmAction({ title: tr("editor.template_edit_discard_title"), message: tr("editor.template_edit_discard_message", { name }), confirmText: tr("editor.template_edit_discard"), danger: true });
    if (!ok) return;
    setBusy(true);
    await oc.deleteDesign(designId).catch(() => undefined);
    await leave();
  }

  return (
    <div role="status" className="absolute left-1/2 top-2 z-30 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs text-brand-ink shadow-md">
      <span className="min-w-0 truncate font-medium">{tr("editor.template_edit_banner", { name })}</span>
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => void discard()}>{tr("editor.template_edit_discard")}</Button>
      <Button size="sm" disabled={busy} onClick={() => void save()}>{tr("editor.template_edit_save")}</Button>
    </div>
  );
}
