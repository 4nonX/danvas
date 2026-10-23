// The Brand page's logos: each logo on a light ground and, when it has one,
// its version for dark grounds (generated decks draw it on deep pages, the
// brand check accepts it as the logo). With brand.kits logos are added from
// the uploads or a new file, given another file, renamed, given a dark
// version and removed. Picking a file opens a dialog, in view wherever the
// logo sits in the grid.

import { useState } from "react";
import { ImageIcon, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import type { BrandKit, BrandKitPatch } from "@hc/sdk";
import { resolveAssetUrl } from "@/lib/sdk";
import { UploadPicker } from "@/components/brand/kitEditors";
import { Modal } from "@/components/ui/Modal";
import { confirmAction, promptText } from "@/lib/promptDialog";
import { tr } from "@/lib/i18n";
import { SectionTitle } from "./SectionTitle";
import type { BrandAssets } from "./types";

/** What a picked file becomes: a new logo, a logo's file, or its dark version. */
type Pick = { mode: "new" } | { mode: "file" | "dark"; id: string };

export function BrandLogosTab({ workspaceId, kit, assets, onUploaded, canEdit, save }: {
  workspaceId: string;
  kit: BrandKit;
  assets: BrandAssets;
  /** A file uploaded while picking, so its preview shows at once. */
  onUploaded: (assetId: string, filename: string, url: string) => void;
  canEdit: boolean;
  save: (patch: BrandKitPatch, done?: string) => Promise<boolean>;
}) {
  const [picking, setPicking] = useState<Pick | null>(null);
  const urls = Object.fromEntries([...assets.values()].map((a) => [a.id, a.url]));
  const url = (id: string | undefined) => (id && assets.get(id)?.url ? resolveAssetUrl(assets.get(id)!.url) : null);
  const logos = kit.logos;
  const pickingLogo = picking && picking.mode !== "new" ? logos.find((l) => l.id === picking.id) : undefined;

  async function rename(id: string) {
    const l = logos.find((x) => x.id === id);
    if (!l) return;
    const label = await promptText({ title: tr("brand.rename_logo"), label: tr("brand.logo_name"), defaultValue: l.label, confirmText: tr("brand.save") });
    if (label && label !== l.label) await save({ logos: logos.map((x) => (x.id === id ? { ...x, label } : x)) });
  }

  async function remove(id: string) {
    const l = logos.find((x) => x.id === id);
    if (!l) return;
    const ok = await confirmAction({ title: tr("editor.remove_logo"), message: tr("brand.remove_logo_message", { name: l.label }), confirmText: tr("brand.remove"), danger: true });
    if (ok) await save({ logos: logos.filter((x) => x.id !== id) }, tr("editor.logo_removed"));
  }

  const removeDark = (id: string) =>
    void save({ logos: logos.map((x) => (x.id === id ? { ...x, variants: { ...(x.variants ?? {}), dark: undefined } } : x)) });

  function picked(assetId: string, filename: string, fileUrl?: string) {
    const target = picking;
    setPicking(null);
    if (fileUrl) onUploaded(assetId, filename, fileUrl);
    if (!target) return;
    if (target.mode === "new") {
      const label = filename.replace(/\.[a-z0-9]+$/i, "") || tr("editor.logo");
      void save({ logos: [...logos, { id: `l-${crypto.randomUUID()}`, label, assetId }] }, tr("editor.logo_added"));
    } else if (target.mode === "file") {
      void save({ logos: logos.map((x) => (x.id === target.id ? { ...x, assetId } : x)) }, tr("brand.logo_replaced"));
    } else {
      void save({ logos: logos.map((x) => (x.id === target.id ? { ...x, variants: { ...(x.variants ?? {}), dark: assetId } } : x)) });
    }
  }


  const iconBtn = "grid h-7 w-7 place-items-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800";
  return (
    <div className="max-w-4xl">
      <SectionTitle icon={ImageIcon} label={tr("editor.logos")} count={logos.length} />
      <p className="mb-4 max-w-2xl px-2 text-sm text-neutral-500">{canEdit ? tr("brand.logos_hint") : tr("brand.logos_hint_read_only")}</p>
      {logos.length === 0 && !canEdit && <p className="px-2 text-sm text-neutral-500">{tr("brand.no_logos")}</p>}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 px-2">
        {logos.map((l) => {
          const light = url(l.assetId);
          const dark = url(l.variants?.dark);
          return (
            // Pinned light: the tiles show the logo on light and on dark
            // grounds, whatever the app theme is.
            <li key={l.id} className="light group flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white">
              <div className="grid grid-cols-2">
                <div className="grid aspect-[4/3] place-items-center bg-neutral-50 p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {light ? <img src={light} alt={l.label} className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-neutral-400">{tr("brand.file_missing")}</span>}
                </div>
                <div className="relative grid aspect-[4/3] place-items-center bg-neutral-900 p-3">
                  {dark ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={dark} alt={`${l.label} ${tr("editor.logo_on_dark")}`} className="max-h-full max-w-full object-contain" />
                  ) : canEdit ? (
                    <button type="button" onClick={() => setPicking({ mode: "dark", id: l.id })} title={tr("editor.set_dark_logo")} aria-label={tr("editor.set_dark_logo")} className="flex h-full w-full items-center justify-center gap-1 text-neutral-400 hover:text-white">
                      <Plus size={14} />
                    </button>
                  ) : (
                    <span className="px-2 text-center text-[10px] text-neutral-500">{tr("brand.no_dark_logo")}</span>
                  )}
                  {dark && canEdit && (
                    <span className="absolute end-1 top-1 hidden gap-0.5 group-hover:flex group-focus-within:flex">
                      <button type="button" onClick={() => setPicking({ mode: "dark", id: l.id })} title={tr("editor.change_dark_logo")} aria-label={tr("editor.change_dark_logo")} className="grid h-6 w-6 place-items-center rounded-md bg-white/15 text-white hover:bg-white/30"><Pencil size={12} /></button>
                      <button type="button" onClick={() => removeDark(l.id)} title={tr("brand.remove_dark_logo")} aria-label={tr("brand.remove_dark_logo")} className="grid h-6 w-6 place-items-center rounded-md bg-white/15 text-white hover:bg-white/30"><X size={12} /></button>
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 border-t border-neutral-200 px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-800" title={l.label}>{l.label}</span>
                {canEdit && (
                  <span className="flex shrink-0 opacity-70 group-hover:opacity-100">
                    <button type="button" className={iconBtn} title={tr("brand.replace_logo")} aria-label={tr("brand.replace_logo")} onClick={() => setPicking({ mode: "file", id: l.id })}><RefreshCw size={13} /></button>
                    <button type="button" className={iconBtn} title={tr("brand.rename_logo")} aria-label={tr("brand.rename_logo")} onClick={() => void rename(l.id)}><Pencil size={13} /></button>
                    <button type="button" className={iconBtn} title={tr("editor.remove_logo")} aria-label={tr("editor.remove_logo")} onClick={() => void remove(l.id)}><Trash2 size={13} /></button>
                  </span>
                )}
              </div>
            </li>
          );
        })}
        {canEdit && (
          <li>
            <button
              type="button"
              onClick={() => setPicking({ mode: "new" })}
              className="flex h-full min-h-32 w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-neutral-300 text-sm text-neutral-500 hover:border-brand-300 hover:text-brand-ink"
            >
              <Plus size={18} /> {tr("editor.add_logo")}
            </button>
          </li>
        )}
      </ul>

      {/* Adding a logo, its file or its dark version: the uploads or a new file. */}
      <Modal
        open={canEdit && !!picking && (picking.mode === "new" || !!pickingLogo)}
        onClose={() => setPicking(null)}
        width="w-[34rem]"
        title={!picking || picking.mode === "new" ? tr("editor.add_logo")
          : `${picking.mode === "file" ? tr("brand.replace_logo") : pickingLogo?.variants?.dark ? tr("editor.change_dark_logo") : tr("editor.set_dark_logo")}: ${pickingLogo?.label ?? ""}`}
      >
        <UploadPicker workspaceId={workspaceId} assetUrls={urls} allowUpload onPick={picked} />
      </Modal>
    </div>
  );
}
