// Canva-style "Position" panel (left side panel, opened from the context
// toolbar): "Arrange" = layer order and alignment of the current selection,
// "Layers" = the regular layer list. Only existing store actions are used, so
// it behaves exactly like the matching controls in the properties panel.

import { useState } from "react";
import {
  AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd, AlignHorizontalJustifyStart,
  AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart,
  ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, FlipHorizontal2, FlipVertical2,
} from "lucide-react";
import { useEditor } from "@/store/editor";
import { LayerPanel } from "./LayerPanel";
import { tr } from "@/lib/i18n";

export function PositionPanel() {
  const selection = useEditor((s) => s.selection);
  const [tab, setTab] = useState<"arrange" | "layers">("arrange");
  const st = useEditor.getState();
  const none = selection.length === 0;
  const tabCls = (on: boolean) =>
    `flex-1 border-b-2 px-2 py-2 text-sm font-medium transition ${
      on ? "border-brand-500 text-brand-ink" : "border-transparent text-neutral-500 hover:text-neutral-700"
    }`;
  const btn =
    "flex items-center gap-2 rounded-lg bg-neutral-100 px-3 py-2 text-start text-xs font-medium text-neutral-700 transition hover:bg-neutral-200 disabled:opacity-40 disabled:hover:bg-neutral-100";
  const heading = "mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-400";

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 border-b border-neutral-200">
        <button type="button" onClick={() => setTab("arrange")} className={tabCls(tab === "arrange")}>{tr("editor.arrange")}</button>
        <button type="button" onClick={() => setTab("layers")} className={tabCls(tab === "layers")}>{tr("editor.layers")}</button>
      </div>
      {tab === "layers" ? (
        <div className="min-h-0 flex-1"><LayerPanel /></div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <div className={heading}>{tr("editor.layers")}</div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={none} className={btn} onClick={() => st.orderSelection("forward")}><ArrowUp size={15} />{tr("editor.bring_forward")}</button>
            <button type="button" disabled={none} className={btn} onClick={() => st.orderSelection("backward")}><ArrowDown size={15} />{tr("editor.send_backward")}</button>
            <button type="button" disabled={none} className={btn} onClick={() => st.orderSelection("front")}><ArrowUpToLine size={15} />{tr("editor.bring_to_front")}</button>
            <button type="button" disabled={none} className={btn} onClick={() => st.orderSelection("back")}><ArrowDownToLine size={15} />{tr("editor.send_to_back")}</button>
          </div>
          <div className={heading}>{tr("editor.align")}</div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={none} className={btn} onClick={() => st.alignSelection("top")}><AlignVerticalJustifyStart size={15} />{tr("editor.align_top")}</button>
            <button type="button" disabled={none} className={btn} onClick={() => st.alignSelection("left")}><AlignHorizontalJustifyStart size={15} />{tr("editor.align_left")}</button>
            <button type="button" disabled={none} className={btn} onClick={() => st.alignSelection("vmiddle")}><AlignVerticalJustifyCenter size={15} />{tr("editor.align_middle")}</button>
            <button type="button" disabled={none} className={btn} onClick={() => st.alignSelection("hcenter")}><AlignHorizontalJustifyCenter size={15} />{tr("editor.align_center")}</button>
            <button type="button" disabled={none} className={btn} onClick={() => st.alignSelection("bottom")}><AlignVerticalJustifyEnd size={15} />{tr("editor.align_bottom")}</button>
            <button type="button" disabled={none} className={btn} onClick={() => st.alignSelection("right")}><AlignHorizontalJustifyEnd size={15} />{tr("editor.align_right")}</button>
          </div>
          <div className={heading}>{tr("editor.flip")}</div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={none} className={btn} onClick={() => st.flipSelection("h")}><FlipHorizontal2 size={15} />{tr("editor.flip_horizontal")}</button>
            <button type="button" disabled={none} className={btn} onClick={() => st.flipSelection("v")}><FlipVertical2 size={15} />{tr("editor.flip_vertical")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
