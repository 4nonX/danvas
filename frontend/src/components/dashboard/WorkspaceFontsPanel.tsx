// The workspace font library: custom and licensed typefaces an admin uploads
// once, usable in every design of the workspace (all font pickers, the brand
// kit) and embedded by the vector exports. Every member sees the list; only
// admins change it (the server enforces the same split).
//
// Uploads are labelled from the font files themselves (family, weight,
// italic), shown for review before anything is stored.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash2, Type, Upload } from "lucide-react";
import type { WorkspaceFont } from "@hc/sdk";
import { ApiError } from "@hc/sdk";
import { oc } from "@/lib/sdk";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { userMessage } from "@/lib/errors";
import { readFontMeta } from "@/lib/fontMeta";
import { loadWorkspaceFonts } from "@/lib/workspaceFonts";
import { fonts } from "@/lib/fontProvider";
import { tr } from "@/lib/i18n";

type Pending = { file: File; family: string; weight: number; style: "normal" | "italic" };

const FONT_FILE = /\.(woff2|woff|ttf|otf)$/i;

export function WorkspaceFontsPanel({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const toast = useToast();
  const [list, setList] = useState<WorkspaceFont[] | null>(null);
  const [pending, setPending] = useState<Pending[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setList(await oc.listWorkspaceFonts(workspaceId));
    } catch {
      setList([]);
    }
    void loadWorkspaceFonts(workspaceId, true);
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    void oc.listWorkspaceFonts(workspaceId).then(
      (l) => { if (!cancelled) setList(l); },
      () => { if (!cancelled) setList([]); },
    );
    void loadWorkspaceFonts(workspaceId);
    return () => { cancelled = true; };
  }, [workspaceId]);

  // Previews render in the fonts themselves.
  const [, force] = useState(0);
  useEffect(() => fonts.onChange(() => force((n) => n + 1)), []);
  const families = useMemo(() => groupByFamily(list ?? []), [list]);
  useEffect(() => { for (const f of families.keys()) fonts.ensure(f); }, [families]);

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    // macOS resource forks ("._Name.ttf") and other non-font files are skipped.
    const chosen = [...files].filter((f) => FONT_FILE.test(f.name) && !f.name.startsWith("._"));
    const out: Pending[] = [];
    for (const file of chosen) {
      const meta = await readFontMeta(new Uint8Array(await file.arrayBuffer()), file.name);
      if (meta) out.push({ file, ...meta });
    }
    if (fileRef.current) fileRef.current.value = "";
    if (!out.length) {
      toast.error(tr("dashboard.no_readable_fonts"));
      return;
    }
    out.sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight || a.style.localeCompare(b.style));
    setPending(out);
  }

  async function uploadAll() {
    if (!pending) return;
    let added = 0, skipped = 0, failed = 0;
    for (let i = 0; i < pending.length; i++) {
      const p = pending[i];
      setBusy(tr("dashboard.uploading_n_of_m", { n: i + 1, m: pending.length }));
      try {
        await oc.uploadWorkspaceFont(workspaceId, p.file, { family: p.family.trim(), weight: p.weight, style: p.style, fileName: p.file.name });
        added++;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) skipped++;
        else { failed++; if (failed === 1) toast.error(userMessage(e, tr("dashboard.could_not_upload_font"))); }
      }
    }
    setBusy(null);
    setPending(null);
    toast.success(tr("dashboard.fonts_uploaded_summary", { added, skipped }));
    await reload();
  }

  async function renameFamily() {
    if (!renaming) return;
    const to = renaming.to.trim();
    const from = renaming.from;
    setRenaming(null);
    if (!to || to === from) return;
    try {
      for (const f of families.get(from) ?? []) await oc.updateWorkspaceFont(f.id, { family: to, weight: f.weight, style: f.style });
    } catch (e) {
      toast.error(userMessage(e, tr("dashboard.could_not_update_font")));
    }
    await reload();
  }

  async function remove(key: string, ids: string[]) {
    if (armed !== key) {
      setArmed(key);
      setTimeout(() => setArmed((cur) => (cur === key ? null : cur)), 3500);
      return;
    }
    setArmed(null);
    try {
      for (const id of ids) await oc.deleteWorkspaceFont(id);
    } catch (e) {
      toast.error(userMessage(e, tr("dashboard.could_not_update_font")));
    }
    await reload();
  }

  const styleLabel = (w: number, s: string) => `${w}${s === "italic" ? ` ${tr("dashboard.italic")}` : ""}`;

  return (
    <section className="mt-8">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-neutral-400">
        <Type size={15} /> {tr("dashboard.workspace_fonts")}
      </h2>
      <p className="mb-3 max-w-xl text-xs text-neutral-500">{tr("dashboard.workspace_fonts_hint")}</p>

      {canEdit && !pending && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50/60 p-3">
          <p className="min-w-0 flex-1 text-xs text-neutral-500">{tr("dashboard.workspace_fonts_upload_hint")}</p>
          <input ref={fileRef} type="file" multiple accept=".woff2,.woff,.ttf,.otf,font/*" className="hidden" onChange={(e) => void pick(e.target.files)} />
          <Button size="sm" className="gap-1" onClick={() => fileRef.current?.click()}>
            <Upload size={15} /> {tr("dashboard.upload_fonts")}
          </Button>
        </div>
      )}

      {/* Review: what the files say about themselves, editable before upload. */}
      {pending && (
        <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-3">
          <p className="mb-2 text-xs text-neutral-600">{tr("dashboard.review_fonts_before_upload")}</p>
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-start text-[10px] uppercase tracking-wide text-neutral-400">
                  <th className="pb-1 text-start font-semibold">{tr("dashboard.file")}</th>
                  <th className="pb-1 text-start font-semibold">{tr("dashboard.font_family")}</th>
                  <th className="pb-1 text-start font-semibold">{tr("dashboard.font_weight")}</th>
                  <th className="pb-1 text-start font-semibold">{tr("dashboard.italic")}</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((p, i) => (
                  <tr key={i} className="border-t border-neutral-200/70">
                    <td className="max-w-[10rem] truncate py-1 pe-2 font-mono text-[11px] text-neutral-500" title={p.file.name}>{p.file.name}</td>
                    <td className="py-1 pe-2">
                      <input value={p.family} aria-label={tr("dashboard.font_family")} onChange={(e) => setPending(pending.map((q, j) => (j === i ? { ...q, family: e.target.value } : q)))} className="h-7 w-full rounded-md border border-neutral-300 bg-surface px-1.5 outline-none focus:border-brand-400" />
                    </td>
                    <td className="py-1 pe-2">
                      <input type="number" min={1} max={1000} step={50} value={p.weight} aria-label={tr("dashboard.font_weight")} onChange={(e) => setPending(pending.map((q, j) => (j === i ? { ...q, weight: Number(e.target.value) || 400 } : q)))} className="h-7 w-16 rounded-md border border-neutral-300 bg-surface px-1.5 outline-none focus:border-brand-400" />
                    </td>
                    <td className="py-1">
                      <input type="checkbox" aria-label={tr("dashboard.italic")} checked={p.style === "italic"} onChange={(e) => setPending(pending.map((q, j) => (j === i ? { ...q, style: e.target.checked ? "italic" : "normal" } : q)))} className="h-4 w-4 accent-brand-600" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex items-center justify-end gap-2">
            {busy && <span className="me-auto text-xs text-neutral-500">{busy}</span>}
            <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => setPending(null)}>{tr("dashboard.cancel")}</Button>
            <Button size="sm" disabled={!!busy || pending.some((p) => !p.family.trim())} onClick={() => void uploadAll()}>
              {tr("dashboard.upload_n_fonts", { count: pending.length })}
            </Button>
          </div>
        </div>
      )}

      {list !== null && list.length === 0 && !pending && (
        <p className="mt-3 text-xs text-neutral-400">{tr("dashboard.no_workspace_fonts_yet")}</p>
      )}
      <ul className="mt-3 flex flex-col gap-1.5">
        {[...families].map(([family, faces]) => (
          <li key={family} className="rounded-xl border border-neutral-200 bg-surface px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              {renaming?.from === family ? (
                <input
                  autoFocus
                  value={renaming.to}
                  maxLength={120}
                  aria-label={tr("dashboard.font_family")}
                  onChange={(e) => setRenaming({ from: family, to: e.target.value })}
                  onBlur={() => void renameFamily()}
                  onKeyDown={(e) => { if (e.key === "Enter") void renameFamily(); if (e.key === "Escape") setRenaming(null); }}
                  className="h-7 min-w-0 flex-1 rounded-md border border-neutral-300 px-2 text-sm outline-none focus:border-brand-400"
                />
              ) : (
                <button
                  type="button"
                  disabled={!canEdit}
                  title={canEdit ? tr("dashboard.rename") : undefined}
                  onClick={() => setRenaming({ from: family, to: family })}
                  className="min-w-0 truncate text-start text-base text-neutral-800 enabled:hover:underline"
                  style={{ fontFamily: `'${family}', sans-serif` }}
                >
                  {family}
                </button>
              )}
              <span className="text-[11px] text-neutral-400">{tr("dashboard.n_styles", { count: faces.length })}</span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => void remove(`fam:${family}`, faces.map((f) => f.id))}
                  className={`ms-auto flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition ${armed === `fam:${family}` ? "bg-red-50 text-red-600 ring-1 ring-red-300" : "text-neutral-400 hover:bg-neutral-100 hover:text-red-600"}`}
                >
                  <Trash2 size={13} /> {armed === `fam:${family}` ? tr("dashboard.click_again_to_remove") : tr("dashboard.remove")}
                </button>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {faces.map((f) => (
                <span key={f.id} className="flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600" title={f.fileName}>
                  <span style={{ fontFamily: `'${family}', sans-serif`, fontWeight: f.weight, fontStyle: f.style }}>Aa</span>
                  {styleLabel(f.weight, f.style)}
                  {canEdit && (
                    <button
                      type="button"
                      aria-label={tr("dashboard.remove")}
                      onClick={() => void remove(f.id, [f.id])}
                      className={`ms-0.5 rounded px-0.5 ${armed === f.id ? "bg-red-100 text-red-600" : "text-neutral-400 hover:text-red-600"}`}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function groupByFamily(list: WorkspaceFont[]): Map<string, WorkspaceFont[]> {
  const m = new Map<string, WorkspaceFont[]>();
  for (const f of list) m.set(f.family, [...(m.get(f.family) ?? []), f]);
  return m;
}
