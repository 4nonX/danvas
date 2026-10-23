// The Brand page's settings: the brand's name and whether it is the
// workspace's standard brand, its rules (locks, the check before export), its
// voice for generated copy, the versions its logos come in, the kit file, the
// version history, and deleting
// it. Everyone sees them; brand.kits changes them.

import { useState } from "react";
import { FileArchive, History, MessageSquareQuote, Settings2, ShieldCheck, Star, Trash2 } from "lucide-react";
import type { BrandKit, BrandKitPatch, BrandControls } from "@hc/sdk";
import { Button } from "@/components/ui/Button";
import { ControlToggle, VersionHistory } from "@/components/brand/kitEditors";
import { BrandKitTransfer } from "@/components/brand/BrandKitTransfer";
import { tr } from "@/lib/i18n";
import { SectionTitle } from "./SectionTitle";
import { LogoVersionsEditor } from "./LogoVersionsEditor";

const lines = (v: string) => v.split("\n").map((s) => s.trim()).filter(Boolean);

export function BrandSettingsTab({ workspaceId, kit, kits, canEdit, save, onMakeDefault, onDelete, onImported, onRestored }: {
  workspaceId: string;
  kit: BrandKit;
  kits: BrandKit[];
  canEdit: boolean;
  save: (patch: BrandKitPatch, done?: string) => Promise<boolean>;
  onMakeDefault: () => void;
  onDelete: () => void;
  onImported: (kit: BrandKit, replaced: boolean) => void | Promise<void>;
  onRestored: (kit: BrandKit) => void;
}) {
  const [busy, setBusy] = useState(false);
  const voice = kit.voice ?? { tone: [], doSay: [], dontSay: [] };
  const control = async (patch: Partial<BrandControls>) => {
    setBusy(true);
    await save({ controls: patch });
    setBusy(false);
  };
  const setVoice = (patch: Partial<typeof voice>) => void save({ voice: { ...voice, ...patch } });
  const field = "w-full rounded-lg border border-neutral-200 bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand-400 disabled:bg-neutral-50 disabled:text-neutral-500";
  const label = "mb-1 block text-xs font-medium text-neutral-600";

  return (
    <div key={kit.id} className="flex max-w-2xl flex-col gap-8">
      <section>
        <SectionTitle icon={Settings2} label={tr("brand.general")} />
        <div className="flex flex-col gap-3 px-2">
          <label>
            <span className={label}>{tr("brand.kit_name")}</span>
            <input
              key={`${kit.id}-${kit.name}`}
              defaultValue={kit.name}
              disabled={!canEdit}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== kit.name) void save({ name: v }); }}
              className={field}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-600">
            <Star size={14} className={kit.isDefault ? "fill-amber-400 text-amber-500" : "text-neutral-400"} />
            {kit.isDefault ? tr("brand.is_default") : tr("brand.is_not_default")}
            {canEdit && !kit.isDefault && <Button variant="secondary" size="sm" onClick={onMakeDefault}>{tr("brand.make_default")}</Button>}
          </div>
        </div>
      </section>

      <LogoVersionsEditor kit={kit} canEdit={canEdit} save={save} />

      <section>
        <SectionTitle icon={ShieldCheck} label={tr("brand.rules")} />
        <p className="mb-3 px-2 text-sm text-neutral-500">{tr("brand.rules_hint")}</p>
        <div className="flex flex-col gap-2 px-2">
          <ControlToggle label={tr("editor.lock_colors_to_palette")} checked={kit.controls.lockColors} disabled={!canEdit || busy} onChange={(v) => void control({ lockColors: v })} />
          <ControlToggle label={tr("editor.lock_fonts_to_approved_set")} checked={kit.controls.lockFonts} disabled={!canEdit || busy} onChange={(v) => void control({ lockFonts: v })} />
          <ControlToggle label={tr("editor.restrict_to_brand_templates")} checked={kit.controls.restrictTemplates} disabled={!canEdit || busy} onChange={(v) => void control({ restrictTemplates: v })} />
          <ControlToggle label={tr("brand.check_contrast")} checked={!!kit.controls.checkContrast} disabled={!canEdit || busy} onChange={(v) => void control({ checkContrast: v })} />
          <label className="mt-1">
            <span className={label}>{tr("brand.lint_policy")}</span>
            <select value={kit.controls.lintPolicy} disabled={!canEdit || busy} onChange={(e) => void control({ lintPolicy: e.target.value as BrandControls["lintPolicy"] })} className={`${field} h-9`}>
              <option value="off">{tr("brand.lint_off")}</option>
              <option value="warn">{tr("brand.lint_warn")}</option>
              <option value="block">{tr("brand.lint_block")}</option>
            </select>
          </label>
        </div>
      </section>

      <section>
        <SectionTitle icon={MessageSquareQuote} label={tr("editor.voice")} />
        <p className="mb-3 px-2 text-sm text-neutral-500">{tr("brand.voice_hint")}</p>
        <div className="flex flex-col gap-3 px-2">
          <label>
            <span className={label}>{tr("brand.voice_tone")}</span>
            <input key={`${kit.id}-tone-${kit.version}`} defaultValue={voice.tone.join(", ")} disabled={!canEdit} placeholder={tr("editor.friendly_confident")} onBlur={(e) => { const tone = e.target.value.split(",").map((s) => s.trim()).filter(Boolean); if (tone.join(",") !== voice.tone.join(",")) setVoice({ tone }); }} className={field} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className={label}>{tr("brand.voice_do")}</span>
              <textarea key={`${kit.id}-do-${kit.version}`} rows={4} defaultValue={voice.doSay.join("\n")} disabled={!canEdit} onBlur={(e) => { const doSay = lines(e.target.value); if (doSay.join("\n") !== voice.doSay.join("\n")) setVoice({ doSay }); }} className={field} />
            </label>
            <label>
              <span className={label}>{tr("brand.voice_dont")}</span>
              <textarea key={`${kit.id}-dont-${kit.version}`} rows={4} defaultValue={voice.dontSay.join("\n")} disabled={!canEdit} onBlur={(e) => { const dontSay = lines(e.target.value); if (dontSay.join("\n") !== voice.dontSay.join("\n")) setVoice({ dontSay }); }} className={field} />
            </label>
          </div>
          <label>
            <span className={label}>{tr("brand.voice_sample")}</span>
            <textarea key={`${kit.id}-sample-${kit.version}`} rows={3} defaultValue={voice.sampleCopy ?? ""} disabled={!canEdit} onBlur={(e) => { const sampleCopy = e.target.value.trim() || undefined; if (sampleCopy !== voice.sampleCopy) setVoice({ sampleCopy }); }} className={field} />
          </label>
        </div>
      </section>

      {canEdit && (
        <section>
          <SectionTitle icon={FileArchive} label={tr("brand.file")} />
          <p className="mb-3 px-2 text-sm text-neutral-500">{tr("brand.file_hint")}</p>
          <div className="px-2">
            <BrandKitTransfer workspaceId={workspaceId} kit={kit} kits={kits} onImported={onImported} />
          </div>
        </section>
      )}

      {canEdit && (
        <section>
          <SectionTitle icon={History} label={tr("editor.version_history")} />
          <div className="px-2">
            <VersionHistory kitId={kit.id} onRestored={onRestored} />
          </div>
        </section>
      )}

      {canEdit && (
        <section>
          <SectionTitle icon={Trash2} label={tr("brand.delete_brand")} />
          <p className="mb-3 px-2 text-sm text-neutral-500">{tr("brand.delete_brand_hint")}</p>
          <div className="px-2">
            <Button variant="danger" size="sm" className="gap-1.5" onClick={onDelete}><Trash2 size={14} /> {tr("brand.delete_brand")}</Button>
          </div>
        </section>
      )}
    </div>
  );
}
