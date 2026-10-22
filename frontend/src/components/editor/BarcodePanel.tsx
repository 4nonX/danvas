// Barcode settings (F43): the Insert dialog and the properties section of a
// selected barcode share one form. The value is checked while it is typed,
// with the reason in the user's language; sizes are in mm, as on any label
// specification. Every change encodes the barcode again (one undo step).

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { evalExpression } from "@hc/editor";
import type { Color } from "@hc/schema";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { ColorField } from "./ColorField";
import { useEditor } from "@/store/editor";
import { BLACK_INK, barcodeErrorText, buildBarcode, defaultSpec, loadBarcode, symbologyLabel, type BarcodeSpec, type Symbology } from "@/lib/barcode";
import { tr } from "@/lib/i18n";
import { printDpiLabel } from "@/lib/printPresets";

type BarcodeModule = Awaited<ReturnType<typeof loadBarcode>>;

const inputCls = "w-full rounded-lg border border-neutral-200 bg-surface px-2 py-1.5 text-sm text-neutral-800 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100";
const selectCls = inputCls;
const labelCls = "flex flex-col gap-1 text-[11px] text-neutral-400";
/** Printer resolutions a barcode can be rounded to (label printers and office lasers). */
const PRINTER_DPI = [203, 300, 600, 1200];
// i18n-ignore: the ink value, the same in every language
const K100_LABEL = "K 100";
// i18n-ignore: the unit symbol
const MM = "mm";
// i18n-ignore: the unit symbol
const DPI = "dpi";

/** The encoder, once loaded. */
function useBarcodeModule(): BarcodeModule | null {
  const [mod, setMod] = useState<BarcodeModule | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadBarcode().then((m) => { if (!cancelled) setMod(m); });
    return () => { cancelled = true; };
  }, []);
  return mod;
}

const mmText = (mm: number) => String(Math.round(mm * 1000) / 1000);

/** An example of what each type takes. */
const valueHint = (): Record<Symbology, string> => ({
  ean13: tr("editor.barcode_hint_ean13"),
  ean8: tr("editor.barcode_hint_ean8"),
  upca: tr("editor.barcode_hint_upca"),
  code128: tr("editor.barcode_hint_code128"),
  "gs1-128": tr("editor.barcode_hint_gs1"),
  code39: tr("editor.barcode_hint_code39"),
  pzn: tr("editor.barcode_hint_pzn"),
  datamatrix: tr("editor.barcode_hint_datamatrix"),
  gs1datamatrix: tr("editor.barcode_hint_gs1"),
});

/** A length in mm: shown with up to three decimals, typed with a decimal
 *  point or comma (or arithmetic, as every number field in the editor). */
function MmField({ label, value, onCommit, placeholder, min = 0 }: { label: string; value: number | undefined; onCommit: (mm: number | undefined) => void; placeholder?: string; min?: number }) {
  const initial = value === undefined ? "" : mmText(value);
  return (
    <label className="flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 bg-surface px-2 text-[13px] transition focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
      <span className="shrink-0 text-xs font-medium text-neutral-400">{label}</span>
      <input
        key={initial}
        defaultValue={initial}
        placeholder={placeholder}
        onBlur={(e) => {
          const t = e.target.value.trim();
          if (!t && placeholder !== undefined) { if (value !== undefined) onCommit(undefined); return; }
          const n = evalExpression(t.replace(/\s*mm$/i, ""), value ?? 0);
          if (n === null || !(n >= min)) e.target.value = initial;
          else if (n !== value) onCommit(n);
        }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="w-full min-w-0 bg-transparent text-neutral-800 outline-none"
      />
      <span className="shrink-0 text-[11px] text-neutral-400">{MM}</span>
    </label>
  );
}

/** The printer resolution: none, a usual one, or any other typed in. */
function PrinterDpiField({ value, onChange }: { value: number | undefined; onChange: (dpi: number | undefined) => void }) {
  const [other, setOther] = useState(value !== undefined && !PRINTER_DPI.includes(value));
  const choice = other ? "other" : value === undefined ? "" : String(value);
  return (
    <>
      <label className={labelCls}>
        {tr("editor.barcode_printer_dpi")}
        <select
          value={choice}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "other") { setOther(true); return; }
            setOther(false);
            onChange(v ? Number(v) : undefined);
          }}
          className={selectCls}
        >
          <option value="">{tr("editor.barcode_printer_none")}</option>
          {PRINTER_DPI.map((d) => <option key={d} value={d}>{printDpiLabel(d)}</option>)}
          <option value="other">{tr("editor.barcode_printer_other")}</option>
        </select>
      </label>
      {other && (
        <label className="flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 bg-surface px-2 text-[13px] transition focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
          <span className="shrink-0 text-xs font-medium text-neutral-400">{tr("editor.barcode_printer_dpi_custom")}</span>
          <input
            key={value ?? ""}
            defaultValue={value ?? ""}
            inputMode="numeric"
            onBlur={(e) => {
              const n = Math.round(Number(e.target.value.replace(",", ".")));
              if (Number.isFinite(n) && n >= 72 && n <= 4800) { if (n !== value) onChange(n); }
              else e.target.value = value ? String(value) : "";
            }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className="w-full min-w-0 bg-transparent text-neutral-800 outline-none"
          />
          <span className="shrink-0 text-[11px] text-neutral-400">{DPI}</span>
        </label>
      )}
    </>
  );
}

/** The value's check: what will be encoded, or why it cannot be. */
function ValueStatus({ mod, spec }: { mod: BarcodeModule | null; spec: BarcodeSpec }) {
  const res = useMemo(() => (mod ? mod.encode(spec.symbology, spec.value, { rectangular: spec.rectangular }) : null), [mod, spec.symbology, spec.value, spec.rectangular]);
  if (!res) return null;
  if (!res.ok) {
    return (
      <p className="flex items-start gap-1.5 text-[11px] text-red-600" role="alert">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" /> <span>{barcodeErrorText(res)}{res.code !== "empty" && res.code !== "characters" ? ` (${res.detail})` : ""}</span>
      </p>
    );
  }
  const shown = res.kind === "linear" && res.encoded !== spec.value.replace(/\s/g, "") ? res.encoded : null;
  return (
    <p className="flex items-start gap-1.5 text-[11px] text-emerald-700">
      <Check size={12} className="mt-0.5 shrink-0" />
      <span>{shown ? tr("editor.barcode_encodes_as", { value: shown }) : tr("editor.barcode_valid")}</span>
    </p>
  );
}

/** What X and the printer give: the module width used and dots per module. */
function SizeNote({ mod, spec }: { mod: BarcodeModule | null; spec: BarcodeSpec }) {
  if (!mod) return null;
  const rules = mod.RULES[spec.symbology];
  const notes: string[] = [];
  if (spec.printerDpi) {
    const dot = 25.4 / spec.printerDpi;
    const dots = Math.max(1, Math.round(spec.moduleMm / dot));
    notes.push(tr("editor.barcode_dots", { dots, mm: mmText(dots * dot) }));
  }
  if (rules.retail) notes.push(tr("editor.barcode_magnification", { percent: Math.round((spec.moduleMm / 0.33) * 100) }));
  const warn = spec.moduleMm < rules.minModuleMm;
  return (
    <>
      {notes.length > 0 && <p className="text-[11px] text-neutral-500">{notes.join(" · ")}</p>}
      {warn && <p className="text-[11px] text-amber-700">{tr("editor.barcode_too_small", { min: mmText(rules.minModuleMm) })}</p>}
    </>
  );
}

/** The form. `onChange` gets each committed change. */
export function BarcodeSettings({ spec, onChange, mod, idPrefix }: { spec: BarcodeSpec; onChange: (next: BarcodeSpec) => void; mod: BarcodeModule | null; idPrefix: string }) {
  const [draft, setDraft] = useState(spec.value);
  const [seen, setSeen] = useState(spec.value);
  if (seen !== spec.value) { setSeen(spec.value); setDraft(spec.value); }
  const linear = mod ? mod.RULES[spec.symbology].kind === "linear" : spec.symbology !== "datamatrix" && spec.symbology !== "gs1datamatrix";
  const set = (patch: Partial<BarcodeSpec>) => onChange({ ...spec, ...patch });
  const labels = symbologyLabel();
  return (
    <div className="flex flex-col gap-2.5">
      <label className={labelCls}>
        {tr("editor.barcode_type")}
        <select
          value={spec.symbology}
          onChange={(e) => {
            const s = e.target.value as Symbology;
            if (!mod) return;
            // A new type starts with that type's sizes; the value stays.
            const d = defaultSpec(mod, s, spec.value);
            set({ symbology: s, moduleMm: d.moduleMm, barHeightMm: d.barHeightMm, text: d.text, textSizeMm: undefined, rectangular: undefined });
          }}
          className={selectCls}
        >
          {(Object.keys(labels) as Symbology[]).map((s) => <option key={s} value={s}>{labels[s]}</option>)}
        </select>
      </label>
      <label className={labelCls} htmlFor={`${idPrefix}-value`}>
        {tr("editor.barcode_value")}
      </label>
      <input
        id={`${idPrefix}-value`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== spec.value) set({ value: draft }); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        placeholder={valueHint()[spec.symbology]}
        className={`${inputCls} font-mono`}
        spellCheck={false}
        autoComplete="off"
      />
      <ValueStatus mod={mod} spec={{ ...spec, value: draft }} />
      <div className="grid grid-cols-2 gap-2">
        <MmField label="X" value={spec.moduleMm} min={0.05} onCommit={(v) => v !== undefined && set({ moduleMm: v })} />
        {linear && <MmField label={tr("editor.barcode_height_short")} value={spec.barHeightMm} min={1} onCommit={(v) => v !== undefined && set({ barHeightMm: v })} />}
      </div>
      <SizeNote mod={mod} spec={spec} />
      <label className="flex items-center gap-2 text-xs text-neutral-600">
        <input type="checkbox" checked={spec.quietZones} onChange={(e) => set({ quietZones: e.target.checked })} />
        {tr("editor.barcode_quiet_zones")}
      </label>
      {!linear && (
        <label className="flex items-center gap-2 text-xs text-neutral-600">
          <input type="checkbox" checked={!!spec.rectangular} onChange={(e) => set({ rectangular: e.target.checked || undefined })} />
          {tr("editor.barcode_rectangular")}
        </label>
      )}
      <label className="flex items-center gap-2 text-xs text-neutral-600">
        <input type="checkbox" checked={spec.text} onChange={(e) => set({ text: e.target.checked })} />
        {tr("editor.barcode_text")}
      </label>
      {spec.text && (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 bg-surface px-2 text-[13px] transition focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
            <span className="shrink-0 text-xs font-medium text-neutral-400">{tr("editor.barcode_font_short")}</span>
            <input
              key={spec.fontFamily}
              defaultValue={spec.fontFamily}
              onBlur={(e) => { const f = e.target.value.trim(); if (f && f !== spec.fontFamily) set({ fontFamily: f }); else e.target.value = spec.fontFamily; }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className="w-full min-w-0 bg-transparent text-neutral-800 outline-none"
            />
          </label>
          <MmField label={tr("editor.barcode_text_size_short")} value={spec.textSizeMm} placeholder={tr("editor.barcode_auto")} min={0.5} onCommit={(v) => set({ textSizeMm: v })} />
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-[11px] text-neutral-400">{tr("editor.barcode_color")}</span>
        <div className="h-8 flex-1 [&_.oc-color-trigger]:h-full">
          <ColorField value={spec.color} onChange={(c: Color) => set({ color: { ...c, srgb: { ...c.srgb, a: 1 } } })} allowAlpha={false} title={tr("editor.barcode_color")} />
        </div>
        <button type="button" onClick={() => set({ color: BLACK_INK })} className="shrink-0 rounded-md px-1.5 py-1 text-[11px] font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800" title={tr("editor.barcode_black_ink_hint")}>
          {K100_LABEL}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <label className="flex w-20 shrink-0 items-center gap-1.5 text-[11px] text-neutral-400">
          <input type="checkbox" checked={!!spec.background} onChange={(e) => set({ background: e.target.checked ? { srgb: { r: 1, g: 1, b: 1, a: 1 }, cmyk: { c: 0, m: 0, y: 0, k: 0 } } : null })} />
          {tr("editor.barcode_background")}
        </label>
        {spec.background && (
          <div className="h-8 flex-1 [&_.oc-color-trigger]:h-full">
            <ColorField value={spec.background} onChange={(c: Color) => set({ background: { ...c, srgb: { ...c.srgb, a: 1 } } })} allowAlpha={false} title={tr("editor.barcode_background")} />
          </div>
        )}
      </div>
      <details className="rounded-lg border border-neutral-200 px-2.5 py-2">
        <summary className="cursor-pointer text-xs font-medium text-neutral-600">{tr("editor.barcode_print")}</summary>
        <div className="mt-2 flex flex-col gap-2">
          <PrinterDpiField value={spec.printerDpi} onChange={(printerDpi) => set({ printerDpi })} />
          <p className="text-[11px] text-neutral-500">{tr("editor.barcode_printer_dpi_hint")}</p>
          {linear && (
            <>
              <MmField label={tr("editor.barcode_reduction_short")} value={spec.barWidthReductionMm} placeholder="0" onCommit={(v) => set({ barWidthReductionMm: v || undefined })} />
              <p className="text-[11px] text-neutral-500">{tr("editor.barcode_reduction_hint")}</p>
            </>
          )}
        </div>
      </details>
    </div>
  );
}

/** A preview of the barcode as it will be drawn (bars and text), scaled to fit. */
function BarcodePreview({ mod, spec }: { mod: BarcodeModule | null; spec: BarcodeSpec }) {
  const built = useMemo(() => (mod ? buildBarcode(mod, spec, 96) : null), [mod, spec]);
  if (!built || !built.ok) return <div className="flex h-36 items-center justify-center rounded-lg border border-dashed border-neutral-200 text-xs text-neutral-400">{built ? tr("editor.barcode_no_preview") : ""}</div>;
  const l = built.layout;
  const d = l.contours.map((c) => `M${c.map((p) => `${p.x} ${p.y}`).join("L")}Z`).join("");
  const fill = (c: Color) => `rgb(${Math.round(c.srgb.r * 255)},${Math.round(c.srgb.g * 255)},${Math.round(c.srgb.b * 255)})`;
  return (
    <div className="light flex h-36 items-center justify-center rounded-lg border border-neutral-200 bg-white p-3">
      <svg viewBox={`0 0 ${l.width} ${l.height}`} className="max-h-full max-w-full" role="img" aria-label={tr("editor.barcode_preview")}>
        {spec.background && <rect width={l.width} height={l.height} fill={fill(spec.background)} />}
        <path d={d} fillRule="evenodd" fill={fill(spec.color)} />
        {l.texts.map((t, i) => (
          <text key={i} x={t.cx} y={t.top + t.size} fontSize={t.size} textAnchor="middle" fontFamily={`"${spec.fontFamily}", ui-monospace, monospace`} fill={fill(spec.color)}>{t.text}</text>
        ))}
      </svg>
    </div>
  );
}

/** Insert > Barcode. */
export function InsertBarcodeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mod = useBarcodeModule();
  const toast = useToast();
  const [spec, setSpec] = useState<BarcodeSpec | null>(null);
  const [busy, setBusy] = useState(false);
  if (open && mod && !spec) setSpec(defaultSpec(mod, "ean13", ""));
  if (!open) return null;
  const check = mod && spec ? mod.encode(spec.symbology, spec.value, { rectangular: spec.rectangular }) : null;
  const insert = async () => {
    if (!spec) return;
    setBusy(true);
    try {
      const err = await useEditor.getState().insertBarcode(spec);
      if (err) toast.error(barcodeErrorText(err));
      else { onClose(); setSpec(null); }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={busy ? () => {} : onClose} title={tr("editor.barcode_insert_title")} width="w-[34rem] max-w-full">
      {!spec ? (
        <p className="py-6 text-center text-sm text-neutral-500">{tr("editor.barcode_loading")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <BarcodePreview mod={mod} spec={spec} />
          <BarcodeSettings spec={spec} onChange={setSpec} mod={mod} idPrefix="insert-barcode" />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={onClose} disabled={busy}>{tr("editor.cancel")}</Button>
            <Button onClick={() => void insert()} disabled={busy || !check?.ok}>{tr("editor.barcode_insert")}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** The properties section of a selected barcode. */
export function BarcodeSection({ id, spec }: { id: string; spec: BarcodeSpec }) {
  const mod = useBarcodeModule();
  const toast = useToast();
  const change = async (next: BarcodeSpec) => {
    const err = await useEditor.getState().updateBarcode(id, next);
    if (err) toast.error(barcodeErrorText(err));
  };
  return (
    <BarcodeSettings key={id} spec={spec} onChange={(n) => void change(n)} mod={mod} idPrefix={`barcode-${id}`} />
  );
}
