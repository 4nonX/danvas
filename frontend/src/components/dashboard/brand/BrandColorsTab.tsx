// The Brand page's colours: every palette of the kit with its swatches (the
// value, its print values, its role). With brand.kits colours are added by
// picker or hex value, given a role and removed; taking them from a design's
// selection or page stays in the editor's brand panel.

import { useState } from "react";
import { Palette, Plus, Trash2 } from "lucide-react";
import type { BrandKit, BrandKitPatch } from "@hc/sdk";
import { hexOf, srgbFromHexFull } from "@/components/brand/kitEditors";
import { printColorLabel } from "@/lib/print/printColor";
import { useToast } from "@/components/ui/Toast";
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

  // Into the first palette, once (the palette already holding it says so).
  async function add() {
    if (!valid) return;
    if (kit.palettes.some((p) => p.colors.some((c) => hexOf(c.value) === clean))) {
      toast.toast(tr("editor.color_already_in_palette"));
      return;
    }
    const base = kit.palettes[0] ?? { id: `p-${crypto.randomUUID()}`, name: tr("editor.palette"), colors: [] };
    const first = { ...base, colors: [...base.colors, { id: `s-${crypto.randomUUID()}`, role: "accent", value: srgbFromHexFull(clean) }] };
    const palettes = kit.palettes.length ? kit.palettes.map((p, i) => (i === 0 ? first : p)) : [first];
    await save({ palettes }, tr("editor.colors_added", { count: "1" }));
  }

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
      {kit.palettes.filter((p) => p.colors.length > 0).map((p) => (
        <section key={p.id} className="mb-5">
          <SectionTitle icon={Palette} label={p.name || tr("editor.palette")} count={p.colors.length} />
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
        <div className="mt-2 flex max-w-md items-center gap-1.5 px-2">
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
    </div>
  );
}
