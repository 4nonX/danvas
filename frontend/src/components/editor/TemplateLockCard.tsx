// Template protection card. Shown when someone runs into a template lock (what
// is protected, by which workspace, whom to ask) and when protection is opened
// for objects from the layers panel or the element menu (the level switch, for
// people who may change it). Also the banner while a rights holder has switched
// protection off to edit the template.

import { useEffect } from "react";
import { Shield, ShieldCheck, ShieldOff, X } from "lucide-react";
import { locate } from "@hc/editor";
import { Button } from "@/components/ui/Button";
import { tr } from "@/lib/i18n";
import { lockOf, type TemplateLockLevel } from "@/lib/templateLock";
import { useEditor } from "@/store/editor";
import { lockWorkspaceName, useTemplateLock } from "@/store/templateLock";
import { layerLabel } from "./LayerPanel";

type Choice = TemplateLockLevel | "none";

export function TemplateLockCard() {
  const notice = useTemplateLock((s) => s.notice);
  const editing = useTemplateLock((s) => s.editingTemplate);
  // Rights and contacts arrive asynchronously; re-render when they do.
  useTemplateLock((s) => s.workspaces);
  useTemplateLock((s) => s.canManage);
  useEditor((s) => s.rev);
  const selection = useEditor((s) => s.selection);
  const tl = useTemplateLock.getState();

  // A card about objects that are no longer selected has done its job.
  const ids = notice?.ids ?? [];
  const stale = !!notice && ids.length > 0 && !ids.some((id) => selection.includes(id)) && !(notice.holderId && selection.includes(notice.holderId));
  useEffect(() => {
    if (stale) useTemplateLock.getState().dismiss();
  }, [stale]);
  useEffect(() => {
    if (!notice) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") useTemplateLock.getState().dismiss(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [notice]);

  const banner = editing && (
    <div role="status" className="pointer-events-auto fixed left-1/2 top-16 z-[90] flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 shadow-md">
      <ShieldOff size={14} className="shrink-0" />
      <span>{tr("editor.template_lock_editing_banner")}</span>
      <button type="button" onClick={() => tl.setEditingTemplate(false)} className="rounded-full bg-amber-200/70 px-2 py-0.5 font-medium hover:bg-amber-200">
        {tr("editor.template_lock_protect_again")}
      </button>
    </div>
  );

  if (!notice || stale) return banner || null;

  const doc = useEditor.getState().doc;
  const lock = notice.lock;
  const workspace = lock ? lockWorkspaceName(lock.workspaceId) : lockWorkspaceName(tl.workspaceId ?? "");
  const holder = notice.holderId ? locate(doc, notice.holderId)?.node : undefined;
  const inherited = !!holder && !!notice.holderId && !ids.includes(notice.holderId);
  const contacts = lock ? (tl.workspaces[lock.workspaceId]?.contacts ?? []) : [];
  const mayLift = !!lock && tl.mayLift(lock.workspaceId);

  // The objects whose own protection the switch sets: the lock's holder when
  // the protection comes from a group around the object.
  const targets = inherited && notice.holderId ? [notice.holderId] : ids;
  const nodes = targets.map((id) => locate(doc, id)?.node).filter((n) => !!n);
  const manageable = nodes.filter((n) => {
    const own = lockOf(n);
    return own ? tl.mayLift(own.workspaceId) : tl.canManage;
  });
  const levels = new Set(nodes.map((n) => lockOf(n)?.level ?? "none"));
  const current: Choice | null = levels.size === 1 ? ([...levels][0] as Choice) : null;
  const choose = (c: Choice) => useEditor.getState().setTemplateLock(manageable.map((n) => n.id), c === "none" ? null : c);

  const status = lock
    ? notice.kind === "content" || (notice.kind === "structure" && lock.level === "locked")
      ? tr("editor.template_lock_blocked_locked", { workspace })
      : notice.kind === "structure"
        ? tr("editor.template_lock_blocked_content", { workspace })
        : lock.level === "content"
          ? tr("editor.template_lock_status_content", { workspace })
          : tr("editor.template_lock_status_locked", { workspace })
    : null;

  const choices: { value: Choice; label: string; hint: string }[] = [
    { value: "none", label: tr("editor.template_lock_level_none"), hint: tr("editor.template_lock_level_none_hint") },
    { value: "content", label: tr("editor.template_lock_level_content"), hint: tr("editor.template_lock_level_content_hint") },
    { value: "locked", label: tr("editor.template_lock_level_locked"), hint: tr("editor.template_lock_level_locked_hint") },
  ];

  return (
    <>
      {banner}
      <div
        role={notice.kind ? "alert" : "dialog"}
        aria-label={tr("editor.template_lock_title")}
        className="pointer-events-auto fixed bottom-20 left-1/2 z-[90] w-[23rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl border border-neutral-200 bg-surface p-3.5 text-sm shadow-lg"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2.5">
          {lock?.level === "locked" ? <ShieldCheck size={18} className="mt-0.5 shrink-0 text-brand-ink" /> : <Shield size={18} className="mt-0.5 shrink-0 text-brand-ink" />}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="font-medium text-neutral-900">{tr("editor.template_lock_title")}</div>
            {status && <p className="leading-snug text-neutral-700">{status}</p>}
            {inherited && holder && <p className="text-xs leading-snug text-neutral-500">{tr("editor.template_lock_inherited", { name: layerLabel(holder) })}</p>}
            {lock && !mayLift && (
              <div className="text-xs leading-snug text-neutral-600">
                {contacts.length > 0 ? (
                  <>
                    <div className="mb-1">{tr("editor.template_lock_contact")}</div>
                    <ul className="space-y-0.5">
                      {contacts.map((c) => (
                        <li key={c.email} className="truncate">
                          {c.name ? `${c.name} ` : ""}
                          <a href={`mailto:${c.email}`} className="text-brand-ink underline-offset-2 hover:underline">{c.name ? `(${c.email})` : c.email}</a>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  tr("editor.template_lock_contact_fallback", { workspace })
                )}
              </div>
            )}
            {lock && mayLift && notice.kind && (
              <div className="space-y-1.5">
                <p className="text-xs leading-snug text-neutral-500">{tr("editor.template_lock_self_hint")}</p>
                <Button size="sm" onClick={() => tl.setEditingTemplate(true)}>
                  {tr("editor.template_lock_edit_template")}
                </Button>
              </div>
            )}
            {!notice.kind && manageable.length > 0 && (
              <div className="space-y-1.5">
                <div role="radiogroup" aria-label={tr("editor.template_lock_level")} className="flex items-center gap-0.5 rounded-lg bg-neutral-100 p-0.5">
                  {choices.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      role="radio"
                      aria-checked={current === c.value}
                      title={c.hint}
                      onClick={() => choose(c.value)}
                      className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition ${current === c.value ? "bg-surface text-brand-ink shadow-sm" : "text-neutral-600 hover:text-neutral-900"}`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs leading-snug text-neutral-500">{current && current !== "none" ? choices.find((c) => c.value === current)?.hint : null} {tr("editor.template_lock_manage_hint", { workspace })}</p>
              </div>
            )}
            {!notice.kind && !lock && manageable.length === 0 && (
              <p className="text-xs leading-snug text-neutral-500">{tr("editor.template_lock_no_right")}</p>
            )}
          </div>
          <button type="button" onClick={() => tl.dismiss()} className="text-neutral-400 hover:text-neutral-700" aria-label={tr("ui.dismiss")}>
            <X size={15} />
          </button>
        </div>
      </div>
    </>
  );
}
