// Bleed and crop-mark settings of one or more pages, shared by the page panel
// (the active page) and the download menu (the pages being exported), so both
// show the same fields and write the same values. The values live on the
// pages; with several pages the first one's are shown and a change applies to
// all of them.

import { evalExpression } from "@hc/editor";
import type { Color } from "@hc/schema";
import { useEditor } from "@/store/editor";
import { tr } from "@/lib/i18n";
import { marksMmOf, marksPatchPx, mmToPx, pxToMm } from "@/lib/print/sheet";
import { ColorField } from "./ColorField";

/** The bleed a page gets when it is switched on: the common 3 mm. */
export const BLEED_DEFAULT_MM = 3;

const BLACK: Color = { srgb: { r: 0, g: 0, b: 0, a: 1 } } as Color;
const selectCls = "w-full rounded-lg border border-neutral-200 bg-surface px-2 py-1.5 text-sm text-neutral-800 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100";
const round2 = (v: number) => Math.round(v * 100) / 100;

/** A number field that commits on blur or Enter (arithmetic allowed), in the
 *  look of the properties panel's fields. */
function NumField({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
  const initial = String(round2(value));
  return (
    <label className="flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 bg-surface px-2 text-[13px] transition focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
      <span className="shrink-0 text-xs font-medium text-neutral-400">{label}</span>
      <input
        key={initial}
        defaultValue={initial}
        onBlur={(e) => {
          const n = evalExpression(e.target.value, value);
          if (n === null) e.target.value = initial;
          else onCommit(n);
        }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="w-full min-w-0 bg-transparent text-neutral-800 outline-none"
      />
    </label>
  );
}

/** The pages at `indexes` in the editor's document (missing ones dropped). */
function pagesAt(indexes: number[]) {
  const all = useEditor.getState().doc.pages;
  return indexes.map((i) => all[i]).filter(Boolean);
}

/** Does any of the pages have a bleed / crop marks switched on? */
export function pagesHaveBleed(indexes: number[]): boolean {
  return pagesAt(indexes).some((p) => (p.bleed ?? 0) > 0);
}
export function pagesHaveMarks(indexes: number[]): boolean {
  return pagesAt(indexes).some((p) => !!p.printMarks?.crop);
}

/** Switch the bleed of the pages on (3 mm, or what they had) or off. */
export function setPagesBleed(indexes: number[], on: boolean) {
  const dpi = useEditor.getState().doc.dpi ?? 96;
  useEditor.getState().setPagePrint({ bleed: on ? mmToPx(BLEED_DEFAULT_MM, dpi) : 0 }, indexes);
}

/** Switch the crop marks of the pages on or off, keeping their settings. */
export function setPagesMarks(indexes: number[], on: boolean) {
  const first = pagesAt(indexes)[0];
  const raw = first?.printMarks;
  useEditor.getState().setPagePrint({ printMarks: on ? { ...(raw ?? {}), crop: true } : raw ? { ...raw, crop: false } : null }, indexes);
}

/** Crop-mark settings in the units the fields show. */
export interface MarksMm { style: string; color?: Color; weightPt: number; lengthMm: number; offsetMm: number }

/** The bleed in millimetres, for any value (a page's, or an export's own). */
export function BleedInput({ mm, onChange, label }: { mm: number; onChange: (mm: number) => void; label?: string }) {
  return <NumField label={label ?? tr("editor.bleed_mm")} value={round2(mm)} onCommit={(n) => onChange(Math.max(0, Math.min(50, n)))} />;
}

/** Line type, color, weight, length and gap of crop marks, for any value. */
export function MarkInputs({ marks, onChange }: { marks: MarksMm; onChange: (patch: Partial<MarksMm>) => void }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <select
          aria-label={tr("editor.crop_mark_style")}
          title={tr("editor.crop_mark_style")}
          value={marks.style}
          onChange={(e) => onChange({ style: e.target.value })}
          className={selectCls}
        >
          <option value="solid">{tr("editor.line_solid")}</option>
          <option value="dashed">{tr("editor.line_dashed")}</option>
          <option value="dotted">{tr("editor.line_dotted")}</option>
        </select>
        <div className="h-8 [&_.oc-color-trigger]:h-full">
          <ColorField value={marks.color ?? BLACK} onChange={(c) => onChange({ color: c })} title={tr("editor.crop_mark_color")} allowAlpha={false} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumField label={tr("editor.crop_mark_weight_pt")} value={marks.weightPt} onCommit={(n) => onChange({ weightPt: Math.max(0.05, Math.min(5, n)) })} />
        <NumField label={tr("editor.crop_mark_length_mm")} value={round2(marks.lengthMm)} onCommit={(n) => onChange({ lengthMm: Math.max(1, Math.min(30, n)) })} />
        <NumField label={tr("editor.crop_mark_offset_mm")} value={round2(marks.offsetMm)} onCommit={(n) => onChange({ offsetMm: Math.max(0, Math.min(30, n)) })} />
      </div>
    </>
  );
}

/** The bleed of the pages, in millimetres. */
export function BleedField({ indexes }: { indexes: number[] }) {
  useEditor((s) => s.rev);
  const dpi = useEditor.getState().doc.dpi ?? 96;
  const page = pagesAt(indexes)[0];
  if (!page) return null;
  return <BleedInput mm={pxToMm(page.bleed ?? 0, dpi)} onChange={(mm) => useEditor.getState().setPagePrint({ bleed: mmToPx(mm, dpi) }, indexes)} />;
}

/** The crop marks of the pages. */
export function MarkFields({ indexes }: { indexes: number[] }) {
  useEditor((s) => s.rev);
  const dpi = useEditor.getState().doc.dpi ?? 96;
  const page = pagesAt(indexes)[0];
  if (!page) return null;
  return (
    <MarkInputs
      marks={marksMmOf(page, dpi)}
      onChange={(patch) => useEditor.getState().setPagePrint({ printMarks: { ...(page.printMarks ?? { crop: true }), ...marksPatchPx(patch, dpi) } }, indexes)}
    />
  );
}
