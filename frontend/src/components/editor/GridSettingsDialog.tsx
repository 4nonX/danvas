// Grid settings (View menu): the distance between the main lines in any
// unit, finer lines between them, and the switches that go with the grid.
// Changes apply at once and are kept for this user in this browser.

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useEditor } from "@/store/editor";
import { MEASURE_UNITS, formatLength, type MeasureUnit } from "@/lib/units";
import { gridStep, MAX_SUBDIVISIONS } from "@/lib/viewPrefs";
import { tr } from "@/lib/i18n";
import { resolvedLocale } from "@/lib/locale";

export function GridSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const grid = useEditor((s) => s.grid);
  const showGrid = useEditor((s) => s.showGrid);
  const snapEnabled = useEditor((s) => s.snapEnabled);
  const doc = useEditor((s) => s.doc);
  // The typed text, so a half-typed "0," is not thrown away.
  const [text, setText] = useState<string | null>(null);
  const st = useEditor.getState();
  const step = gridStep(grid, doc.dpi ?? 96);
  const unit = (doc.measureUnit ?? "px") as MeasureUnit;

  const commit = (raw: string) => {
    const v = Number(raw.replace(",", "."));
    if (Number.isFinite(v) && v > 0) st.setGrid({ value: v });
    setText(null);
  };

  const box = "h-4 w-4 shrink-0 accent-brand-600";
  const field = "h-8 rounded-lg border border-neutral-200 bg-surface px-2 text-sm text-neutral-800 outline-none focus:border-brand-400";
  return (
    <Modal open={open} onClose={onClose} title={tr("editor.grid_settings")}>
      <div className="flex flex-col gap-4 text-sm">
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span className="text-neutral-700">{tr("editor.grid_show")}</span>
          <input type="checkbox" checked={showGrid} onChange={() => st.toggleGrid()} className={box} />
        </label>
        <div>
          <span className="mb-1 block text-xs font-medium text-neutral-500">{tr("editor.grid_spacing")}</span>
          <div className="flex gap-2">
            <input
              inputMode="decimal"
              aria-label={tr("editor.grid_spacing")}
              value={text ?? grid.value.toLocaleString(resolvedLocale(), { maximumFractionDigits: 3, useGrouping: false })}
              onChange={(e) => setText(e.target.value)}
              onBlur={(e) => commit(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commit((e.target as HTMLInputElement).value); }}
              className={`${field} min-w-0 flex-1`}
            />
            <select
              aria-label={tr("editor.grid_unit")}
              value={grid.unit}
              onChange={(e) => st.setGrid({ unit: e.target.value as MeasureUnit })}
              className={field}
            >
              {MEASURE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          {grid.unit !== unit && (
            <span className="mt-1 block text-[11px] text-neutral-400">{tr("editor.grid_in_design_unit", { length: formatLength(step.major, unit, doc.dpi ?? 96) })}</span>
          )}
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">{tr("editor.grid_subdivisions")}</span>
          <input
            type="number"
            min={1}
            max={MAX_SUBDIVISIONS}
            step={1}
            value={grid.subdivisions}
            onChange={(e) => st.setGrid({ subdivisions: Number(e.target.value) || 1 })}
            className={`${field} w-24`}
          />
          <span className="mt-1 block text-[11px] leading-snug text-neutral-400">{tr("editor.grid_subdivisions_hint")}</span>
        </label>
        <label className="flex cursor-pointer items-start justify-between gap-3">
          <span className="text-neutral-700">
            {tr("editor.grid_snap")}
            <span className="mt-0.5 block text-[11px] leading-snug text-neutral-400">{tr("editor.grid_snap_hint")}</span>
          </span>
          <input type="checkbox" checked={snapEnabled} onChange={() => st.toggleSnap()} className={`mt-0.5 ${box}`} />
        </label>
        <p className="text-[11px] leading-snug text-neutral-400">{tr("editor.grid_kept_hint")}</p>
        <div className="flex justify-end">
          <Button size="sm" onClick={onClose}>{tr("editor.done")}</Button>
        </div>
      </div>
    </Modal>
  );
}
