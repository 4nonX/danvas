// Change the format of one or many designs at once from the dashboard: a new
// page size, how the content follows, and an optional quarter turn (labels
// that run sideways on a roll). The result is previewed for every design
// before anything is saved; saving records it as a named version, so the
// state before stays in each design's version history.

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, RotateCcw, RotateCw, X } from "lucide-react";
import type { DesignFile } from "@hc/schema";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { DesignThumb } from "./DesignThumb";
import { oc } from "@/lib/sdk";
import { tr } from "@/lib/i18n";
import { userMessage } from "@/lib/errors";
import { MEASURE_UNITS, measureUnitOf, parseLength, unitInputText, type MeasureUnit } from "@/lib/units";
import { reformatDesign, type ReformatFit, type ReformatTurn } from "@/lib/reformat";
import { rewriteDesign } from "@/lib/rewriteDesign";

type Row = { id: string; title: string; doc?: DesignFile; error?: string; state?: "saving" | "done" | "failed" };

export function ReformatDialog({ designs, onClose, onDone, initialSizeMm }: { designs: { id: string; title: string }[]; onClose: () => void; onDone: () => void; initialSizeMm?: { w: number; h: number } }) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>(() => designs.map((d) => ({ ...d })));
  const [unit, setUnit] = useState<MeasureUnit>("mm");
  const [w, setW] = useState("");
  const [h, setH] = useState("");
  const [fit, setFit] = useState<ReformatFit>("scale");
  const [turn, setTurn] = useState<ReformatTurn>(0);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  // Load every design; the first one sets the starting size and unit, unless
  // the size is given (an export profile's finished size, F48).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let first = true;
      for (const d of designs) {
        try {
          const doc = await oc.getDesignFile(d.id);
          if (cancelled) return;
          if (first && initialSizeMm) {
            first = false;
            setUnit("mm");
            setW(unitInputText((initialSizeMm.w * 96) / 25.4, "mm", 96));
            setH(unitInputText((initialSizeMm.h * 96) / 25.4, "mm", 96));
          } else if (first) {
            first = false;
            const u = measureUnitOf(doc);
            const p = doc.pages[0];
            setUnit(u);
            if (p) { setW(unitInputText(p.width, u, doc.dpi ?? 96)); setH(unitInputText(p.height, u, doc.dpi ?? 96)); }
          }
          setRows((rs) => rs.map((r) => (r.id === d.id ? { ...r, doc } : r)));
        } catch (e) {
          if (!cancelled) setRows((rs) => rs.map((r) => (r.id === d.id ? { ...r, error: userMessage(e, tr("dashboard.reformat_load_failed")) } : r)));
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designs]);

  // Sizes are typed in the unit; each design keeps its own resolution.
  const size = (doc: DesignFile) => {
    const dpi = doc.dpi ?? 96;
    const pw = parseLength(w, unit, dpi, 0);
    const ph = parseLength(h, unit, dpi, 0);
    return pw !== null && ph !== null && pw >= 1 && ph >= 1 ? { width: pw, height: ph } : null;
  };
  const valid = parseLength(w, unit, 96, 0) !== null && parseLength(h, unit, 96, 0) !== null && (parseLength(w, unit, 96, 0) ?? 0) >= 1 && (parseLength(h, unit, 96, 0) ?? 0) >= 1;
  const changeUnit = (u: MeasureUnit) => {
    const pw = parseLength(w, unit, 96, 0);
    const ph = parseLength(h, unit, 96, 0);
    if (pw !== null) setW(unitInputText(pw, u, 96));
    if (ph !== null) setH(unitInputText(ph, u, 96));
    setUnit(u);
  };

  const previews = useMemo(() => {
    const out = new Map<string, DesignFile>();
    if (!valid) return out;
    for (const r of rows) {
      const s = r.doc && size(r.doc);
      if (r.doc && s) out.set(r.id, reformatDesign(r.doc, { ...s, fit, turn, measureUnit: unit }));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, w, h, unit, fit, turn, valid]);

  // A turn onto a page of the design's own shape (a landscape label turned
  // onto a landscape page) leaves the turned content the wrong shape for the
  // page: it shrinks, is rebuilt or sticks out. Labels that run sideways want
  // the size after the turn, so the dialog offers to swap the sides.
  const firstPage = rows.find((r) => r.doc)?.doc?.pages[0];
  const tw = parseLength(w, unit, 96, 0), th = parseLength(h, unit, 96, 0);
  const sameShape = turn !== 0 && !!firstPage && tw !== null && th !== null && tw !== th && firstPage.width !== firstPage.height
    && (tw > th) === (firstPage.width > firstPage.height);

  const ready = rows.filter((r) => previews.has(r.id));
  const loading = rows.some((r) => !r.doc && !r.error);

  async function apply() {
    setRunning(true);
    const label = tr("dashboard.reformat_version_label", { size: `${w} × ${h} ${unit}` });
    let ok = 0;
    for (const r of ready) {
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, state: "saving" } : x)));
      try {
        await rewriteDesign(r.id, previews.get(r.id)!, label);
        ok++;
        setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, state: "done" } : x)));
      } catch (e) {
        setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, state: "failed", error: userMessage(e, tr("dashboard.reformat_save_failed")) } : x)));
      }
    }
    setRunning(false);
    setFinished(true);
    onDone();
    if (ok === ready.length) toast.success(tr("dashboard.reformat_done", { count: ok }));
    else toast.error(tr("dashboard.reformat_partial", { ok, count: ready.length }));
  }

  const fits: { id: ReformatFit; label: string; desc: string }[] = [
    { id: "scale", label: tr("dashboard.reformat_fit_scale"), desc: tr("dashboard.reformat_fit_scale_desc") },
    { id: "relayout", label: tr("dashboard.reformat_fit_relayout"), desc: tr("dashboard.reformat_fit_relayout_desc") },
    { id: "none", label: tr("dashboard.reformat_fit_none"), desc: tr("dashboard.reformat_fit_none_desc") },
  ];
  const turns: { id: ReformatTurn; label: string }[] = [
    { id: 0, label: tr("dashboard.reformat_turn_none") },
    { id: -90, label: tr("dashboard.reformat_turn_left") },
    { id: 90, label: tr("dashboard.reformat_turn_right") },
  ];
  const locked = running || finished;

  return (
    <Modal open onClose={running ? () => {} : onClose} title={tr("dashboard.reformat_title")} width="w-[44rem] max-w-full">
      <div className="flex max-h-[75vh] flex-col gap-4 overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pe-1">
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">{tr("dashboard.reformat_size")}</h3>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Input label={tr("dashboard.width")} inputMode="decimal" className="w-full" value={w} disabled={locked} onChange={(e) => setW(e.target.value)} />
              </div>
              <span className="pb-3 text-neutral-400">×</span>
              <div className="min-w-0 flex-1">
                <Input label={tr("dashboard.height")} inputMode="decimal" className="w-full" value={h} disabled={locked} onChange={(e) => setH(e.target.value)} />
              </div>
              <select
                aria-label={tr("editor.measure_unit")}
                value={unit}
                disabled={locked}
                onChange={(e) => changeUnit(e.target.value as MeasureUnit)}
                className="mb-0.5 h-10 shrink-0 rounded-lg border border-neutral-200 bg-surface px-2 text-sm outline-none focus:border-brand-400"
              >
                {MEASURE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-neutral-500">{tr("dashboard.reformat_size_hint")}</p>
          </section>

          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">{tr("dashboard.reformat_turn")}</h3>
            <div role="radiogroup" aria-label={tr("dashboard.reformat_turn")} className="flex gap-1 rounded-lg bg-neutral-100 p-0.5">
              {turns.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={turn === t.id}
                  disabled={locked}
                  onClick={() => setTurn(t.id)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition ${turn === t.id ? "bg-surface text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}
                >
                  {t.id === -90 && <RotateCcw size={12} />}
                  {t.id === 90 && <RotateCw size={12} />}
                  {t.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-neutral-500">{tr("dashboard.reformat_turn_hint")}</p>
            {sameShape && (
              <div className="mt-1.5 flex items-start gap-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-800">
                <span className="min-w-0 flex-1">{tr("dashboard.reformat_turn_same_shape")}</span>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => { setW(h); setH(w); }}
                  className="shrink-0 rounded-md bg-amber-600 px-2.5 py-1 font-medium text-white hover:bg-amber-700 disabled:opacity-50 dark:hover:bg-amber-500"
                >
                  {tr("dashboard.reformat_swap_sides")}
                </button>
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">{tr("dashboard.reformat_fit")}</h3>
            <div role="radiogroup" aria-label={tr("dashboard.reformat_fit")} className="flex flex-col gap-1.5">
              {fits.map((f) => (
                <label key={f.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 transition ${fit === f.id ? "border-brand-400 bg-brand-50" : "border-neutral-200 hover:bg-neutral-50"}`}>
                  <input type="radio" name="reformat-fit" checked={fit === f.id} disabled={locked} onChange={() => setFit(f.id)} className="mt-0.5 h-3.5 w-3.5 accent-brand-500" />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-neutral-700">{f.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-neutral-500">{f.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">{tr("dashboard.reformat_preview")}</h3>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {rows.map((r) => {
                const p = previews.get(r.id);
                return (
                  <li key={r.id} className="min-w-0">
                    <div className="relative aspect-square overflow-hidden rounded-lg border border-neutral-200">
                      {p ? <DesignThumb key={`${r.id}-${w}-${h}-${unit}-${fit}-${turn}`} file={p} /> : (
                        <div className="grid h-full w-full place-items-center bg-neutral-100 text-neutral-400">
                          {r.error ? <X size={16} className="text-red-500" /> : <Loader2 size={16} className="animate-spin" />}
                        </div>
                      )}
                      {r.state && (
                        <span className={`absolute end-1 top-1 grid h-5 w-5 place-items-center rounded-full shadow ${r.state === "failed" ? "bg-red-500 text-white" : r.state === "done" ? "bg-brand-500 text-white" : "bg-surface text-neutral-600"}`}>
                          {r.state === "saving" ? <Loader2 size={12} className="animate-spin" /> : r.state === "done" ? <Check size={12} /> : <X size={12} />}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-[11px] text-neutral-600" title={r.error ? `${r.title}: ${r.error}` : r.title}>{r.title}</p>
                  </li>
                );
              })}
            </ul>
          </section>

          <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-800">{tr("dashboard.reformat_warning")}</p>
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-100 pt-3">
          {finished ? (
            <Button onClick={onClose}>{tr("dashboard.reformat_close")}</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={onClose} disabled={running}>{tr("dashboard.cancel")}</Button>
              <Button onClick={() => void apply()} disabled={running || loading || !ready.length}>
                {running ? <Loader2 size={14} className="animate-spin" /> : null}
                {tr("dashboard.reformat_apply", { count: ready.length })}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
