// The output check: the file the download menu would make, separated on the
// instance by Ghostscript (as a print shop's RIP does) and read back for its
// structure. Shows the real plates (process and spot), a soft proof built
// from them through the chosen profile, the total ink coverage against the
// limit, and a preflight checklist. Unlike the proof view, nothing here is
// estimated from the screen: overprint, black on the black plate and spot
// colours are as in the file.

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, X, XCircle } from "lucide-react";
import type { OutputCheckPage, OutputCheckResult } from "@hc/sdk";
import { oc } from "@/lib/sdk";
import type { RenderingIntent } from "@/lib/print/cms";
import { profileBytes } from "@/lib/print/profiles";
import { checkPrintFile, type FileExpectation, type FileFinding } from "@/lib/print/fileCheck";
import { highlight } from "@/lib/print/proof";
import { CodedError, userMessage } from "@/lib/errors";
import { tr } from "@/lib/i18n";

const PROCESS = ["Cyan", "Magenta", "Yellow", "Black"];

/** Poll the separation job (seconds to a few minutes). */
async function waitFor(jobId: string, signal: AbortSignal): Promise<OutputCheckResult> {
  const started = Date.now();
  let wait = 500;
  while (Date.now() - started < 5 * 60 * 1000) {
    // i18n-ignore: DOMException name, matched by callers, never shown to anyone.
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    const job = await oc.getJob<OutputCheckResult>(jobId, signal);
    if (job.status === "completed" && job.result) return job.result;
    if (job.status === "failed" && job.error === "output_check_unsupported") throw new CodedError("editor.output_check_unsupported", job.error);
    if (job.status === "failed") throw new CodedError("editor.output_check_failed", job.error ?? "failed");
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(2000, Math.round(wait * 1.4));
  }
  throw new CodedError("editor.output_check_failed", "timed out");
}

async function grey(url: string): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  return { data: ctx.getImageData(0, 0, c.width, c.height).data, width: c.width, height: c.height };
}

export interface OutputCheckViewProps {
  open: boolean;
  onClose: () => void;
  /** Makes the file exactly as the download would. */
  build: () => Promise<Blob>;
  expect: FileExpectation;
  tacLimit: number;
  profileId: string;
  intent: RenderingIntent;
}

type Mode = "proof" | "tac" | string; // or a plate name

export function OutputCheckView({ open, onClose, build, expect, tacLimit, profileId, intent }: OutputCheckViewProps) {
  const [result, setResult] = useState<OutputCheckResult | null>(null);
  const [findings, setFindings] = useState<FileFinding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<"build" | "separate">("build");
  const [pageIdx, setPageIdx] = useState(0);
  const [mode, setMode] = useState<Mode>("proof");
  const [proof, setProof] = useState<{ page: number; width: number; height: number; rgba: Uint8ClampedArray } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Make the file, then separate it on the server and read its structure.
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    void (async () => {
      try {
        setResult(null); setFindings(null); setError(null); setStage("build");
        const blob = await build();
        if (abort.signal.aborted) return;
        setStage("separate");
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const [found, sep] = await Promise.all([
          checkPrintFile(bytes, expect),
          oc.startOutputCheck(blob, tacLimit).then((r) => waitFor(r.jobId, abort.signal)),
        ]);
        if (abort.signal.aborted) return;
        setFindings(found);
        setResult(sep);
      } catch (e) {
        if (!abort.signal.aborted) setError(userMessage(e, tr("editor.output_check_failed")));
      }
    })();
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per opening; build/expect describe that opening
  }, [open]);

  const page: OutputCheckPage | null = result?.pages[pageIdx] ?? null;

  // The soft proof of the real plates, through the chosen profile.
  useEffect(() => {
    if (!page) return;
    let cancelled = false;
    void (async () => {
      try {
        const plates = await Promise.all(PROCESS.map((n) => page.plates.find((p) => p.name === n)).map((p) => (p ? grey(p.png) : null)));
        const first = plates.find(Boolean);
        if (!first) return;
        const n = first.width * first.height;
        const cmyk = new Uint8Array(n * 4);
        plates.forEach((pl, k) => {
          if (!pl) return;
          for (let i = 0; i < n; i++) cmyk[i * 4 + k] = 255 - pl.data[i * 4];
        });
        const { createCmykConverter } = await import("@/lib/print/cms");
        const conv = await createCmykConverter(await profileBytes(profileId), intent);
        try {
          if (!cancelled) setProof({ page: page.page, width: first.width, height: first.height, rgba: conv.proof(cmyk, n, false) });
        } finally {
          conv.dispose();
        }
      } catch { /* the plates still show */ }
    })();
    return () => { cancelled = true; };
  }, [page, profileId, intent]);

  // Draw the chosen view.
  const plate = page?.plates.find((p) => p.name === mode) ?? null;
  const [overMask, setOverMask] = useState<{ page: number; mask: Uint8Array } | null>(null);
  useEffect(() => {
    if (!page || mode !== "tac") return;
    let cancelled = false;
    void grey(page.over).then((o) => {
      if (cancelled) return;
      const mask = new Uint8Array(o.width * o.height);
      for (let i = 0; i < mask.length; i++) mask[i] = o.data[i * 4 + 3] > 0 ? 1 : 0;
      setOverMask({ page: page.page, mask });
    });
    return () => { cancelled = true; };
  }, [page, mode]);
  const tacImage = useMemo(() => (proof && overMask && proof.page === overMask.page && mode === "tac" ? highlight(proof.rgba, overMask.mask, [230, 30, 40]) : null), [proof, overMask, mode]);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !proof || plate) return;
    const data = mode === "tac" ? tacImage : proof.rgba;
    if (!data) return;
    c.width = proof.width;
    c.height = proof.height;
    c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(data), proof.width, proof.height), 0, 0);
  }, [proof, plate, mode, tacImage]);

  if (!open) return null;

  const icon = (f: FileFinding) => (f.level === "ok" ? <CheckCircle2 size={14} className="shrink-0 text-green-600" /> : f.level === "warning" ? <AlertTriangle size={14} className="shrink-0 text-amber-600" /> : <XCircle size={14} className="shrink-0 text-red-600" />);
  const btn = (on: boolean) => `rounded-md px-2 py-1 text-xs font-medium transition ${on ? "bg-brand-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`;

  return (
    <div className="fixed inset-0 z-[60] flex bg-black/50 p-3 sm:p-6" onClick={onClose}>
      <div role="dialog" aria-label={tr("editor.output_check_title")} className="flex min-h-0 w-full flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-black/5 lg:flex-row" onClick={(e) => e.stopPropagation()}>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-neutral-200 p-4">
          {error ? (
            <p className="max-w-md text-center text-sm text-red-600">{error}</p>
          ) : !result || !page ? (
            <p className="text-sm text-neutral-500">{stage === "build" ? tr("editor.output_check_building") : tr("editor.output_check_separating")}</p>
          ) : plate ? (
            // eslint-disable-next-line @next/next/no-img-element -- a data URL from the check, not an optimizable asset
            <img src={plate.png} alt={plate.name} className="max-h-full max-w-full bg-white shadow-md" />
          ) : (
            <canvas ref={canvasRef} className="max-h-full max-w-full bg-white shadow-md" />
          )}
        </div>
        <aside className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-t border-neutral-200 p-4 text-xs lg:w-80 lg:border-s lg:border-t-0">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">{tr("editor.output_check_title")}</h2>
            <button type="button" onClick={onClose} aria-label={tr("editor.close")} className="grid h-7 w-7 place-items-center rounded-lg text-neutral-500 hover:bg-neutral-100"><X size={16} /></button>
          </div>
          <p className="text-[11px] leading-snug text-neutral-500">{tr("editor.output_check_intro")}</p>
          <p className="text-[11px] leading-snug text-neutral-500">{tr("editor.output_check_scope")}</p>

          {findings && (
            <ul className="flex flex-col gap-1 rounded-lg border border-neutral-200 p-2.5">
              {findings.map((f, i) => (
                <li key={i} className="flex items-start gap-1.5 text-neutral-700">{icon(f)}<span>{outputFindingText(f)}</span></li>
              ))}
            </ul>
          )}

          {result && page && (
            <>
              {result.pages.length > 1 && (
                <label className="flex items-center justify-between gap-2">
                  <span className="text-neutral-600">{tr("editor.pages")}</span>
                  <select value={pageIdx} onChange={(e) => { setPageIdx(Number(e.target.value)); setProof(null); }} className="h-7 rounded-md border border-neutral-200 bg-surface px-1.5">
                    {result.pages.map((p, i) => <option key={p.page} value={i}>{p.page}</option>)}
                  </select>
                </label>
              )}
              {result.truncated && <p className="text-[11px] text-amber-700">{tr("editor.output_check_truncated", { count: result.pages.length })}</p>}
              <div className="flex flex-wrap gap-1">
                <button type="button" aria-pressed={mode === "proof"} onClick={() => setMode("proof")} className={btn(mode === "proof")}>{tr("editor.proof_softproof")}</button>
                {page.plates.map((p) => (
                  <button key={p.name} type="button" aria-pressed={mode === p.name} onClick={() => setMode(p.name)} className={btn(mode === p.name)}>{p.name}</button>
                ))}
                <button type="button" aria-pressed={mode === "tac"} onClick={() => setMode("tac")} className={btn(mode === "tac")}>{tr("editor.proof_tac")}</button>
              </div>
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-lg border border-neutral-200 p-2.5">
                <dt className="text-neutral-600">{tr("editor.output_check_sheet")}</dt>
                <dd className="text-end tabular-nums text-neutral-800">{page.widthMm.toLocaleString()} × {page.heightMm.toLocaleString()} mm</dd>
                {page.plates.map((p) => (
                  <PlateRow key={p.name} name={p.name} pct={p.coveragePct} />
                ))}
                <dt className="text-neutral-600">{tr("editor.proof_tac_max")}</dt>
                <dd className={`text-end font-semibold tabular-nums ${page.tacMaxPct > result.tacLimit ? "text-red-600" : "text-neutral-800"}`}>{page.tacMaxPct} %</dd>
                <dt className="text-neutral-600">{tr("editor.proof_tac_limit")}</dt>
                <dd className="text-end tabular-nums text-neutral-800">{result.tacLimit} %</dd>
                <dt className="text-neutral-600">{tr("editor.proof_tac_over")}</dt>
                <dd className={`text-end tabular-nums ${page.tacOverPct > 0 ? "font-semibold text-red-600" : "text-neutral-800"}`}>{page.tacOverPct.toLocaleString()} %</dd>
              </dl>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function PlateRow({ name, pct }: { name: string; pct: number }) {
  return (
    <>
      <dt className="text-neutral-600">{tr("editor.output_check_plate", { name })}</dt>
      <dd className="text-end tabular-nums text-neutral-800">{pct.toLocaleString()} %</dd>
    </>
  );
}

/** A finding as text. */
export function outputFindingText(f: FileFinding): string {
  const p = f.params ?? {};
  switch (f.code) {
    case "cmyk_only": return tr("editor.output_cmyk_only");
    case "rgb_in_cmyk": return tr("editor.output_rgb_in_cmyk");
    case "output_intent": return tr("editor.output_output_intent");
    case "no_output_intent": return tr("editor.output_no_output_intent");
    case "pdfx": return tr("editor.output_pdfx");
    case "pdfx_missing": return tr("editor.output_pdfx_missing");
    case "boxes": return tr("editor.output_boxes");
    case "boxes_missing": return tr("editor.output_boxes_missing");
    case "eps_bbox": return tr("editor.output_eps_bbox");
    case "eps_no_bbox": return tr("editor.output_eps_no_bbox");
    case "eps_no_process": return tr("editor.output_eps_no_process");
    case "spot": return tr("editor.output_spot", { name: String(p.name) });
    case "spot_missing": return tr("editor.output_spot_missing", { name: String(p.name) });
    case "spot_unexpected": return tr("editor.output_spot_unexpected", { names: String(p.names) });
    default: return f.code;
  }
}
