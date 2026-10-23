// The Brand page's logos: one row per logo with its versions side by side
// (colour, black, white, ... as the kit names them under Settings), each on
// the ground it is made for. A kit that has not named versions shows the logo
// and its version for dark grounds. With brand.kits a logo is added, a
// version given a file or another one, cleared, the logo renamed, a single
// logo moved into another one as one of its versions, or removed. Picking a
// file opens a dialog, in view wherever the logo sits.

import { useState } from "react";
import { FolderInput, ImageIcon, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import type { BrandKit, BrandKitPatch, BrandLogo, BrandLogoVersion } from "@hc/sdk";
import { resolveAssetUrl } from "@/lib/sdk";
import { UploadPicker } from "@/components/brand/kitEditors";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { chooseAction, confirmAction, promptText } from "@/lib/promptDialog";
import { kitVersions, logoFiles, newLogo, versionName, withVersionFile } from "@/lib/logoVersions";
import { tr } from "@/lib/i18n";
import { SectionTitle } from "./SectionTitle";
import type { BrandAssets } from "./types";

/** What a picked file becomes: a new logo, or a logo's file in a version. */
type Pick = { mode: "new"; versionId: string } | { mode: "version"; id: string; versionId: string };

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
  const versions = kitVersions(kit);
  const pickingLogo = picking?.mode === "version" ? logos.find((l) => l.id === picking.id) : undefined;
  const pickingVersion = picking ? versions.find((v) => v.id === picking.versionId) : undefined;

  const replace = (id: string, next: BrandLogo | null, done?: string) =>
    save({ logos: next ? logos.map((x) => (x.id === id ? next : x)) : logos.filter((x) => x.id !== id) }, done);

  async function rename(l: BrandLogo) {
    const label = await promptText({ title: tr("brand.rename_logo"), label: tr("brand.logo_name"), defaultValue: l.label, confirmText: tr("brand.save") });
    if (label && label !== l.label) await replace(l.id, { ...l, label });
  }

  async function remove(l: BrandLogo) {
    const ok = await confirmAction({ title: tr("editor.remove_logo"), message: tr("brand.remove_logo_message", { name: l.label }), confirmText: tr("brand.remove"), danger: true });
    if (ok) await replace(l.id, null, tr("editor.logo_removed"));
  }

  async function clearVersion(l: BrandLogo, v: BrandLogoVersion) {
    const next = withVersionFile(l, versions, v.id, null);
    if (!next) return remove(l); // its last file: removing it removes the logo
    await replace(l.id, next);
  }

  // A logo with one file joins another logo as one of its versions, so
  // logos kept as separate entries (colour, black, white) become one.
  async function moveInto(l: BrandLogo) {
    const own = logoFiles(l, versions).filter((f) => f.assetId);
    if (own.length !== 1) return;
    const others = logos.filter((x) => x.id !== l.id);
    if (!others.length) return;
    const to = await chooseAction({ title: tr("brand.move_logo"), message: tr("brand.move_logo_message", { name: l.label }), choices: others.map((x) => ({ value: x.id, label: x.label })) });
    const target = others.find((x) => x.id === to);
    if (!target) return;
    const taken = new Set(logoFiles(target, versions).filter((f) => f.assetId).map((f) => f.version.id));
    const versionId = await chooseAction({
      title: tr("brand.move_logo"),
      message: tr("brand.move_logo_version", { name: target.label }),
      choices: versions.map((v) => ({ value: v.id, label: taken.has(v.id) ? `${versionName(v)} (${tr("brand.replaces_file")})` : versionName(v) })),
    });
    if (!versionId) return;
    const joined = withVersionFile(target, versions, versionId, own[0].assetId!)!;
    await save({ logos: logos.filter((x) => x.id !== l.id).map((x) => (x.id === target.id ? joined : x)) }, tr("brand.logo_moved", { name: target.label }));
  }

  function picked(assetId: string, filename: string, fileUrl?: string) {
    const target = picking;
    setPicking(null);
    if (fileUrl) onUploaded(assetId, filename, fileUrl);
    if (!target) return;
    if (target.mode === "new") {
      const label = filename.replace(/\.[a-z0-9]+$/i, "") || tr("editor.logo");
      void save({ logos: [...logos, newLogo(label, versions, target.versionId, assetId)] }, tr("editor.logo_added"));
    } else if (pickingLogo) {
      void replace(pickingLogo.id, withVersionFile(pickingLogo, versions, target.versionId, assetId), tr("brand.logo_replaced"));
    }
  }

  const iconBtn = "grid h-7 w-7 place-items-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800";
  const onTile = "grid h-6 w-6 place-items-center rounded-md shadow-sm";
  return (
    <div className="max-w-5xl">
      <SectionTitle icon={ImageIcon} label={tr("editor.logos")} count={logos.length} />
      <p className="mb-4 max-w-2xl px-2 text-sm text-neutral-500">{canEdit ? tr("brand.logos_hint") : tr("brand.logos_hint_read_only")}</p>
      {logos.length === 0 && !canEdit && <p className="px-2 text-sm text-neutral-500">{tr("brand.no_logos")}</p>}
      <ul className="flex flex-col gap-3 px-2">
        {logos.map((l) => {
          const files = logoFiles(l, versions);
          const single = files.filter((f) => f.assetId).length === 1 && logos.length > 1;
          return (
            <li key={l.id} className="group overflow-hidden rounded-xl border border-neutral-200 bg-surface">
              <div className="flex items-center gap-1 border-b border-neutral-200 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-800" title={l.label}>{l.label}</span>
                {canEdit && (
                  <span className="flex shrink-0 opacity-70 group-hover:opacity-100">
                    <button type="button" className={iconBtn} title={tr("brand.rename_logo")} aria-label={tr("brand.rename_logo")} onClick={() => void rename(l)}><Pencil size={13} /></button>
                    {single && <button type="button" className={iconBtn} title={tr("brand.move_logo")} aria-label={tr("brand.move_logo")} onClick={() => void moveInto(l)}><FolderInput size={13} /></button>}
                    <button type="button" className={iconBtn} title={tr("editor.remove_logo")} aria-label={tr("editor.remove_logo")} onClick={() => void remove(l)}><Trash2 size={13} /></button>
                  </span>
                )}
              </div>
              {/* Pinned light: each version on its own ground, whatever the app theme. */}
              <div className="light grid" style={{ gridTemplateColumns: `repeat(${files.length}, minmax(0, 1fr))` }}>
                {files.map(({ version: v, assetId }) => {
                  const dark = v.ground === "dark";
                  const src = url(assetId);
                  const name = versionName(v);
                  return (
                    <div key={v.id} className={`group/tile relative flex flex-col ${dark ? "bg-neutral-900" : "bg-neutral-50"}`}>
                      <div className="grid aspect-[3/2] place-items-center p-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {src ? <img src={src} alt={`${l.label}: ${name}`} className="max-h-full max-w-full object-contain" />
                          : assetId ? <span className="text-xs text-neutral-400">{tr("brand.file_missing")}</span>
                          : canEdit ? (
                            <button type="button" onClick={() => setPicking({ mode: "version", id: l.id, versionId: v.id })} title={`${tr("brand.set_version_file")}: ${name}`} aria-label={`${tr("brand.set_version_file")}: ${l.label}, ${name}`} className={`grid h-full w-full place-items-center rounded-lg border border-dashed ${dark ? "border-neutral-600 text-neutral-500 hover:text-white" : "border-neutral-300 text-neutral-400 hover:text-brand-ink"}`}>
                              <Plus size={16} />
                            </button>
                          ) : <span className={`text-[11px] ${dark ? "text-neutral-500" : "text-neutral-400"}`}>{tr("brand.no_version_file")}</span>}
                      </div>
                      <span className={`px-2 pb-1.5 text-center text-[11px] ${dark ? "text-neutral-400" : "text-neutral-500"}`}>{name}</span>
                      {assetId && canEdit && (
                        <span className="absolute end-1 top-1 hidden gap-0.5 group-hover/tile:flex group-focus-within/tile:flex">
                          <button type="button" onClick={() => setPicking({ mode: "version", id: l.id, versionId: v.id })} title={tr("brand.replace_logo")} aria-label={`${tr("brand.replace_logo")}: ${l.label}, ${name}`} className={`${onTile} ${dark ? "bg-white/15 text-white hover:bg-white/30" : "bg-white text-neutral-600 hover:text-neutral-900"}`}><RefreshCw size={12} /></button>
                          <button type="button" onClick={() => void clearVersion(l, v)} title={tr("brand.clear_version")} aria-label={`${tr("brand.clear_version")}: ${l.label}, ${name}`} className={`${onTile} ${dark ? "bg-white/15 text-white hover:bg-white/30" : "bg-white text-neutral-600 hover:text-red-600"}`}><X size={12} /></button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
      {canEdit && (
        <div className="mt-3 px-2">
          <Button variant="secondary" size="sm" className="gap-1" onClick={() => setPicking({ mode: "new", versionId: versions[0].id })}><Plus size={14} /> {tr("editor.add_logo")}</Button>
        </div>
      )}

      {/* Adding a logo or giving a version a file: the uploads or a new file. */}
      <Modal
        open={canEdit && !!picking && (picking.mode === "new" || !!pickingLogo)}
        onClose={() => setPicking(null)}
        width="w-[34rem]"
        title={picking?.mode === "new" ? tr("editor.add_logo") : `${pickingLogo?.label ?? ""}: ${pickingVersion ? versionName(pickingVersion) : ""}`}
      >
        {picking?.mode === "new" && versions.length > 1 && (
          <label className="mb-2 flex items-center gap-2 text-sm text-neutral-600">
            {tr("brand.logo_version")}
            <select value={picking.versionId} onChange={(e) => setPicking({ mode: "new", versionId: e.target.value })} className="h-8 rounded-lg border border-neutral-200 bg-surface px-2 text-sm outline-none focus:border-brand-400">
              {versions.map((v) => <option key={v.id} value={v.id}>{versionName(v)}</option>)}
            </select>
          </label>
        )}
        <UploadPicker workspaceId={workspaceId} assetUrls={urls} allowUpload onPick={picked} />
      </Modal>
    </div>
  );
}
