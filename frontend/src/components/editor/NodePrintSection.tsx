// Print roles of the selected elements in the properties panel: overprint
// (the element prints over what is under it), die line (a cut contour, never
// printed), and a die line made around the selection's silhouette at a set
// offset, with or without its cut-outs (lib/print/dieContour).

import { useState } from "react";
import type { Node } from "@hc/schema";
import { locate } from "@hc/editor";
import { useEditor } from "@/store/editor";
import { useToast } from "@/components/ui/Toast";
import { isDieLine, isOverprint } from "@/lib/print/nodePrint";
import { tr } from "@/lib/i18n";
import { CollapsibleSection } from "./EditorPanels";
import { NumField } from "./PrintSettings";

/** Panel order: after appearance, before interactivity. */
const ORDER = 6.5;

export function NodePrintSection() {
  useEditor((s) => s.rev);
  const selection = useEditor((s) => s.selection);
  const toast = useToast();
  const [offsetMm, setOffsetMm] = useState(2);
  const [holes, setHoles] = useState(false);
  const [busy, setBusy] = useState(false);
  const doc = useEditor.getState().doc;
  const nodes = selection.map((id) => locate(doc, id)?.node as Node | undefined).filter((n): n is Node => !!n);
  if (!nodes.length) return null;
  const allDie = nodes.every(isDieLine);
  const anyDie = nodes.some(isDieLine);
  const overprint = nodes.every(isOverprint);
  const ids = nodes.map((n) => n.id);
  const row = "flex cursor-pointer items-start justify-between gap-3 text-xs text-neutral-700";
  const box = "mt-0.5 h-4 w-4 shrink-0 accent-brand-600";

  function makeDieLine() {
    setBusy(true);
    // A frame later: the button shows it is working while the silhouette
    // is drawn and traced.
    requestAnimationFrame(() => {
      try {
        const grid = useEditor.getState().dieLineFromSelection({ offsetMm, holes });
        if (grid === null) toast.error(tr("editor.die_line_nothing"));
        else toast.success(tr("editor.die_line_made", { mm: (Math.round(grid * 1000) / 1000).toLocaleString() }));
      } finally {
        setBusy(false);
      }
    });
  }

  return (
    <CollapsibleSection title={tr("editor.node_print")} order={ORDER} defaultOpen={anyDie || nodes.some(isOverprint)}>
      <div className="flex flex-col gap-2.5">
        {!anyDie && (
          <label className={row}>
            <span>
              {tr("editor.overprint")}
              <span className="mt-0.5 block text-[11px] leading-snug text-neutral-400">{tr("editor.overprint_desc")}</span>
            </span>
            <input type="checkbox" checked={overprint} onChange={(e) => useEditor.getState().setPrintRole(ids, { overprint: e.target.checked })} className={box} />
          </label>
        )}
        <label className={row}>
          <span>
            {tr("editor.as_die_line")}
            <span className="mt-0.5 block text-[11px] leading-snug text-neutral-400">{tr("editor.as_die_line_desc")}</span>
          </span>
          <input type="checkbox" checked={allDie} onChange={(e) => useEditor.getState().setPrintRole(ids, { dieLine: e.target.checked, ...(e.target.checked ? { overprint: false } : {}) })} className={box} />
        </label>
        {!anyDie && (
          <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-2.5">
            <span className="text-xs font-medium text-neutral-700">{tr("editor.die_line_make")}</span>
            <span className="text-[11px] leading-snug text-neutral-400">{tr("editor.die_line_make_desc")}</span>
            <NumField label={tr("editor.die_line_offset_mm")} value={offsetMm} onCommit={(n) => setOffsetMm(Math.max(-10, Math.min(20, n)))} />
            <label className="flex cursor-pointer items-center justify-between gap-3 text-xs text-neutral-700">
              <span>{tr("editor.die_line_holes")}</span>
              <input type="checkbox" checked={holes} onChange={(e) => setHoles(e.target.checked)} className="h-4 w-4 shrink-0 accent-brand-600" />
            </label>
            <button type="button" disabled={busy} onClick={makeDieLine} className="rounded-lg bg-brand-600 px-2 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50">
              {busy ? tr("editor.preparing") : tr("editor.die_line_make_button")}
            </button>
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
