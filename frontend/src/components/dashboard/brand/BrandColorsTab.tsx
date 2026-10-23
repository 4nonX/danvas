// The Brand page's colours: every palette of the kit with its swatches (the
// value, its print values, its role). With brand.kits colours are added by
// picker or hex value into a chosen palette, given a role, moved to another
// palette and removed, and the palettes themselves are added, renamed,
// reordered and deleted; taking colours from a design's selection or page
// stays in the editor's brand panel.

import { useState } from "react";
import { ArrowDown, ArrowUp, FolderInput, Palette, Pencil, Plus, Trash2 } from "lucide-react";
import type { BrandKit, BrandKitPatch } from "@hc/sdk";
import { hexOf, srgbFromHexFull } from "@/components/brand/kitEditors";
import { printColorLabel } from "@/lib/print/printColor";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { chooseAction, confirmAction, promptText } from "@/lib/promptDialog";
import { addColor, addPalette, deletePalette, moveColor, movePalette, renamePalette } from "@/lib/brandPalettes";
import { tr } from "@/lib/i18n";
import { SectionTitle } from "./SectionTitle";

export function BrandColorsTab({ kit, canEdit, save }: {
  kit: BrandKit;
  canEdit: boolean;
  save: (patch: BrandKitPatch, done?: string) => Promise<boolean>;
}) {
  const toast = useToast();
  // Starts at the brand's first colour (a neighbour is the usual addition).
  const [hex, setHex] = useState(() => {
    const first = kit.palettes.flatMap((p) => p.colors)[0];
    return first ? hexOf(first.value) : "#000000";
  });
  const clean = hex.trim().toLowerCase();
  const valid = /^#[0-9a-f]{6}$/.test(clean);
  const total = kit.palettes.reduce((n, p) => n + p.colors.length, 0);

  // The palette a new colour goes into (the first one until another is picked).
  const [target, setTarget] = useState<string | null>(null);
  const into = kit.palettes.some((p) => p.id === target) ? target : (kit.palettes[0]?.id ?? null);

  // Into the chosen palette, once (the palette already holding it says so).
  async function add() {
    if (!valid) return;
    if (kit.palettes.some((p) => p.colors.some((c) => hexOf(c.value) === clean))) {
      toast.toast(tr("editor.color_already_in_palette"));
      return;
    }
    const palettes = addColor(kit.palettes, into, { role: "accent", value: srgbFromHexFull(clean) }, tr("editor.palette"));
    await save({ palettes }, tr("editor.colors_added", { count: "1" }));
  }

  async function newPalette() {
    const name = await promptText({ title: tr("brand.new_palette"), label: tr("brand.palette_name"), placeholder: tr("brand.palette_example"), confirmText: tr("brand.create") });
    if (!name?.trim()) return;
    const { palettes, id } = addPalette(kit.palettes, name);
    if (await save({ palettes })) setTarget(id);
  }
  async function renamePal(id: string) {
    const pal = kit.palettes.find((x) => x.id === id);
    if (!pal) return;
    const name = await promptText({ title: tr("brand.rename_palette"), label: tr("brand.palette_name"), defaultValue: pal.name, confirmText: tr("brand.save") });
    if (name?.trim() && name.trim() !== pal.name) await save({ palettes: renamePalette(kit.palettes, id, name) });
  }
  async function deletePal(id: string) {
    const pal = kit.palettes.find((x) => x.id === id);
    if (!pal) return;
    if (pal.colors.length) {
      const ok = await confirmAction({ title: tr("brand.delete_palette"), message: tr("brand.delete_palette_message", { name: pal.name || tr("editor.palette"), count: pal.colors.length }), confirmText: tr("brand.delete"), danger: true });
      if (!ok) return;
    }
    await save({ palettes: deletePalette(kit.palettes, id) }, tr("brand.palette_deleted"));
  }
  async function moveTo(colorId: string, from: string, hex: string) {
    const to = await chooseAction({
      title: tr("brand.move_color"),
      message: tr("brand.move_color_message", { name: hex.toUpperCase() }),
      choices: kit.palettes.filter((x) => x.id !== from).map((x) => ({ value: x.id, label: x.name || tr("editor.palette") })),
    });
    if (to) await save({ palettes: moveColor(kit.palettes, colorId, to) });
  }
  const iconBtn = "grid h-7 w-7 place-items-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-30";

  const setRole = (id: string, role: string) =>
    void save({ palettes: kit.palettes.map((p) => ({ ...p, colors: p.colors.map((c) => (c.id === id ? { ...c, role } : c)) })) });
  // The colour book reference (a label for the export's colour list; empty
  // removes it).
  const setPantone = (id: string, pantone: string) =>
    void save({ palettes: kit.palettes.map((p) => ({ ...p, colors: p.colors.map((c) => {
      if (c.id !== id) return c;
      const { pantone: _old, ...rest } = c;
      return pantone ? { ...rest, pantone } : rest;
    }) })) });
  const remove = (id: string) =>
    void save({ palettes: kit.palettes.map((p) => ({ ...p, colors: p.colors.filter((c) => c.id !== id) })) });

  return (
    <div className="max-w-4xl">
      <p className="mb-4 max-w-2xl px-2 text-sm text-neutral-500">{canEdit ? tr("brand.colors_hint") : tr("brand.colors_hint_read_only")}</p>
      {total === 0 && <p className="px-2 text-sm text-neutral-500">{tr("editor.no_brand_colors_yet")}</p>}
      {/* Empty palettes show to those who can fill them. */}
      {kit.palettes.filter((p) => canEdit || p.colors.length > 0).map((p, pi, shown) => (
        <section key={p.id} className="group/pal mb-5">
          <SectionTitle
            icon={Palette}
            label={p.name || tr("editor.palette")}
            count={p.colors.length}
            action={canEdit && (
              <span className="flex shrink-0 items-center opacity-0 transition group-hover/pal:opacity-100 group-focus-within/pal:opacity-100">
                <button type="button" className={iconBtn} title={tr("brand.move_up")} aria-label={tr("brand.move_up")} disabled={pi === 0} onClick={() => void save({ palettes: movePalette(kit.palettes, p.id, -1) })}><ArrowUp size={13} /></button>
                <button type="button" className={iconBtn} title={tr("brand.move_down")} aria-label={tr("brand.move_down")} disabled={pi === shown.length - 1} onClick={() => void save({ palettes: movePalette(kit.palettes, p.id, 1) })}><ArrowDown size={13} /></button>
                <button type="button" className={iconBtn} title={tr("brand.rename_palette")} aria-label={tr("brand.rename_palette")} onClick={() => void renamePal(p.id)}><Pencil size={13} /></button>
                <button type="button" className={iconBtn} title={tr("brand.delete_palette")} aria-label={tr("brand.delete_palette")} onClick={() => void deletePal(p.id)}><Trash2 size={13} /></button>
              </span>
            )}
          />
          {p.colors.length === 0 && <p className="px-2 text-xs text-neutral-400">{tr("brand.palette_empty")}</p>}
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {p.colors.map((c) => {
              const h = hexOf(c.value);
              const print = printColorLabel(c.value);
              return (
                <li key={c.id} className="group overflow-hidden rounded-xl border border-neutral-200 bg-surface">
                  <div className="light h-16" style={{ backgroundColor: h }} />
                  <div className="flex flex-col gap-0.5 px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      <span className="min-w-0 flex-1 select-all font-mono text-xs font-medium uppercase text-neutral-800">{h}</span>
                      {canEdit && kit.palettes.length > 1 && (
                        <button type="button" onClick={() => void moveTo(c.id, p.id, h)} title={tr("brand.move_color")} aria-label={`${tr("brand.move_color")}: ${h}`} className="grid h-6 w-6 place-items-center rounded-md text-neutral-400 opacity-70 hover:bg-neutral-100 hover:text-neutral-800 group-hover:opacity-100">
                          <FolderInput size={13} />
                        </button>
                      )}
                      {canEdit && (
                        <button type="button" onClick={() => remove(c.id)} title={tr("brand.remove_color")} aria-label={`${tr("brand.remove_color")}: ${h}`} className="grid h-6 w-6 place-items-center rounded-md text-neutral-400 opacity-70 hover:bg-neutral-100 hover:text-red-600 group-hover:opacity-100">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                    {print && <span className="truncate text-[11px] text-neutral-500" title={print}>{print}</span>}
                    {canEdit ? (
                      <input
                        key={`${c.id}-${c.role}`}
                        defaultValue={c.role}
                        aria-label={tr("brand.color_role")}
                        placeholder={tr("brand.color_role")}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.role) setRole(c.id, v); }}
                        className="mt-0.5 w-full rounded-md border border-transparent px-1 py-0.5 text-[11px] text-neutral-500 outline-none hover:border-neutral-200 focus:border-brand-400"
                      />
                    ) : (
                      <span className="text-[11px] text-neutral-400">{c.role}</span>
                    )}
                    {canEdit ? (
                      <input
                        key={`${c.id}-pantone-${c.pantone ?? ""}`}
                        defaultValue={c.pantone ?? ""}
                        aria-label={tr("brand.color_pantone")}
                        placeholder={tr("brand.color_pantone")}
                        title={tr("brand.color_pantone_hint")}
                        maxLength={120}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== (c.pantone ?? "")) setPantone(c.id, v); }}
                        className="w-full rounded-md border border-transparent px-1 py-0.5 text-[11px] text-neutral-500 outline-none hover:border-neutral-200 focus:border-brand-400"
                      />
                    ) : (
                      c.pantone && <span className="truncate text-[11px] text-neutral-500" title={tr("brand.color_pantone")}>{c.pantone}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {canEdit && (
        <div className="mt-2 flex max-w-xl flex-wrap items-center gap-1.5 px-2">
          {kit.palettes.length > 1 && (
            <select
              value={into ?? ""}
              onChange={(e) => setTarget(e.target.value)}
              aria-label={tr("brand.add_to_palette")}
              title={tr("brand.add_to_palette")}
              className="h-8 max-w-[12rem] rounded-lg border border-neutral-200 bg-surface px-2 text-xs text-neutral-700 outline-none focus:border-brand-400"
            >
              {kit.palettes.map((x) => <option key={x.id} value={x.id}>{x.name || tr("editor.palette")}</option>)}
            </select>
          )}
          <input
            type="color"
            value={valid ? clean : "#000000"}
            onChange={(e) => setHex(e.target.value)}
            aria-label={tr("editor.add_color")}
            title={tr("editor.add_color")}
            className="oc-color h-8 w-8 shrink-0 cursor-pointer rounded-lg border border-neutral-200"
          />
          <input
            value={hex}
            onChange={(e) => setHex(e.target.value.startsWith("#") || e.target.value === "" ? e.target.value : `#${e.target.value}`)}
            onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
            aria-label={tr("editor.hex")}
            placeholder="#000000"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-surface px-2 py-1.5 font-mono text-xs uppercase outline-none focus:border-brand-400"
          />
          <button
            type="button"
            onClick={() => void add()}
            disabled={!valid}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:bg-neutral-200 disabled:text-neutral-400"
          >
            <Plus size={13} /> {tr("editor.add_color")}
          </button>
        </div>
      )}
      {canEdit && <Button variant="secondary" size="sm" className="ms-2 mt-3 gap-1" onClick={() => void newPalette()}><Plus size={14} /> {tr("brand.new_palette")}</Button>}
    </div>
  );
}
