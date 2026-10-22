// Serial print (F46): fill the open design from a data file (CSV, a text
// file, Excel, or pasted cells), one copy per row, and hand the result to the
// download menu (one PDF, also several on a sheet) or the print dialog.
// Texts fill through {{Column}} placeholders or a column of their own;
// barcodes are encoded again per row, and a row with a code that cannot be
// encoded is left out and listed.

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FileSpreadsheet, Printer, FileDown, Type, Barcode, QrCode, AlertTriangle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useEditor } from "@/store/editor";
import { renderPageCanvas } from "@/lib/exportFormats";
import { userMessage } from "@/lib/errors";
import { tr } from "@/lib/i18n";
import { resolvedLocale } from "@/lib/locale";
import { useBrand } from "@/store/brand";
import { autoMap, mergeRows, mergeTargets, missingColumns, readDataFile, readDataText, tableOf, MAX_SERIAL_ROWS, type DataSheet, type MergeResult, type TargetKind } from "@/lib/serialPrint";
import { ExportDialog } from "./ExportDialog";
import { PrintDialog } from "./PrintDialog";

const field = "h-8 w-full min-w-0 rounded-lg border border-neutral-200 bg-surface px-2 text-xs text-neutral-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";
const kindIcon: Record<TargetKind, typeof Type> = { text: Type, barcode: Barcode, qr: QrCode };

export function SerialPrintDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const doc = useEditor((s) => s.doc);
  const designId = useBrand((s) => s.designId);
  const [sheets, setSheets] = useState<DataSheet[] | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState(true);
  const [pasted, setPasted] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [previewRow, setPreviewRow] = useState(1);
  const [preview, setPreview] = useState<{ url: string; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MergeResult | null>(null);
  const [output, setOutput] = useState<"pdf" | "print" | null>(null);

  const targets = useMemo(() => mergeTargets(doc), [doc]);
  const table = useMemo(() => (sheets?.[sheetIndex] ? tableOf(sheets[sheetIndex].matrix, headerRow, (n) => tr("editor.serial_column_n", { n })) : null), [sheets, sheetIndex, headerRow]);
  const rowCount = table?.rows.length ?? 0;
  const from = Math.min(Math.max(1, range?.from ?? 1), Math.max(1, rowCount));
  const to = Math.min(Math.max(from, range?.to ?? rowCount), rowCount);

  // A new table maps its columns by name.
  const [seenTable, setSeenTable] = useState<typeof table>(null);
  if (table !== seenTable) {
    setSeenTable(table);
    setMapping(table ? autoMap(targets, table.headers) : {});
    setRange(null);
    setPreviewRow(1);
    setResult(null);
  }

  // The preview: the chosen row filled into the first page.
  useEffect(() => {
    if (!open || !table || !rowCount) return;
    let cancelled = false;
    const row = Math.min(previewRow, rowCount);
    void mergeRows(doc, table, mapping, { from: row, to: row }).then((r) => {
      if (cancelled) return;
      if (!r.rows) { setPreview({ url: "", error: r.skipped[0]?.reason }); return; }
      const page = r.doc.pages[0];
      const scale = Math.min(1, 280 / Math.max(page.width, page.height));
      const canvas = renderPageCanvas(r.doc, 0, scale, true);
      setPreview({ url: canvas ? canvas.toDataURL("image/png") : "" });
    });
    return () => { cancelled = true; };
  }, [open, doc, table, mapping, previewRow, rowCount]);

  if (!open) return null;

  async function pickFile(file: File) {
    setBusy(true);
    try {
      const s = await readDataFile(file, resolvedLocale());
      setSheets(s);
      setSheetIndex(0);
    } catch (e) {
      toast.error(userMessage(e, tr("editor.serial_read_failed")));
    } finally {
      setBusy(false);
    }
  }

  async function build(kind: "pdf" | "print") {
    if (!table) return;
    setBusy(true);
    try {
      const r = await mergeRows(doc, table, mapping, { from, to });
      setResult(r);
      if (!r.rows) { toast.error(tr("editor.serial_nothing")); return; }
      setOutput(kind);
    } catch (e) {
      toast.error(userMessage(e, tr("editor.serial_failed")));
    } finally {
      setBusy(false);
    }
  }

  const missing = table ? missingColumns(targets, table.headers) : [];
  const filled = targets.filter((t) => t.placeholders.length || mapping[t.id]);
  const merged = result?.doc ? { ...result.doc, title: tr("editor.serial_title_of", { title: doc.title || tr("editor.untitled") }) } : null;

  return (
    <>
      <Modal open onClose={busy ? () => {} : onClose} title={tr("editor.serial_title")} width="w-[44rem] max-w-full">
        <div className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto pe-1">
          <p className="text-xs text-neutral-500">{tr("editor.serial_intro")}</p>

          {/* 1. The data. */}
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-neutral-700">{tr("editor.serial_step_data")}</h3>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50">
                <FileSpreadsheet size={14} /> {tr("editor.serial_choose_file")}
                <input type="file" accept=".csv,.txt,.tsv,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickFile(f); e.target.value = ""; }} />
              </label>
              <span className="text-[11px] text-neutral-400">{tr("editor.serial_file_types")}</span>
            </div>
            <details>
              <summary className="cursor-pointer text-[11px] text-neutral-500">{tr("editor.serial_paste")}</summary>
              <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={4} placeholder={tr("editor.serial_paste_placeholder")} className="mt-1.5 w-full rounded-lg border border-neutral-200 bg-surface p-2 font-mono text-[11px] outline-none focus:border-brand-400" />
              <Button size="sm" variant="secondary" disabled={!pasted.trim()} onClick={() => { setSheets([readDataText(pasted)]); setSheetIndex(0); }}>{tr("editor.serial_use_pasted")}</Button>
            </details>
            {sheets && sheets.length > 1 && (
              <label className="flex flex-col gap-1 text-[11px] text-neutral-500">
                {tr("editor.serial_sheet")}
                <select value={sheetIndex} onChange={(e) => setSheetIndex(Number(e.target.value))} className={field}>
                  {sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
                </select>
              </label>
            )}
            {sheets && (
              <label className="flex items-center gap-2 text-xs text-neutral-600">
                <input type="checkbox" checked={headerRow} onChange={(e) => setHeaderRow(e.target.checked)} className="h-3.5 w-3.5 accent-brand-600" />
                {tr("editor.serial_header_row")}
              </label>
            )}
            {table && <p className="text-[11px] text-neutral-500">{tr("editor.serial_table_size", { rows: rowCount, columns: table.headers.length })}</p>}
            {rowCount > MAX_SERIAL_ROWS && <p className="text-[11px] font-medium text-amber-700">{tr("editor.serial_too_many", { max: MAX_SERIAL_ROWS })}</p>}
          </section>

          {/* 2. What fills what. */}
          {table && (
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-neutral-700">{tr("editor.serial_step_fields")}</h3>
              <p className="text-[11px] text-neutral-500">{tr("editor.serial_fields_hint", { example: `{{${tr("editor.serial_example_column")}}}` })}</p>
              {targets.length === 0 && <p className="text-[11px] text-neutral-400">{tr("editor.serial_no_fields")}</p>}
              <ul className="flex flex-col divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                {targets.map((t) => {
                  const Icon = kindIcon[t.kind];
                  return (
                    <li key={t.id} className="flex items-center gap-2 px-2.5 py-1.5">
                      <Icon size={14} className="shrink-0 text-neutral-400" />
                      <span className="min-w-0 flex-1 truncate text-xs text-neutral-700" title={t.label}>
                        {t.label}
                        {doc.pages.length > 1 && <span className="ms-1 text-[10px] text-neutral-400">{tr("editor.serial_page_n", { n: t.page + 1 })}</span>}
                      </span>
                      {t.placeholders.length ? (
                        <span className="shrink-0 text-[11px] text-neutral-500">{tr("editor.serial_placeholders", { names: t.placeholders.join(", ") })}</span>
                      ) : (
                        <select aria-label={tr("editor.serial_column_for", { name: t.label })} value={mapping[t.id] ?? ""} onChange={(e) => setMapping((m) => { const n = { ...m }; if (e.target.value) n[t.id] = e.target.value; else delete n[t.id]; return n; })} className={`${field} w-44 shrink-0`}>
                          <option value="">{tr("editor.serial_keep")}</option>
                          {table.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                        </select>
                      )}
                    </li>
                  );
                })}
              </ul>
              {missing.length > 0 && <p className="text-[11px] font-medium text-amber-700">{tr("editor.serial_missing_columns", { names: missing.join(", ") })}</p>}
            </section>
          )}

          {/* 3. Rows and a preview. */}
          {table && rowCount > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-neutral-700">{tr("editor.serial_step_rows")}</h3>
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
                {tr("editor.serial_rows_from")}
                <input type="number" min={1} max={rowCount} value={from} onChange={(e) => setRange({ from: Number(e.target.value) || 1, to })} className={`${field} w-20`} />
                {tr("editor.serial_rows_to")}
                <input type="number" min={from} max={rowCount} value={to} onChange={(e) => setRange({ from, to: Number(e.target.value) || from })} className={`${field} w-20`} />
                <span className="text-[11px] text-neutral-400">{tr("editor.serial_rows_of", { count: rowCount })}</span>
              </div>
              <div className="flex items-start gap-3">
                <div className="light flex h-[180px] w-[280px] shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a rendered preview (data URL) */}
                  {preview?.url ? <img src={preview.url} alt={tr("editor.serial_preview_alt", { n: previewRow })} className="max-h-full max-w-full" /> : preview?.error ? <p className="p-3 text-center text-[11px] text-red-600">{preview.error}</p> : null}
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] text-neutral-500">{tr("editor.serial_preview_row", { n: Math.min(previewRow, rowCount), count: rowCount })}</span>
                  <div className="flex gap-1">
                    <Button size="sm" variant="secondary" disabled={previewRow <= 1} onClick={() => setPreviewRow((r) => Math.max(1, r - 1))} aria-label={tr("editor.serial_previous")}><ChevronLeft size={14} /></Button>
                    <Button size="sm" variant="secondary" disabled={previewRow >= rowCount} onClick={() => setPreviewRow((r) => Math.min(rowCount, r + 1))} aria-label={tr("editor.serial_next")}><ChevronRight size={14} /></Button>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* 4. The result. */}
          {result && result.skipped.length > 0 && (
            <section className="flex flex-col gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
              <p className="flex items-center gap-1.5 text-xs font-medium text-amber-800"><AlertTriangle size={14} /> {tr("editor.serial_skipped", { count: result.skipped.length })}</p>
              <ul className="max-h-32 overflow-y-auto text-[11px] text-amber-900">
                {result.skipped.slice(0, 200).map((s) => <li key={s.row}>{tr("editor.serial_skipped_row", { row: s.row, element: s.element, reason: s.reason })}</li>)}
              </ul>
            </section>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-neutral-100 pt-3">
            {filled.length > 0 && table && <span className="me-auto text-[11px] text-neutral-500">{tr("editor.serial_will_make", { count: Math.max(0, to - from + 1), pages: doc.pages.length })}</span>}
            <Button variant="secondary" onClick={onClose} disabled={busy}>{tr("editor.cancel")}</Button>
            <Button variant="secondary" disabled={busy || !table || !rowCount || !filled.length} onClick={() => void build("print")}><Printer size={14} /> {tr("editor.serial_print")}</Button>
            <Button disabled={busy || !table || !rowCount || !filled.length} onClick={() => void build("pdf")}><FileDown size={14} /> {tr("editor.serial_download")}</Button>
          </div>
        </div>
      </Modal>
      {output === "pdf" && merged && <ExportDialog open onClose={() => setOutput(null)} designs={[{ id: designId ?? "serial", doc: merged }]} />}
      {output === "print" && merged && <PrintDialog open onClose={() => setOutput(null)} designs={[{ id: designId ?? "serial", doc: merged }]} />}
    </>
  );
}
