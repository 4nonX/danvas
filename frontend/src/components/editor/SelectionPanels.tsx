// Focused left side panels for the current selection, opened from the context
// toolbar: Effects (text effects + the node effect stack), Animation,
// image editing (filters, adjustments, background removal) and Vectorize. Each renders the
// same section component the properties panel uses, so both surfaces edit the
// document identically; the properties panel stays the place for everything
// else.

import { useEffect, useRef, useState } from "react";
import type { Node } from "@hc/schema";
import { locate } from "@hc/editor";
import { useEditor } from "@/store/editor";
import { tr } from "@/lib/i18n";
import { imageAssets } from "@/lib/assetProvider";
import { vectorizeImageNode, type VectorizeResult } from "@/lib/vectorize";
import { contourToPathData } from "@/lib/vectorize/trace";
import { AnimateSection, ImageEffectsSection, NodeEffects, TextEffectPicker } from "./PropertiesPanel";

/** The single selected node, or null for no or several selected nodes. */
function useSingleNode(): Node | null {
  useEditor((s) => s.rev);
  const selection = useEditor((s) => s.selection);
  if (selection.length !== 1) return null;
  return (locate(useEditor.getState().doc, selection[0])?.node as Node | undefined) ?? null;
}

function Hint({ text }: { text: string }) {
  return <p className="px-1 py-6 text-center text-xs text-neutral-400">{text}</p>;
}

export function EffectsPanel() {
  const node = useSingleNode();
  if (!node) return <Hint text={tr("editor.select_an_element_first")} />;
  return (
    <div className="flex flex-col gap-4">
      {node.type === "text" && (
        <div className="flex flex-col gap-2">
          <TextEffectPicker id={node.id} node={node} />
        </div>
      )}
      <NodeEffects id={node.id} effects={node.effects} />
    </div>
  );
}

export function AnimationPanel() {
  const node = useSingleNode();
  if (!node) return <Hint text={tr("editor.select_an_element_first")} />;
  return <AnimateSection key={node.id} node={node} open />;
}

export function ImageEditPanel({ workspaceId }: { workspaceId: string | null }) {
  const node = useSingleNode();
  if (!node || node.type !== "image") return <Hint text={tr("editor.select_a_single_image_first")} />;
  return <ImageEffectsSection key={node.id} id={node.id} node={node} workspaceId={workspaceId} />;
}

const COLOR_STEPS: (number | "auto")[] = ["auto", 1, 2, 3, 4, 6, 8];

/** Trace the selected image into editable vector layers (lib/vectorize):
 *  live preview, colour count, detail, background removal, then replace. */
export function VectorizePanel() {
  const node = useSingleNode();
  const [colors, setColors] = useState<number | "auto">("auto");
  const [detail, setDetail] = useState(0.6);
  const [removeBg, setRemoveBg] = useState(false);
  const [enhance, setEnhance] = useState(true);
  const [state, setState] = useState<{ key: string; result: VectorizeResult | null; error?: string; progress: number }>({ key: "", result: null, progress: 0 });
  const [view, setView] = useState<"vector" | "original">("vector");
  const runId = useRef(0);

  const isImage = node?.type === "image";
  const key = isImage && node ? `${node.id}|${colors}|${detail}|${removeBg}|${enhance}` : "";
  useEffect(() => {
    if (!isImage || !node) return;
    const id = ++runId.current;
    const t = setTimeout(() => {
      setState((s) => ({ ...s, key, progress: 0.01 }));
      void vectorizeImageNode(useEditor.getState().doc, node, { colors, detail, removeBackground: removeBg, enhance }, (p) => {
        if (runId.current === id) setState((s) => ({ ...s, progress: Math.max(0.01, p) }));
      })
        .then((result) => { if (runId.current === id) setState({ key, result, progress: 1 }); })
        .catch((e: unknown) => { if (runId.current === id) setState({ key, result: null, progress: 1, error: e instanceof Error ? e.message : String(e) }); });
    }, 250);
    return () => clearTimeout(t);
    // Re-trace when the options (or the selected image) change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!node || !isImage) return <Hint text={tr("editor.select_a_single_image_first")} />;
  const busy = state.key !== key || state.progress < 1;
  const result = state.key === key ? state.result : null;
  const traced = result?.kind === "traced" ? result : null;
  const stats = traced
    ? {
      colors: traced.layers.length,
      paths: traced.layers.reduce((n, l) => n + l.contours.length, 0),
      anchors: traced.layers.reduce((n, l) => n + l.contours.reduce((m, c) => m + c.length, 0), 0),
    }
    : null;
  const lightResult = !!traced && traced.layers.length > 0 && traced.layers.every((l) => 0.2126 * l.color[0] + 0.7152 * l.color[1] + 0.0722 * l.color[2] > 200);
  const assetId = (node as unknown as { source?: { assetId?: string } }).source?.assetId;
  const srcUrl = assetId ? imageAssets.url(assetId) : null;
  const seg = (on: boolean) => `h-7 flex-1 rounded-md text-xs font-medium transition ${on ? "bg-brand-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`;
  const tab = (on: boolean) => `h-7 flex-1 rounded-md text-xs font-medium transition ${on ? "bg-surface text-neutral-800 shadow-sm" : "text-neutral-500 hover:text-neutral-700"}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 rounded-lg bg-neutral-100 p-0.5">
        <button type="button" className={tab(view === "vector")} onClick={() => setView("vector")}>{tr("editor.vector")}</button>
        <button type="button" className={tab(view === "original")} onClick={() => setView("original")}>{tr("editor.original")}</button>
      </div>
      <div
        className="relative grid aspect-square w-full place-items-center overflow-hidden rounded-xl border border-neutral-200"
        style={{
          // Light artwork (a white logo) is shown on a dark checkerboard.
          backgroundImage: lightResult
            ? "conic-gradient(#3f3f46 25%, #52525b 0 50%, #3f3f46 0 75%, #52525b 0)"
            : "conic-gradient(#e5e7eb 25%, #fff 0 50%, #e5e7eb 0 75%, #fff 0)",
          backgroundSize: "16px 16px",
        }}
      >
        {(view === "original" || result?.kind === "svg") && srcUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={srcUrl} alt="" className="max-h-full max-w-full object-contain" />
        ) : traced ? (
          <svg viewBox={`0 0 ${traced.width} ${traced.height}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
            {traced.layers.map((l, i) => (
              <path key={i} fillRule="evenodd" fill={`rgb(${l.color.join(",")})`} d={l.contours.map((c) => contourToPathData(c)).join("")} />
            ))}
          </svg>
        ) : null}
        {busy && (
          <div className="absolute inset-x-3 bottom-3 h-1.5 overflow-hidden rounded-full bg-white/80">
            <div className="h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${Math.round(state.progress * 100)}%` }} />
          </div>
        )}
      </div>
      {state.error && state.key === key && <p className="text-xs text-red-600">{state.error}</p>}
      {stats && !busy && <p className="text-[11px] text-neutral-500">{tr("editor.vectorize_stats", stats)}</p>}
      {result?.kind === "svg" && !busy && (
        <p className="rounded-lg bg-emerald-50 px-2.5 py-2 text-[11px] leading-snug text-emerald-800">{tr("editor.vectorize_svg_exact")}</p>
      )}
      {traced?.enhanceSkip === "unavailable" && !busy && (
        <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-800">{tr("editor.enhance_unavailable")}</p>
      )}
      {traced?.photoLike && !busy && (
        <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-800">{tr("editor.vectorize_photo_warning")}</p>
      )}

      {result?.kind !== "svg" && (<>
      <div>
        <div className="mb-1.5 text-xs font-medium text-neutral-600">{tr("editor.colors")}</div>
        <div className="flex gap-1">
          {COLOR_STEPS.map((c) => (
            <button key={String(c)} type="button" className={seg(colors === c)} onClick={() => setColors(c)}>{c === "auto" ? tr("editor.auto") : c}</button>
          ))}
        </div>
      </div>
      <label className="block">
        <div className="mb-1.5 flex justify-between text-xs font-medium text-neutral-600">
          <span>{tr("editor.detail")}</span>
          <span className="tabular-nums text-neutral-400">{Math.round(detail * 100)}%</span>
        </div>
        <input type="range" min={0} max={1} step={0.05} value={detail} onChange={(e) => setDetail(Number(e.target.value))} className="w-full accent-brand-600" />
        <div className="mt-0.5 flex justify-between text-[10px] text-neutral-400"><span>{tr("editor.smoother")}</span><span>{tr("editor.more_detail")}</span></div>
      </label>
      <div>
        <label className="flex cursor-pointer items-center justify-between text-sm text-neutral-700">
          <span>{tr("editor.enhance_before_tracing")}</span>
          <input type="checkbox" checked={enhance} onChange={(e) => setEnhance(e.target.checked)} className="h-4 w-4 accent-brand-600" />
        </label>
        <p className="mt-0.5 text-[11px] leading-snug text-neutral-400">
          {traced?.enhanceSkip === "large" && !busy ? tr("editor.enhance_not_needed") : tr("editor.enhance_hint")}
        </p>
      </div>
      <label className="flex cursor-pointer items-center justify-between text-sm text-neutral-700">
        <span>{tr("editor.remove_background_color")}</span>
        <input type="checkbox" checked={removeBg} onChange={(e) => setRemoveBg(e.target.checked)} className="h-4 w-4 accent-brand-600" />
      </label>
      </>)}
      <button
        type="button"
        disabled={busy || !result || (result.kind === "traced" && !result.layers.length)}
        onClick={() => {
          if (!result) return;
          if (result.kind === "svg") useEditor.getState().replaceImageWithNodes(node.id, result.nodes);
          else useEditor.getState().replaceImageWithVectors(node.id, result.layers);
        }}
        className="h-9 rounded-lg bg-brand-600 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-40"
      >
        {tr("editor.convert_to_vector")}
      </button>
      <p className="text-[11px] leading-snug text-neutral-400">{tr("editor.vectorize_hint")}</p>
    </div>
  );
}
