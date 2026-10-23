// The Brand page's graphics (F50): categories the brand's managers name (a kit
// collection with a name); files are uploaded straight into a category, many
// at a time, and can be renamed, moved, replaced and taken out of the kit.
// Maintained with brand.library (or brand.kits); everyone else browses.

import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, FolderInput, ImagePlus, Loader2, Pencil, Plus, RefreshCw, Search, Shapes, Trash2 } from "lucide-react";
import type { BrandKit } from "@hc/sdk";
import { oc, resolveAssetUrl, directUploadWithProgress } from "@/lib/sdk";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { userMessage } from "@/lib/errors";
import { chooseAction, confirmAction, promptText } from "@/lib/promptDialog";
import {
  GRAPHIC_ACCEPT, addCategory, addGraphics, categoryName, deleteCategory, graphicName, isGraphicFile,
  moveCategory, moveGraphic, removeGraphic, renameCategory, renamedFilename, replaceGraphic, type Collections,
} from "@/lib/brandGraphics";
import { tr } from "@/lib/i18n";
import type { BrandAsset, BrandAssets } from "./types";

export function BrandGraphicsTab({ workspaceId, kit, assets, setAssets, canEdit, onSaved }: {
  workspaceId: string;
  kit: BrandKit;
  assets: BrandAssets;
  setAssets: (update: (m: BrandAssets) => BrandAssets) => void;
  canEdit: boolean;
  onSaved: (kit: BrandKit) => void;
}) {
  const toast = useToast();
  const [catId, setCatId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replacing = useRef<{ cat: string; assetId: string } | null>(null);

  const cols = useMemo(() => kit.collections, [kit]);
  const cat = cols.find((c) => c.id === catId) ?? cols[0] ?? null;

  // One kit update per change (versioned, restorable).
  const save = useCallback(async (collections: Collections, done?: string) => {
    try {
      const updated = await oc.updateBrandKit(kit.id, { collections });
      onSaved(updated);
      if (done) toast.success(done);
      return true;
    } catch (e) {
      toast.error(userMessage(e, tr("brand.save_failed")));
      return false;
    }
  }, [kit, onSaved, toast]);

  async function newCategory() {
    const name = await promptText({ title: tr("brand.new_category"), label: tr("brand.category_name"), placeholder: tr("brand.category_example"), confirmText: tr("brand.create") });
    if (!name) return;
    const { collections, id } = addCategory(cols, name);
    if (await save(collections)) setCatId(id);
  }

  async function renameCat(id: string) {
    const c = cols.find((x) => x.id === id);
    if (!c) return;
    const name = await promptText({ title: tr("brand.rename_category"), label: tr("brand.category_name"), defaultValue: categoryName(c), confirmText: tr("brand.save") });
    if (name) await save(renameCategory(cols, id, name));
  }

  async function deleteCat(id: string) {
    const c = cols.find((x) => x.id === id);
    if (!c) return;
    if (c.assetIds.length) {
      const ok = await confirmAction({ title: tr("brand.delete_category"), message: tr("brand.delete_category_message", { name: categoryName(c), count: c.assetIds.length }), confirmText: tr("brand.delete"), danger: true });
      if (!ok) return;
    }
    await save(deleteCategory(cols, id), tr("brand.category_deleted"));
  }

  // Upload many files into the shown category, then one kit update.
  async function upload(files: File[]) {
    if (!cat || !canEdit) return;
    const ok = files.filter(isGraphicFile);
    if (ok.length < files.length) toast.toast(tr("brand.skipped_files", { count: files.length - ok.length }), "info");
    if (!ok.length) return;
    const ids: string[] = [];
    const added: BrandAsset[] = [];
    for (const [i, f] of ok.entries()) {
      setBusy(tr("brand.uploading", { done: i + 1, total: ok.length }));
      try {
        const a = await directUploadWithProgress(workspaceId, f, { filename: f.name });
        ids.push(a.id);
        added.push(a);
      } catch (e) {
        toast.error(`${f.name}: ${userMessage(e, tr("brand.upload_failed"))}`);
      }
    }
    setAssets((m) => { const n = new Map(m); for (const a of added) n.set(a.id, a); return n; });
    if (ids.length) await save(addGraphics(cols, cat.id, ids), tr("brand.uploaded", { count: ids.length }));
    setBusy(null);
  }

  async function replace(file: File) {
    const r = replacing.current;
    replacing.current = null;
    if (!r || !isGraphicFile(file)) return;
    setBusy(tr("brand.uploading", { done: 1, total: 1 }));
    try {
      const a = await directUploadWithProgress(workspaceId, file, { filename: file.name });
      setAssets((m) => new Map(m).set(a.id, a));
      await save(replaceGraphic(cols, r.cat, r.assetId, a.id), tr("brand.replaced"));
    } catch (e) {
      toast.error(userMessage(e, tr("brand.upload_failed")));
    } finally {
      setBusy(null);
    }
  }

  async function renameGraphic(assetId: string) {
    const a = assets.get(assetId);
    const name = await promptText({ title: tr("brand.rename_graphic"), label: tr("brand.graphic_name"), defaultValue: graphicName(a?.filename), confirmText: tr("brand.save") });
    if (!name) return;
    try {
      const updated = await oc.updateAsset(assetId, { filename: renamedFilename(a?.filename, name) });
      setAssets((m) => new Map(m).set(assetId, updated));
    } catch (e) {
      toast.error(userMessage(e, tr("brand.save_failed")));
    }
  }

  async function moveTo(from: string, assetId: string) {
    const others = cols.filter((c) => c.id !== from);
    if (!others.length) { toast.toast(tr("brand.no_other_category"), "info"); return; }
    const to = await chooseAction({ title: tr("brand.move_graphic"), message: tr("brand.move_graphic_message", { name: graphicName(assets.get(assetId)?.filename) }), choices: others.map((c) => ({ value: c.id, label: categoryName(c) })) });
    if (to) await save(moveGraphic(cols, from, to, assetId));
  }

  async function remove(from: string, assetId: string) {
    const ok = await confirmAction({ title: tr("brand.remove_graphic"), message: tr("brand.remove_graphic_message", { name: graphicName(assets.get(assetId)?.filename) }), confirmText: tr("brand.remove"), danger: true });
    if (ok) await save(removeGraphic(cols, from, assetId));
  }

  // What the grid shows: the category, or every match of the search.
  const q = query.trim().toLowerCase();
  const items = q
    ? cols.flatMap((c) => c.assetIds.map((id) => ({ cat: c.id, id }))).filter((x) => graphicName(assets.get(x.id)?.filename).toLowerCase().includes(q))
    : (cat?.assetIds ?? []).map((id) => ({ cat: cat!.id, id }));

  const iconBtn = "grid h-7 w-7 place-items-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800";
  return (
    <div
      className="relative"
      onDragOver={(e) => { if (canEdit && cat && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(e) => { if (!canEdit || !cat) return; e.preventDefault(); setDragging(false); void upload(Array.from(e.dataTransfer.files)); }}
    >
      <p className="mb-4 max-w-2xl px-2 text-sm text-neutral-500">{canEdit ? tr("brand.page_hint") : tr("brand.page_hint_read_only")}</p>

      <div className="flex flex-col gap-4 md:flex-row">
        {/* Categories. */}
        <aside className="md:w-60 md:shrink-0">
          <h3 className="mb-2 flex items-center gap-1.5 px-2 text-xs font-bold uppercase tracking-wide text-neutral-400"><Shapes size={14} /> {tr("brand.categories")}</h3>
          <ul className="flex flex-col gap-0.5">
            {cols.map((c, i) => (
              <li key={c.id} className={`group flex items-center gap-1 rounded-lg ps-2 ${cat?.id === c.id && !q ? "bg-brand-50 text-brand-ink" : "hover:bg-neutral-100"}`}>
                <button type="button" onClick={() => { setCatId(c.id); setQuery(""); }} className="min-w-0 flex-1 truncate py-1.5 text-start text-sm">
                  <span>{categoryName(c)}</span> <span className="text-xs text-neutral-400">{c.assetIds.length}</span>
                </button>
                {canEdit && (
                  <span className="hidden shrink-0 items-center group-hover:flex group-focus-within:flex">
                    <button type="button" className={iconBtn} title={tr("brand.move_up")} aria-label={tr("brand.move_up")} disabled={i === 0} onClick={() => void save(moveCategory(cols, c.id, -1))}><ArrowUp size={13} /></button>
                    <button type="button" className={iconBtn} title={tr("brand.move_down")} aria-label={tr("brand.move_down")} disabled={i === cols.length - 1} onClick={() => void save(moveCategory(cols, c.id, 1))}><ArrowDown size={13} /></button>
                    <button type="button" className={iconBtn} title={tr("brand.rename_category")} aria-label={tr("brand.rename_category")} onClick={() => void renameCat(c.id)}><Pencil size={13} /></button>
                    <button type="button" className={iconBtn} title={tr("brand.delete_category")} aria-label={tr("brand.delete_category")} onClick={() => void deleteCat(c.id)}><Trash2 size={13} /></button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {!cols.length && <p className="px-2 text-xs text-neutral-500">{tr("brand.no_categories")}</p>}
          {canEdit && <Button variant="secondary" size="sm" className="mt-2 gap-1" onClick={() => void newCategory()}><Plus size={14} /> {tr("brand.new_category")}</Button>}
        </aside>

        {/* Graphics. */}
        <section className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="me-auto text-base font-semibold text-neutral-900">{q ? tr("brand.search_results", { count: items.length }) : cat ? categoryName(cat) : ""}</h3>
            <label className="flex h-8 items-center gap-1.5 rounded-lg border border-neutral-200 bg-surface px-2 focus-within:border-brand-400">
              <Search size={14} className="text-neutral-400" />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr("brand.search")} aria-label={tr("brand.search")} className="w-44 bg-transparent text-sm outline-none" />
            </label>
            {canEdit && cat && (
              <Button size="sm" className="gap-1.5" disabled={!!busy} onClick={() => fileRef.current?.click()}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />} {busy ?? tr("brand.upload")}
              </Button>
            )}
            <input ref={fileRef} type="file" multiple accept={GRAPHIC_ACCEPT} className="hidden" onChange={(e) => { void upload(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
            <input ref={replaceRef} type="file" accept={GRAPHIC_ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void replace(f); e.target.value = ""; }} />
          </div>

          {cat && !items.length && !q && (
            <p className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">{canEdit ? tr("brand.empty_category_edit") : tr("brand.empty_category")}</p>
          )}
          {!cols.length && canEdit && <p className="text-sm text-neutral-500">{tr("brand.start_with_category")}</p>}

          <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {items.map(({ cat: c, id }) => {
              const a = assets.get(id);
              const name = graphicName(a?.filename) || tr("brand.unnamed");
              return (
                <li key={`${c}:${id}`} className="group flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-surface">
                  <div className="grid aspect-square place-items-center bg-neutral-100 p-3">
                    {a?.url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={resolveAssetUrl(a.thumbnail || a.url)} alt={name} className="max-h-full max-w-full object-contain" />
                      : <span className="text-xs text-neutral-400">{tr("brand.file_missing")}</span>}
                  </div>
                  <div className="flex items-center gap-1 border-t border-neutral-200 px-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-800" title={name}>{name}</span>
                    {canEdit && (
                      <span className="flex shrink-0 opacity-70 group-hover:opacity-100">
                        <button type="button" className={iconBtn} title={tr("brand.rename_graphic")} aria-label={tr("brand.rename_graphic")} onClick={() => void renameGraphic(id)}><Pencil size={13} /></button>
                        <button type="button" className={iconBtn} title={tr("brand.move_graphic")} aria-label={tr("brand.move_graphic")} onClick={() => void moveTo(c, id)}><FolderInput size={13} /></button>
                        <button type="button" className={iconBtn} title={tr("brand.replace_graphic")} aria-label={tr("brand.replace_graphic")} onClick={() => { replacing.current = { cat: c, assetId: id }; replaceRef.current?.click(); }}><RefreshCw size={13} /></button>
                        <button type="button" className={iconBtn} title={tr("brand.remove_graphic")} aria-label={tr("brand.remove_graphic")} onClick={() => void remove(c, id)}><Trash2 size={13} /></button>
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-xl border-2 border-dashed border-brand-400 bg-brand-50/80 text-sm font-medium text-brand-ink">
          {tr("brand.drop_here", { name: cat ? categoryName(cat) : "" })}
        </div>
      )}
    </div>
  );
}
