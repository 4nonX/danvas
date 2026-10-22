// Print (native path). Renders the pages at a print-grade resolution into a
// hidden print frame and opens the operating-system print dialog, which
// handles printer choice, copies, page range and "Save as PDF". The pages are
// drawn the way the download menu draws them (lib/exportFormats), bleed and
// crop marks included when asked for.
//
// Works on the design open in the editor, or on designs picked in the
// dashboard (every page of each, one print job). Print presets (kind "print"
// export profiles) store the dialog's settings, personal or per workspace.
// The previous print-on-demand ordering wizard was removed: it could not
// complete an order. A print-shop file is available via Download.

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import type { DesignFile, Node } from "@hc/schema";
import { useEditor } from "@/store/editor";
import { useBrand } from "@/store/brand";
import { useToast } from "@/components/ui/Toast";
import { renderPageCanvas } from "@/lib/exportFormats";
import { initialPrintOverride, printSheet, pxToMm, withPrintOverride, type PrintOverride } from "@/lib/print/sheet";
import { cappedPrintDpi, describePrintSettings, normalizePrintSettings, paperLabel, PRINT_DPIS, printDpiLabel, printScale, samePrintSettings, type PrintSettings } from "@/lib/printPresets";
import { oversizedPages, paperSizeMm, PRINT_PAPERS, printHtml, type PrintPage } from "@/lib/printDocument";
import { ImposeFields } from "./ImposeFields";
import { usePrintClearance } from "@/lib/printApproval";
import { BleedInput, MarkInputs } from "./PrintSettings";
import { ProfileBar } from "./ProfileBar";
import { issueText, type ExportTarget } from "./ExportDialog";
import { exportIssues, type ExportIssue } from "@/lib/exportIssues";
import { barcodeOf } from "@/lib/barcode";
import { tr } from "@/lib/i18n";

type Job = { doc: DesignFile; pages: number[] };

/** Each page's design and sheet as printed: with the fixed bleed and marks,
 *  or its own. */
function sheets(jobs: Job[], s: PrintSettings, override: PrintOverride) {
  const fixed = s.print.source === "fixed";
  const parts = fixed ? { bleed: override.bleed, marks: override.marks } : { bleed: s.print.source === "page" && s.print.bleed, marks: s.print.source === "page" && s.print.marks };
  return jobs.flatMap((job) => {
    const doc = fixed ? withPrintOverride(job.doc, override) : job.doc;
    const dpi = doc.dpi ?? 96;
    return job.pages.filter((i) => doc.pages[i]).map((i) => {
      const sheet = printSheet(doc.pages[i], dpi, parts);
      return { doc, index: i, parts, dpi, sheet, widthMm: pxToMm(sheet.sheetWidth, dpi), heightMm: pxToMm(sheet.sheetHeight, dpi) };
    });
  });
}

/** Whether the pages go several to a sheet of the paper (F45). */
const imposing = (s: PrintSettings) => s.impose.on && s.paper !== "design";

/** Render every page as an image of its print sheet, or the imposed sheets. */
async function renderPages(list: ReturnType<typeof sheets>, s: PrintSettings): Promise<PrintPage[]> {
  const out: PrintPage[] = [];
  if (imposing(s) && s.paper !== "design") {
    const { imposeCanvases } = await import("@/lib/print/imposeRaster");
    // One imposition per design (a sheet never mixes designs).
    const byDoc = new Map<DesignFile, { pages: number[]; bleed: boolean }>();
    for (const p of list) {
      const e = byDoc.get(p.doc) ?? { pages: [], bleed: p.parts.bleed };
      e.pages.push(p.index);
      byDoc.set(p.doc, e);
    }
    for (const [doc, e] of byDoc) {
      for (const sh of imposeCanvases(doc, e.pages, s.impose, paperSizeMm(s.paper), s.dpi, e.bleed)) {
        const blob: Blob | null = await new Promise((res) => sh.canvas.toBlob(res, "image/png"));
        if (blob) out.push({ url: URL.createObjectURL(blob), widthMm: sh.widthMm, heightMm: sh.heightMm });
      }
    }
    return out;
  }
  for (const p of list) {
    const scale = printScale(p.sheet.sheetWidth, p.sheet.sheetHeight, p.dpi, s.dpi);
    const canvas = renderPageCanvas(p.doc, p.index, scale, true, p.parts);
    if (!canvas) continue;
    // A tainted canvas (an image from another site) throws here.
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/png"));
    if (!blob) continue;
    out.push({ url: URL.createObjectURL(blob), widthMm: p.widthMm, heightMm: p.heightMm });
  }
  return out;
}

/** Open the system print dialog for `pages` through a hidden frame. */
async function openPrint(pages: PrintPage[], s: PrintSettings, title: string): Promise<void> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(iframe);
  const cw = iframe.contentWindow;
  const cd = iframe.contentDocument;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    for (const p of pages) URL.revokeObjectURL(p.url);
    try { document.body.removeChild(iframe); } catch { /* already gone */ }
  };
  if (!cw || !cd) { cleanup(); throw new Error("no print frame"); }
  cw.onafterprint = cleanup;
  cd.open();
  // An imposed sheet is the paper itself: always at actual size.
  cd.write(printHtml(pages, { size: imposing(s) ? "actual" : s.size, paper: s.paper, title }));
  cd.close();
  // Print only once every page image is decoded, or pages come out blank.
  await Promise.all(Array.from(cd.images).map((img) => img.decode().catch(() => undefined)));
  cw.focus();
  cw.print();
  // Fallback cleanup for browsers that never fire onafterprint.
  setTimeout(cleanup, 60000);
}

/** The printer resolution the designs' barcodes are set up for (the first
 *  one found), or null. */
function barcodePrinterDpi(docs: DesignFile[]): number | null {
  const find = (nodes: Node[]): number | null => {
    for (const n of nodes) {
      const d = barcodeOf(n)?.printerDpi;
      if (d) return d;
      const kids = (n as unknown as { children?: Node[] }).children;
      if (Array.isArray(kids)) { const k = find(kids); if (k) return k; }
    }
    return null;
  };
  for (const doc of docs) for (const p of doc.pages) { const d = find(p.children); if (d) return d; }
  return null;
}

/** Barcodes the chosen resolution draws with too few pixels per module (or
 *  that may not scan for another reason), listed under the resolution. */
function BarcodePrintCheck({ jobs, dpi }: { jobs: Job[]; dpi: number }) {
  const rev = useEditor((s) => s.rev);
  const [issues, setIssues] = useState<ExportIssue[]>([]);
  const key = jobs.map((j) => j.pages.join(",")).join("|");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const out: ExportIssue[] = [];
      for (const j of jobs) out.push(...(await exportIssues(j.doc, j.pages, { vector: false, rasterDpi: dpi })).filter((i) => i.kind.startsWith("barcode-")));
      if (!cancelled) setIssues(out);
    })();
    return () => { cancelled = true; };
    // `jobs` is rebuilt every render; its pages and the editor revision say when it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, dpi, rev]);
  if (!issues.length) return null;
  return (
    <ul className="mt-1.5 flex flex-col gap-1 text-[11px] font-medium text-amber-700">
      {issues.map((i) => <li key={`${i.kind}|${i.subject}`}>{issueText(i)}</li>)}
    </ul>
  );
}

export function PrintDialog({ open, onClose, designs, workspaceId: workspaceIdProp, onRequestApproval }: { open: boolean; onClose: () => void; designs?: ExportTarget[]; workspaceId?: string | null; onRequestApproval?: () => void }): React.ReactElement | null {
  const toast = useToast();
  const editorDoc = useEditor((s) => s.doc);
  const activePage = useEditor((s) => s.activePage);
  useEditor((s) => s.rev); // re-read the live doc on edits
  const brandWorkspaceId = useBrand((s) => s.workspaceId);
  const editorFolderId = useBrand((s) => s.folderId);
  const workspaceId = workspaceIdProp ?? brandWorkspaceId;
  // Printing waits for the designs' approval when the workspace says so (F47).
  const brandDesignId = useBrand((s) => s.designId);
  const approvalIds = designs ? designs.map((d) => d.id) : brandDesignId ? [brandDesignId] : [];
  const clearance = usePrintClearance(open, workspaceId, approvalIds);
  const [settings, setSettings] = useState<PrintSettings>(() => normalizePrintSettings({}));
  const [override, setOverride] = useState<PrintOverride>(() => initialPrintOverride((designs ?? [{ doc: editorDoc }]).map((d) => d.doc)));
  const [busy, setBusy] = useState(false);
  // Barcodes set up for one printer resolution print best at exactly that
  // resolution: it is chosen when the dialog opens (a preset may change it).
  const [seenOpen, setSeenOpen] = useState(false);
  if (open !== seenOpen) {
    setSeenOpen(open);
    const d = open ? barcodePrinterDpi(designs ? designs.map((x) => x.doc) : [editorDoc]) : null;
    if (d !== null && (PRINT_DPIS as readonly number[]).includes(d)) setSettings((s) => ({ ...s, dpi: d as PrintSettings["dpi"] }));
  }

  if (!open) return null;

  const doc = designs?.[0]?.doc ?? editorDoc;
  const pageCount = doc.pages.length;
  // What a preset stores: the fixed bleed and marks live in `override`.
  const current: PrintSettings = settings.print.source === "fixed" ? { ...settings, print: { source: "fixed", override } } : settings;
  const set = (patch: Partial<PrintSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const apply = (s: PrintSettings) => {
    setSettings(s);
    if (s.print.source === "fixed") setOverride(s.print.override);
  };

  const jobs = designs
    ? designs.map((d) => ({ doc: d.doc, pages: d.doc.pages.map((_, i) => i) }))
    : [{ doc, pages: settings.pages === "current" || pageCount <= 1 ? [Math.min(activePage, pageCount - 1)] : doc.pages.map((_, i) => i) }];
  const sheetList = sheets(jobs, current, override);
  const sheetCount = sheetList.length;
  const tooBig = oversizedPages(sheetList, settings.paper, settings.size);
  const barcodeDpi = barcodePrinterDpi(jobs.map((j) => j.doc));
  const cappedDpi = cappedPrintDpi(sheetList.map((p) => ({ sheetWidth: p.sheet.sheetWidth, sheetHeight: p.sheet.sheetHeight, docDpi: p.dpi })), settings.dpi);

  async function go() {
    setBusy(true);
    try {
      const pages = await renderPages(sheetList, current);
      if (!pages.length) throw new Error("nothing to print");
      await openPrint(pages, current, designs && designs.length > 1 ? tr("editor.print_n_designs", { count: designs.length }) : (doc.title || tr("editor.untitled")));
      onClose();
    } catch {
      toast.error(tr("editor.couldnt_prepare_the_print_an_external_image"));
    } finally {
      setBusy(false);
    }
  }

  const seg = (on: boolean) => `flex-1 rounded-lg py-1.5 text-xs font-medium transition ${on ? "bg-brand-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`;
  const row = "flex cursor-pointer items-center justify-between gap-3 text-xs text-neutral-700";
  const box = "h-4 w-4 shrink-0 accent-brand-600";
  const fixed = settings.print.source === "fixed";
  const pagePrint = settings.print.source === "page" ? settings.print : { bleed: false, marks: false };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30" onClick={onClose}>
      <div role="dialog" aria-label={tr("editor.print")} className="max-h-[calc(100vh-2rem)] w-[22rem] overflow-y-auto rounded-2xl bg-surface p-5 shadow-2xl ring-1 ring-black/5" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-neutral-900">
          <Printer size={18} className="text-neutral-500" /> {tr("editor.print")}
        </h2>
        <p className="mb-3 text-[12px] text-neutral-500">
          {designs && designs.length > 1 ? tr("editor.print_n_designs_all_pages", { count: designs.length }) : tr("editor.print_system_dialog_hint")}
        </p>

        <ProfileBar
          kind="print"
          open={open}
          workspaceId={workspaceId}
          folderIds={designs ? designs.map((d) => d.folderId ?? null) : [editorFolderId]}
          current={current}
          normalize={normalizePrintSettings}
          same={samePrintSettings}
          describe={describePrintSettings}
          onApply={apply}
        />

        {!designs && pageCount > 1 && (
          <div className="mb-3">
            <span className="mb-1.5 block text-xs font-medium text-neutral-500">{tr("editor.pages")}</span>
            <div className="flex gap-1">
              <button type="button" onClick={() => set({ pages: "all" })} className={seg(settings.pages === "all")}>{tr("editor.print_all_pages", { count: pageCount })}</button>
              <button type="button" onClick={() => set({ pages: "current" })} className={seg(settings.pages === "current")}>{tr("editor.current_page")}</button>
            </div>
            <p className="mt-1.5 text-[11px] text-neutral-400">{tr("editor.you_can_also_pick_a_page_range_in_the_print")}</p>
          </div>
        )}

        <div className="mb-3">
          <label htmlFor="print-paper" className="mb-1.5 block text-xs font-medium text-neutral-500">{tr("editor.print_paper")}</label>
          <select id="print-paper" value={settings.paper} onChange={(e) => set({ paper: e.target.value as PrintSettings["paper"] })} className="h-8 w-full rounded-lg border border-neutral-200 bg-surface px-2 text-xs text-neutral-800 outline-none focus:border-brand-400">
            {PRINT_PAPERS.map((p) => <option key={p} value={p}>{paperLabel(p)}</option>)}
          </select>
          <p className="mt-1.5 text-[11px] text-neutral-400">{settings.paper === "design" ? tr("editor.print_paper_design_hint") : tr("editor.print_paper_sheet_hint")}</p>
        </div>

        <div className="mb-3">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">{tr("editor.print_size")}</span>
          <div className="flex gap-1">
            <button type="button" onClick={() => set({ size: "actual" })} className={seg(settings.size === "actual")}>{tr("editor.print_size_actual")}</button>
            <button type="button" onClick={() => set({ size: "fit" })} className={seg(settings.size === "fit")}>{tr("editor.print_size_fit")}</button>
          </div>
          <p className="mt-1.5 text-[11px] text-neutral-400">{settings.size === "actual" ? tr("editor.print_size_actual_hint") : tr("editor.print_size_fit_hint")}</p>
          {tooBig > 0 && <p className="mt-1.5 text-[11px] font-medium text-amber-700">{tr("editor.print_too_big_for_paper", { count: tooBig, paper: paperLabel(settings.paper) })}</p>}
        </div>

        <div className="mb-3">
          <label htmlFor="print-dpi" className="mb-1.5 block text-xs font-medium text-neutral-500">{tr("editor.print_resolution")}</label>
          <select id="print-dpi" value={settings.dpi} onChange={(e) => set({ dpi: Number(e.target.value) as PrintSettings["dpi"] })} className="h-8 w-full rounded-lg border border-neutral-200 bg-surface px-2 text-xs text-neutral-800 outline-none focus:border-brand-400">
            {PRINT_DPIS.map((d) => <option key={d} value={d}>{printDpiLabel(d)}</option>)}
          </select>
          {barcodeDpi !== null && barcodeDpi !== settings.dpi && (
            <p className="mt-1.5 text-[11px] font-medium text-amber-700">{tr("editor.print_barcode_dpi", { dpi: barcodeDpi })}</p>
          )}
          {cappedDpi !== null && <p className="mt-1.5 text-[11px] font-medium text-amber-700">{tr("editor.print_resolution_capped", { dpi: cappedDpi, chosen: settings.dpi })}</p>}
          <BarcodePrintCheck jobs={jobs} dpi={cappedDpi ?? settings.dpi} />
        </div>

        {settings.paper !== "design" && (
          <ImposeFields
            value={settings.impose}
            onChange={(impose) => set({ impose })}
            sheetMm={paperSizeMm(settings.paper)}
            page={sheetList[0] ? { widthMm: pxToMm(sheetList[0].sheet.width, sheetList[0].dpi), heightMm: pxToMm(sheetList[0].sheet.height, sheetList[0].dpi), bleedMm: pxToMm(sheetList[0].sheet.bleed, sheetList[0].dpi) } : null}
            pageCount={sheetList.length}
            chooseSheet={false}
          />
        )}

        <div className="mb-4 flex flex-col gap-2 rounded-lg border border-neutral-200 p-2.5">
          <span className="text-xs font-medium text-neutral-700">{tr("editor.print_sheet_include")}</span>
          <div role="radiogroup" aria-label={tr("editor.print_source")} className="flex gap-1 rounded-lg bg-neutral-100 p-0.5">
            {(["page", "fixed"] as const).map((src) => (
              <button
                key={src}
                type="button"
                role="radio"
                aria-checked={settings.print.source === src}
                onClick={() => set({ print: src === "fixed" ? { source: "fixed", override } : { source: "page", bleed: pagePrint.bleed, marks: pagePrint.marks } })}
                className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${settings.print.source === src ? "bg-surface text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}
              >
                {src === "page" ? (designs ? tr("editor.print_source_designs") : tr("editor.print_source_pages")) : tr("editor.print_source_fixed")}
              </button>
            ))}
          </div>
          {fixed ? (
            <>
              <label className={row}>
                <span>{tr("editor.bleed")}</span>
                <input type="checkbox" checked={override.bleed} onChange={(e) => setOverride((o) => ({ ...o, bleed: e.target.checked }))} className={box} />
              </label>
              {override.bleed && <BleedInput mm={override.bleedMm} onChange={(v) => setOverride((o) => ({ ...o, bleedMm: v }))} />}
              <label className={row}>
                <span>{tr("editor.print_sheet_crop_marks")}</span>
                <input type="checkbox" checked={override.marks} onChange={(e) => setOverride((o) => ({ ...o, marks: e.target.checked }))} className={box} />
              </label>
              {override.marks && <MarkInputs marks={override} onChange={(patch) => setOverride((o) => ({ ...o, ...patch }))} />}
              <p className="text-[11px] leading-snug text-neutral-400">{designs ? tr("editor.print_sheet_designs_hint") : tr("editor.print_source_fixed_hint")}</p>
            </>
          ) : (
            <>
              <label className={row}>
                <span>{tr("editor.bleed")}</span>
                <input type="checkbox" checked={pagePrint.bleed} onChange={(e) => set({ print: { source: "page", bleed: e.target.checked, marks: pagePrint.marks } })} className={box} />
              </label>
              <label className={row}>
                <span>{tr("editor.print_sheet_crop_marks")}</span>
                <input type="checkbox" checked={pagePrint.marks} onChange={(e) => set({ print: { source: "page", bleed: pagePrint.bleed, marks: e.target.checked } })} className={box} />
              </label>
              <p className="text-[11px] leading-snug text-neutral-400">{designs ? tr("editor.print_source_page_designs_hint") : tr("editor.print_source_page_hint")}</p>
            </>
          )}
        </div>

        {/* What the browser hands the printer driver, and what to check there. */}
        <p className="mb-3 rounded-lg bg-neutral-50 p-2 text-[11px] leading-snug text-neutral-500">{tr("editor.print_driver_hint")}</p>

        {clearance.blocked && (
          <div className="mb-3 flex flex-col gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
            <span>{designs && designs.length > 1 ? tr("editor.print_approval_needed_n", { count: clearance.waiting }) : tr("editor.print_approval_needed")}</span>
            {onRequestApproval && (
              <button type="button" onClick={() => { onClose(); onRequestApproval(); }} className="self-start rounded-md bg-amber-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-amber-700">
                {tr("editor.request_approval")}
              </button>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-[11px] text-neutral-400">{tr("editor.print_n_sheets", { count: sheetCount })}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-neutral-600 hover:bg-neutral-100">{tr("editor.cancel")}</button>
            <button onClick={() => void go()} disabled={busy || clearance.blocked} className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              <Printer size={15} /> {busy ? tr("editor.preparing") : tr("editor.print")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
