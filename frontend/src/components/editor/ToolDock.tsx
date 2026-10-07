// Creation tools (select, text, shapes, lines, drawing, comment) as a compact
// dock. Related tools share one slot with a small flyout that opens upward; the
// slot shows the tool last used from its group. Inline in the bottom bar of a
// design (PagesBar); floating at the bottom of the canvas for other document
// kinds that have no bottom bar.

import { useEffect, useRef, useState } from "react";
import { ChevronUp, Circle, MessageSquarePlus, Minus, MousePointer2, MoveUpRight, Pencil, PenTool, Square, Type } from "lucide-react";
import { useEditor } from "@/store/editor";
import { useComments } from "@/store/comments";
import { tr } from "@/lib/i18n";

type DockTool = "select" | "text" | "rect" | "ellipse" | "line" | "arrow" | "pen" | "pencil" | "comment";
type Item = { tool: DockTool; icon: typeof Square; title: () => string };

const SELECT: Item = { tool: "select", icon: MousePointer2, title: () => tr("editor.select_v") };
const TEXT: Item = { tool: "text", icon: Type, title: () => tr("editor.text_t") };
const COMMENT: Item = { tool: "comment", icon: MessageSquarePlus, title: () => tr("editor.comment_c_click_the_canvas_to_drop_a_pin") };
const GROUPS: { id: string; items: Item[] }[] = [
  { id: "shapes", items: [
    { tool: "rect", icon: Square, title: () => tr("editor.rectangle_r_drag_to_draw") },
    { tool: "ellipse", icon: Circle, title: () => tr("editor.ellipse_e_drag_to_draw") },
  ] },
  { id: "lines", items: [
    { tool: "line", icon: Minus, title: () => tr("editor.line_l") },
    { tool: "arrow", icon: MoveUpRight, title: () => tr("editor.arrow_a") },
  ] },
  { id: "draw", items: [
    { tool: "pen", icon: PenTool, title: () => tr("editor.pen_p") },
    { tool: "pencil", icon: Pencil, title: () => tr("editor.pencil_b_drag_to_draw_freehand") },
  ] },
];

const btn = "grid h-8 w-8 place-items-center rounded-lg transition";
const idle = "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900";
const active = "bg-brand-50 text-brand-ink";

/** Switch tools. Leaving the pen first finishes the path being drawn: the
 *  canvas commits an open pen draft on Enter, so the dock sends exactly that. */
function switchTool(t: DockTool) {
  const st = useEditor.getState();
  if (st.tool === "pen" && t !== "pen") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  st.setTool(t);
}

export function ToolDock({ floating = false }: { floating?: boolean }) {
  const tool = useEditor((s) => s.tool);
  const canComment = useComments((s) => s.canComment);
  const onPick = switchTool;
  // Which tool each group slot shows: the one last used from it.
  const [last, setLast] = useState<Record<string, DockTool>>({});
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openGroup) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenGroup(null);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [openGroup]);

  const pick = (t: DockTool, group?: string) => {
    if (group) setLast((m) => ({ ...m, [group]: t }));
    setOpenGroup(null);
    onPick(t);
  };
  const single = (it: Item) => (
    <button key={it.tool} type="button" title={it.title()} aria-label={it.title()} aria-pressed={tool === it.tool} onClick={() => pick(it.tool)} className={`${btn} ${tool === it.tool ? active : idle}`}>
      <it.icon size={17} />
    </button>
  );

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={tr("editor.tools")}
      className={floating
        ? "pointer-events-auto absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-neutral-200 bg-surface p-1 shadow-md"
        : "flex items-center gap-0.5 rounded-xl border border-neutral-200 bg-surface p-0.5"}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {single(SELECT)}
      <span className="mx-1 h-5 w-px bg-neutral-200" />
      {single(TEXT)}
      {GROUPS.map((g) => {
        const shown = g.items.find((i) => i.tool === (last[g.id] ?? g.items[0].tool)) ?? g.items[0];
        const groupActive = g.items.some((i) => i.tool === tool);
        const current = groupActive ? g.items.find((i) => i.tool === tool)! : shown;
        return (
          <div key={g.id} className="relative flex items-center">
            <button
              type="button"
              title={current.title()}
              aria-label={current.title()}
              aria-pressed={groupActive}
              onClick={() => pick(current.tool, g.id)}
              className={`${btn} ${groupActive ? active : idle}`}
            >
              <current.icon size={17} />
            </button>
            <button
              type="button"
              aria-label={tr("editor.more_actions")}
              aria-expanded={openGroup === g.id}
              onClick={() => setOpenGroup((o) => (o === g.id ? null : g.id))}
              className={`grid h-8 w-3.5 place-items-center rounded-md text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 ${openGroup === g.id ? "bg-neutral-100 text-neutral-700" : ""}`}
            >
              <ChevronUp size={12} />
            </button>
            {openGroup === g.id && (
              <div role="menu" className="absolute bottom-full left-0 mb-2 w-60 rounded-xl border border-neutral-200 bg-surface p-1 shadow-xl">
                {g.items.map((it) => (
                  <button
                    key={it.tool}
                    type="button"
                    role="menuitem"
                    onClick={() => pick(it.tool, g.id)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-start text-[13px] transition ${tool === it.tool ? "bg-brand-50 text-brand-ink" : "text-neutral-700 hover:bg-neutral-100"}`}
                  >
                    <it.icon size={16} className="shrink-0" />
                    {it.title()}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {canComment && (
        <>
          <span className="mx-1 h-5 w-px bg-neutral-200" />
          {single(COMMENT)}
        </>
      )}
    </div>
  );
}
