// "Several on one sheet" (F45) in the download menu and the print dialog:
// switch it on, choose the sheet (download only; printing uses the dialog's
// paper), margin, gap, marks, turning and order, and see how many fit and a
// small picture of the sheet.

import { evalExpression } from "@hc/editor";
import { imposeSummary, sheetSizeMm, type ImposeSettings, type ImposeSheet } from "@/lib/print/impose";
import { tr } from "@/lib/i18n";

const select = "h-8 w-full min-w-0 rounded-lg border border-neutral-200 bg-surface px-2 text-xs text-neutral-800 outline-none focus:border-brand-400";
// i18n-ignore: paper format names are the same in every language
const SHEET_NAMES: Record<Exclude<ImposeSheet, "custom">, string> = { a4: "A4", a3: "A3", sra3: "SRA3 (320 x 450 mm)", letter: "Letter" };
// i18n-ignore: the unit symbol
const MM = "mm";

function MmInput({ label, value, onCommit, min = 0, max = 2000 }: { label: string; value: number; onCommit: (v: number) => void; min?: number; max?: number }) {
  return (
    <label className="flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 bg-surface px-2 text-xs transition focus-within:border-brand-400">
      <span className="shrink-0 text-[11px] text-neutral-500">{label}</span>
      <input
        key={value}
        defaultValue={String(value)}
        onBlur={(e) => {
          const n = evalExpression(e.target.value, value);
          if (n === null || n < min || n > max) e.target.value = String(value);
          else if (n !== value) onCommit(Math.round(n * 100) / 100);
        }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="w-full min-w-0 bg-transparent text-neutral-800 outline-none"
      />
      <span className="shrink-0 text-[11px] text-neutral-400">{MM}</span>
    </label>
  );
}

export function ImposeFields({ value, onChange, sheetMm, page, pageCount, chooseSheet }: {
  value: ImposeSettings;
  onChange: (next: ImposeSettings) => void;
  /** The sheet in portrait, mm (the dialog's paper when printing). */
  sheetMm: [number, number];
  /** The first page's trim size and the bleed it is exported with, mm. */
  page: { widthMm: number; heightMm: number; bleedMm: number } | null;
  pageCount: number;
  /** Download: the sheet is chosen here. */
  chooseSheet: boolean;
}) {
  const set = (patch: Partial<ImposeSettings>) => onChange({ ...value, ...patch });
  const sum = value.on ? imposeSummary(page, pageCount, value, chooseSheet ? sheetSizeMm(value) : sheetMm) : null;
  return (
    <div className="mb-3 flex flex-col gap-2 rounded-lg border border-neutral-200 p-2.5">
      <label className="flex cursor-pointer items-start justify-between gap-3 text-xs text-neutral-700">
        <span>
          {tr("editor.impose_title")}
          <span className="mt-0.5 block text-[11px] leading-snug text-neutral-400">{tr("editor.impose_desc")}</span>
        </span>
        <input type="checkbox" checked={value.on} onChange={(e) => set({ on: e.target.checked })} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" />
      </label>
      {value.on && (
        <>
          {chooseSheet && (
            <div className="grid grid-cols-2 gap-2">
              <label className="col-span-2 flex flex-col gap-1 text-[11px] text-neutral-500">
                {tr("editor.impose_sheet")}
                <select value={value.sheet} onChange={(e) => set({ sheet: e.target.value as ImposeSheet })} className={select}>
                  {(Object.keys(SHEET_NAMES) as Exclude<ImposeSheet, "custom">[]).map((k) => <option key={k} value={k}>{SHEET_NAMES[k]}</option>)}
                  <option value="custom">{tr("editor.impose_sheet_custom")}</option>
                </select>
              </label>
              {value.sheet === "custom" && (
                <>
                  <MmInput label={tr("editor.impose_width")} value={value.widthMm} min={20} onCommit={(widthMm) => set({ widthMm })} />
                  <MmInput label={tr("editor.impose_height")} value={value.heightMm} min={20} onCommit={(heightMm) => set({ heightMm })} />
                </>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <MmInput label={tr("editor.impose_margin")} value={value.marginMm} max={50} onCommit={(marginMm) => set({ marginMm })} />
            <MmInput label={tr("editor.impose_gap")} value={value.gapMm} max={50} onCommit={(gapMm) => set({ gapMm })} />
          </div>
          <label className="flex flex-col gap-1 text-[11px] text-neutral-500">
            {tr("editor.impose_orientation")}
            <select value={value.orientation} onChange={(e) => set({ orientation: e.target.value as ImposeSettings["orientation"] })} className={select}>
              <option value="auto">{tr("editor.impose_orientation_auto")}</option>
              <option value="portrait">{tr("editor.impose_orientation_portrait")}</option>
              <option value="landscape">{tr("editor.impose_orientation_landscape")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-neutral-500">
            {tr("editor.impose_fill")}
            <select value={value.fill} onChange={(e) => set({ fill: e.target.value as ImposeSettings["fill"] })} className={select}>
              <option value="repeat">{tr("editor.impose_fill_repeat")}</option>
              <option value="sequence">{tr("editor.impose_fill_sequence")}</option>
            </select>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-700">
            <input type="checkbox" checked={value.marks} onChange={(e) => set({ marks: e.target.checked })} className="h-3.5 w-3.5 accent-brand-600" />
            {tr("editor.impose_marks")}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-700">
            <input type="checkbox" checked={value.rotate} onChange={(e) => set({ rotate: e.target.checked })} className="h-3.5 w-3.5 accent-brand-600" />
            {tr("editor.impose_rotate")}
          </label>
          {sum ? (
            <div className="flex items-center gap-3">
              <SheetPicture plan={sum.plan} />
              <p className="text-[11px] leading-snug text-neutral-600">
                {tr("editor.impose_summary", { count: sum.perSheet, cols: sum.plan.cols, rows: sum.plan.rows })}
                <span className="block text-neutral-400">{tr("editor.impose_sheets", { count: sum.sheets })}</span>
                {sum.plan.rotated && <span className="block text-neutral-400">{tr("editor.impose_rotated")}</span>}
              </p>
            </div>
          ) : page ? (
            <p className="text-[11px] font-medium text-amber-700">{tr("editor.impose_does_not_fit")}</p>
          ) : null}
        </>
      )}
    </div>
  );
}

/** The sheet with its slots, to scale. */
function SheetPicture({ plan }: { plan: NonNullable<ReturnType<typeof imposeSummary>>["plan"] }) {
  const k = 64 / Math.max(plan.sheetW, plan.sheetH);
  return (
    <svg width={plan.sheetW * k} height={plan.sheetH * k} viewBox={`0 0 ${plan.sheetW} ${plan.sheetH}`} className="light shrink-0 rounded-sm border border-neutral-300 bg-white" aria-hidden>
      {plan.slots.map((s, i) => <rect key={i} x={s.x} y={s.y} width={plan.itemW} height={plan.itemH} className="fill-brand-100 stroke-brand-500" strokeWidth={0.8} />)}
      {plan.marks.map((m, i) => <line key={i} x1={m.x1} y1={m.y1} x2={m.x2} y2={m.y2} className="stroke-neutral-900" strokeWidth={0.6} />)}
    </svg>
  );
}
