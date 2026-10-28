// The proof view of the download menu: the page as it will print, through
// the chosen ICC profile and rendering intent. Soft proof (optionally with
// the paper's own white), each process plate, the spot colour plate (die
// line), the total ink coverage against the print shop's limit, and colours
// the press cannot reach, with the ink under the pointer. Computed from the
// render the export itself draws; the output check examines the real file.

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type { DesignFile } from "@hc/schema";
import type { PrintParts } from "@/lib/print/sheet";
import type { CmykConverter, RenderingIntent } from "@/lib/print/cms";
import { profileBytes } from "@/lib/print/profiles";
import { gamutMask, highlight, inkAt, maskPlate, plateImage, PLATES, tacStats, type Plate } from "@/lib/print/proof";
import { dieLineTint, renderProof } from "@/lib/print/proofRender";
import { tr } from "@/lib/i18n";

type Mode = "proof" | Plate | "spot" | "tac" | "gamut";

/** Longest side of the preview, device pixels. */
const MAX_SIDE = 1600;

interface Computed {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  cmyk: Uint8Array;
  proof: Uint8ClampedArray;
  paper: Uint8ClampedArray;
  tac: ReturnType<typeof tacStats>;
  gamut: Uint8Array;
  gamutPct: number;
  spot: Uint8ClampedArray | null;
}

export interface ProofViewProps {
  open: boolean;
  onClose: () => void;
  /** The design as exported (a fixed bleed and marks already applied). */
  doc: DesignFile;
  pages: number[];
  parts: PrintParts;
  profileId: string;
  profileName: string;
  intent: RenderingIntent;
  /** The vector files' rule: pure black on the black plate alone. */
  blackOnly: boolean;
  tacLimit: number;
  dieLine?: { name: string; radiusMm: number };
}

export function ProofView({ open, onClose, doc, pages, parts, profileId, profileName, intent, blackOnly, tacLimit, dieLine }: ProofViewProps) {
  const [page, setPage] = useState(pages[0] ?? 0);
  const [mode, setMode] = useState<Mode>("proof");
  const [paperWhite, setPaperWhite] = useState(false);
  const [tinted, setTinted] = useState(true);
  const [data, setData] = useState<Computed | null>(null);
  const [error, setError] = useState(false);
  const [ink, setInk] = useState<ReturnType<typeof inkAt> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Render, convert and analyse the page (once per page and setting).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let conv: CmykConverter | null = null;
    void (async () => {
      try {
        setData(null);
        setError(false);
        if (!doc.pages[page]) return;
        const { createCmykConverter } = await import("@/lib/print/cms");
        conv = await createCmykConverter(await profileBytes(profileId), intent);
        const r = await renderProof(doc, page, parts, conv, { blackOnly, dieLine, maxSide: MAX_SIDE });
        const { width, height, rgba, cmyk } = r;
        const n = width * height;
        const proof = conv.proof(cmyk, n, false);
        const paper = conv.proof(cmyk, n, true);
        const gamut = gamutMask(rgba, proof);
        let outside = 0, inked = 0;
        for (let i = 0; i < n; i++) {
          if (gamut[i]) outside++;
          if (rgba[i * 4 + 3] > 0 && (rgba[i * 4] < 250 || rgba[i * 4 + 1] < 250 || rgba[i * 4 + 2] < 250)) inked++;
        }
        // Shown in the colour the die line's spot is defined as.
        const spot = r.dieMask ? maskPlate(r.dieMask, dieLineTint()) : null;
        if (cancelled) return;
        setData({ width, height, rgba, cmyk, proof, paper, tac: tacStats(cmyk, tacLimit), gamut, gamutPct: inked ? Math.round((outside / inked) * 1000) / 10 : 0, spot });
      } catch {
        if (!cancelled) setError(true);
      } finally {
        conv?.dispose();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- parts/dieLine by value, below
  }, [open, doc, page, parts.bleed, parts.marks, profileId, intent, blackOnly, tacLimit, dieLine?.name, dieLine?.radiusMm]);

  // The picture of the chosen mode.
  const image = useMemo(() => {
    if (!data) return null;
    switch (mode) {
      case "proof": return paperWhite ? data.paper : data.proof;
      case "tac": return highlight(data.proof, data.tac.over, [230, 30, 40]);
      case "gamut": return highlight(data.proof, data.gamut, [20, 200, 90]);
      case "spot": return data.spot;
      default: return plateImage(data.cmyk, mode, tinted);
    }
  }, [data, mode, paperWhite, tinted]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !data || !image) return;
    c.width = data.width;
    c.height = data.height;
    c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image), data.width, data.height), 0, 0);
  }, [data, image]);

  if (!open) return null;

  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!data) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * data.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * data.height);
    if (x < 0 || y < 0 || x >= data.width || y >= data.height) { setInk(null); return; }
    setInk(inkAt(data.cmyk, y * data.width + x));
  }

  const modes: { id: Mode; label: string }[] = [
    { id: "proof", label: tr("editor.proof_softproof") },
    ...PLATES.map((p) => ({ id: p as Mode, label: { c: tr("editor.proof_cyan"), m: tr("editor.proof_magenta"), y: tr("editor.proof_yellow"), k: tr("editor.proof_black") }[p] })),
    ...(dieLine ? [{ id: "spot" as Mode, label: dieLine.name }] : []),
    { id: "tac", label: tr("editor.proof_tac") },
    { id: "gamut", label: tr("editor.proof_gamut") },
  ];
  const btn = (on: boolean) => `rounded-md px-2 py-1 text-xs font-medium transition ${on ? "bg-brand-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`;

  return (
    <div className="fixed inset-0 z-[60] flex bg-black/50 p-3 sm:p-6" onClick={onClose}>
      <div role="dialog" aria-label={tr("editor.proof_title")} className="flex min-h-0 w-full flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-black/5 lg:flex-row" onClick={(e) => e.stopPropagation()}>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-neutral-200 p-4">
          {error ? (
            <p className="text-sm text-red-600">{tr("editor.proof_failed")}</p>
          ) : !data ? (
            <p className="text-sm text-neutral-500">{tr("editor.preparing")}</p>
          ) : (
            <canvas ref={canvasRef} onMouseMove={onMove} onMouseLeave={() => setInk(null)} className="max-h-full max-w-full bg-white shadow-md" style={{ imageRendering: "auto" }} />
          )}
        </div>
        <aside className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-t border-neutral-200 p-4 text-xs lg:w-72 lg:border-s lg:border-t-0">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">{tr("editor.proof_title")}</h2>
            <button type="button" onClick={onClose} aria-label={tr("editor.close")} className="grid h-7 w-7 place-items-center rounded-lg text-neutral-500 hover:bg-neutral-100"><X size={16} /></button>
          </div>
          <p className="text-[11px] text-neutral-500">{profileName} · {intent === "perceptual" ? tr("editor.intent_perceptual") : tr("editor.intent_relative")}</p>

          {pages.length > 1 && (
            <label className="flex items-center justify-between gap-2">
              <span className="text-neutral-600">{tr("editor.pages")}</span>
              <select value={page} onChange={(e) => setPage(Number(e.target.value))} className="h-7 rounded-md border border-neutral-200 bg-surface px-1.5">
                {pages.map((p) => <option key={p} value={p}>{p + 1}</option>)}
              </select>
            </label>
          )}

          <div className="flex flex-wrap gap-1">
            {modes.map((m) => <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => setMode(m.id)} className={btn(mode === m.id)}>{m.label}</button>)}
          </div>
          {mode === "proof" && (
            <label className="flex cursor-pointer items-center justify-between gap-2 text-neutral-600">
              {tr("editor.proof_paper_white")}
              <input type="checkbox" checked={paperWhite} onChange={(e) => setPaperWhite(e.target.checked)} className="h-4 w-4 accent-brand-600" />
            </label>
          )}
          {(PLATES as readonly string[]).includes(mode) && (
            <label className="flex cursor-pointer items-center justify-between gap-2 text-neutral-600">
              {tr("editor.proof_tinted")}
              <input type="checkbox" checked={tinted} onChange={(e) => setTinted(e.target.checked)} className="h-4 w-4 accent-brand-600" />
            </label>
          )}

          <div className="rounded-lg border border-neutral-200 p-2.5">
            <div className="mb-1 font-medium text-neutral-700">{tr("editor.proof_ink_here")}</div>
            {ink ? (
              <div className="font-mono text-[11px] text-neutral-700">
                C {ink.c} · M {ink.m} · Y {ink.y} · K {ink.k} = <span className={ink.total > tacLimit ? "font-semibold text-red-600" : ""}>{ink.total} %</span>
              </div>
            ) : <div className="text-[11px] text-neutral-400">{tr("editor.proof_point_at_page")}</div>}
          </div>

          {data && (
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-lg border border-neutral-200 p-2.5">
              <dt className="text-neutral-600">{tr("editor.proof_tac_max")}</dt>
              <dd className={`text-end font-semibold tabular-nums ${data.tac.maxPct > tacLimit ? "text-red-600" : "text-neutral-800"}`}>{data.tac.maxPct} %</dd>
              <dt className="text-neutral-600">{tr("editor.proof_tac_limit")}</dt>
              <dd className="text-end tabular-nums text-neutral-800">{tacLimit} %</dd>
              <dt className="text-neutral-600">{tr("editor.proof_tac_over")}</dt>
              <dd className={`text-end tabular-nums ${data.tac.overPct > 0 ? "font-semibold text-red-600" : "text-neutral-800"}`}>{data.tac.overPct.toLocaleString()} %</dd>
              <dt className="text-neutral-600">{tr("editor.proof_gamut_share")}</dt>
              <dd className="text-end tabular-nums text-neutral-800">{data.gamutPct.toLocaleString()} %</dd>
            </dl>
          )}
          <p className="text-[11px] leading-snug text-neutral-400">{tr("editor.proof_note")}</p>
        </aside>
      </div>
    </div>
  );
}
