// The finished size of an export profile (F48): width and height in mm, both
// empty for "any size". Shared by the download menu and the profile editor.

import { useState } from "react";
import { X } from "lucide-react";
import type { TrimSize } from "@/lib/trimSize";
import { tr } from "@/lib/i18n";

// i18n-ignore: the unit symbol
const MM = "mm";

const input = "h-8 w-full min-w-0 rounded-lg border border-neutral-200 bg-surface px-2 text-xs tabular-nums outline-none focus:border-brand-400";

const parse = (v: string): number | null => {
  const n = Number(v.replace(",", ".").trim());
  return v.trim() !== "" && Number.isFinite(n) && n >= 1 && n <= 5000 ? Math.round(n * 100) / 100 : null;
};
const text = (n: number | undefined) => (n === undefined ? "" : String(n).replace(".", (1.5).toLocaleString().charAt(1)));

export function TrimSizeFields({ value, onChange }: { value: TrimSize | null; onChange: (v: TrimSize | null) => void }) {
  // What is typed, kept until both sides make a size (or both are emptied).
  const [draft, setDraft] = useState<{ w: string; h: string } | null>(null);
  const shown = draft ?? { w: text(value?.w), h: text(value?.h) };
  const commit = (next: { w: string; h: string }) => {
    const w = parse(next.w);
    const h = parse(next.h);
    if (w !== null && h !== null) { onChange({ w, h }); setDraft(null); }
    else if (!next.w.trim() && !next.h.trim()) { onChange(null); setDraft(null); }
    else setDraft(next);
  };
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-neutral-500">{tr("editor.trim_size")}</span>
      <div className="flex items-center gap-1.5">
        <input aria-label={tr("editor.trim_size_width")} inputMode="decimal" placeholder={tr("editor.trim_size_any")} value={shown.w} onChange={(e) => setDraft({ ...shown, w: e.target.value })} onBlur={() => commit(shown)} className={input} />
        <span className="text-neutral-400">×</span>
        <input aria-label={tr("editor.trim_size_height")} inputMode="decimal" placeholder={tr("editor.trim_size_any")} value={shown.h} onChange={(e) => setDraft({ ...shown, h: e.target.value })} onBlur={() => commit(shown)} className={input} />
        <span className="shrink-0 text-xs text-neutral-400">{MM}</span>
        {(value || draft) && (
          <button type="button" onClick={() => { setDraft(null); onChange(null); }} title={tr("editor.trim_size_clear")} aria-label={tr("editor.trim_size_clear")} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
            <X size={13} />
          </button>
        )}
      </div>
      <span className="mt-1 block text-[11px] leading-snug text-neutral-400">{tr("editor.trim_size_desc")}</span>
    </div>
  );
}
