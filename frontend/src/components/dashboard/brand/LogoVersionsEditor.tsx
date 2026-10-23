// The versions a brand's logos come in (colour, black, white, ...), on the
// Brand page's Settings: named, each for a light or a dark ground, ordered,
// added and removed. What one workspace uses need not suit another, so every
// brand sets its own; one that has not shows the logo and its dark version,
// with the suggestion of colour, black and white. A change carries the logos'
// files along (removing a version takes its files out of the brand, after a
// confirmation; they stay in the uploads).

import { ArrowDown, ArrowUp, Layers, Plus, Trash2 } from "lucide-react";
import type { BrandKit, BrandKitPatch, BrandLogoVersion } from "@hc/sdk";
import { Button } from "@/components/ui/Button";
import { confirmAction } from "@/lib/promptDialog";
import { LEGACY_VERSIONS, kitVersions, relinkLogos, suggestedVersions, versionName, versionsDropFiles } from "@/lib/logoVersions";
import { tr } from "@/lib/i18n";
import { SectionTitle } from "./SectionTitle";

export const defaultLogoVersions = () =>
  suggestedVersions({ colour: tr("brand.logo_version_colour"), black: tr("brand.logo_version_black"), white: tr("brand.logo_version_white") });

export function LogoVersionsEditor({ kit, canEdit, save }: {
  kit: BrandKit;
  canEdit: boolean;
  save: (patch: BrandKitPatch, done?: string) => Promise<boolean>;
}) {
  const current = kitVersions(kit);
  const named = !!kit.logoVersions?.length;

  async function apply(next: BrandLogoVersion[]) {
    // The two unnamed versions of a kit from before get their names now.
    const out = next.map((v) => (v.name ? v : { ...v, name: versionName(v) }));
    const dropped = versionsDropFiles(kit.logos, current, out);
    if (dropped > 0) {
      const ok = await confirmAction({ title: tr("brand.logo_versions"), message: tr("brand.logo_versions_drop", { count: dropped }), confirmText: tr("brand.remove"), danger: true });
      if (!ok) return;
    }
    await save({ logoVersions: out, logos: relinkLogos(kit.logos, current, out) });
  }

  const set = (i: number, patch: Partial<BrandLogoVersion>) => void apply(current.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...current];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    void apply(next);
  };
  const field = "h-8 rounded-lg border border-neutral-200 bg-surface px-2 text-sm outline-none focus:border-brand-400 disabled:bg-neutral-50 disabled:text-neutral-500";
  const iconBtn = "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-30";

  return (
    <section>
      <SectionTitle icon={Layers} label={tr("brand.logo_versions")} />
      <p className="mb-3 px-2 text-sm text-neutral-500">{tr("brand.logo_versions_hint")}</p>
      <ul className="flex flex-col gap-1.5 px-2">
        {current.map((v, i) => (
          <li key={v.id} className="flex items-center gap-1.5">
            <input
              key={`${v.id}-${v.name}`}
              defaultValue={versionName(v)}
              disabled={!canEdit}
              aria-label={tr("brand.logo_version_name")}
              onBlur={(e) => { const name = e.target.value.trim(); if (name && name !== versionName(v)) set(i, { name }); }}
              className={`${field} min-w-0 flex-1`}
            />
            <select value={v.ground} disabled={!canEdit} aria-label={tr("brand.logo_version_ground")} onChange={(e) => set(i, { ground: e.target.value as BrandLogoVersion["ground"] })} className={field}>
              <option value="light">{tr("brand.ground_light")}</option>
              <option value="dark">{tr("brand.ground_dark")}</option>
            </select>
            {canEdit && (
              <>
                <button type="button" className={iconBtn} disabled={i === 0} title={tr("brand.move_up")} aria-label={tr("brand.move_up")} onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
                <button type="button" className={iconBtn} disabled={i === current.length - 1} title={tr("brand.move_down")} aria-label={tr("brand.move_down")} onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
                <button type="button" className={iconBtn} disabled={current.length === 1} title={tr("brand.remove_logo_version")} aria-label={`${tr("brand.remove_logo_version")}: ${versionName(v)}`} onClick={() => void apply(current.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
              </>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="mt-2 flex flex-wrap gap-2 px-2">
          <Button variant="secondary" size="sm" className="gap-1" onClick={() => void apply([...current, { id: `v-${crypto.randomUUID()}`, name: tr("brand.new_logo_version"), ground: "light" }])}>
            <Plus size={14} /> {tr("brand.add_logo_version")}
          </Button>
          {!named && current === LEGACY_VERSIONS && (
            <Button variant="secondary" size="sm" onClick={() => void apply(defaultLogoVersions())}>{tr("brand.use_suggested_versions")}</Button>
          )}
        </div>
      )}
    </section>
  );
}
