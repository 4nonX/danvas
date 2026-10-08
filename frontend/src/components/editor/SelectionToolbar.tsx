// Floating mini toolbar next to the selection, Canva-style: lock, duplicate,
// delete and a "more" menu (copy/paste style, layer order, group, Position).
// Formatting lives in the ContextToolbar above the canvas; this bar only holds
// the element actions Canva keeps at the element. Rendered in screen space
// alongside the Gizmo; it owns no transform logic.

import { useState } from "react";
import { CopyPlus, Trash2, Lock, LockOpen, MoreHorizontal, Paintbrush, ClipboardPaste, BringToFront, SendToBack, ArrowUp, ArrowDown, Group as GroupIcon, Ungroup, Move, Replace, Shield } from "lucide-react";
import { unionAABB, locate } from "@hc/editor";
import { useEditor } from "@/store/editor";
import { usePresence } from "@/store/presence";
import type { CanvasApi } from "@/lib/useEditorCanvas";
import { tr } from "@/lib/i18n";
import { isReplaceable } from "@/lib/replaceObject";
import { openReplace } from "./ReplaceObjectDialog";
import { useTemplateLock } from "@/store/templateLock";
import { effectiveLock } from "@/lib/templateLock";

const PAD = 60; // keep the bar from spilling off the canvas edges

function ToolBtn({ icon: Icon, label, onClick, danger, active }: { icon: typeof CopyPlus; label: string; onClick: () => void; danger?: boolean; active?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded-md transition ${active ? "bg-brand-50 text-brand-ink" : danger ? "text-neutral-500 hover:bg-red-50 hover:text-red-600" : "text-neutral-600 hover:bg-neutral-100 hover:text-brand-ink"}`}
    >
      <Icon size={15} />
    </button>
  );
}

function MenuItem({ icon: Icon, label, onClick }: { icon: typeof CopyPlus; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-start text-sm text-neutral-700 transition hover:bg-neutral-100">
      <Icon size={15} className="shrink-0 text-neutral-500" />
      {label}
    </button>
  );
}

export function SelectionToolbar({ api }: { api: CanvasApi }) {
  const selection = useEditor((s) => s.selection);
  // Track edits, pan/zoom so the bar follows the selection box.
  useEditor((s) => s.rev);
  useEditor((s) => s.viewport);
  const cropping = useEditor((s) => s.cropping);
  const presenting = useEditor((s) => s.presenting);
  const editingText = useEditor((s) => s.editingTextId);
  // Re-render when access changes so viewers don't get edit actions.
  usePresence((s) => s.accessMode);
  // The "more" menu remembers WHICH selection it was opened for, so a new
  // selection starts with it closed, without writing state during render.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const selectionKey = selection.join("|");
  const menuOpen = menuFor === selectionKey;
  const closeMenu = () => setMenuFor(null);

  if (!selection.length || cropping || presenting || editingText) return null;
  if (!usePresence.getState().canEdit() || useEditor.getState().readonlyPreview()) return null;

  const doc = useEditor.getState().doc;
  // A single connector has no box at its own transform (it routes between two
  // nodes), so anchor the bar to the routed line's bounds; otherwise use the
  // selection's union box.
  const connBox =
    selection.length === 1 && locate(doc, selection[0])?.node.type === "connector"
      ? api.scene()?.connectorBounds(selection[0])
      : null;
  const box = connBox ?? unionAABB(doc, selection);
  if (!box) return null;

  const tl = api.toScreen({ x: box.x, y: box.y });
  const br = api.toScreen({ x: box.x + box.width, y: box.y + box.height });
  const surface = document.getElementById("oc-canvas-surface")?.getBoundingClientRect();
  const w = surface?.width ?? 1e4;
  const centerX = Math.min(Math.max((tl.x + br.x) / 2, PAD), w - PAD);
  // Prefer above the box (clearing the rotate handle ~26px up); flip below when
  // there isn't room near the top of the canvas.
  const above = tl.y > 80;
  const top = above ? tl.y - 36 : br.y + 36;
  const translate = above ? "translate(-50%, -100%)" : "translate(-50%, 0)";

  const st = useEditor.getState();
  const allLocked = selection.every((id) => locate(doc, id)?.node.locked);
  const canGroup = selection.length >= 2;
  const isSingleGroup = selection.length === 1 && locate(doc, selection[0])?.node.type === "group";
  const single = selection.length === 1 ? locate(doc, selection[0])?.node : undefined;
  const canReplace = !!single && isReplaceable(single) && !single.locked;
  const run = (fn: () => void) => () => { fn(); closeMenu(); };

  return (
    <div
      className="pointer-events-auto absolute z-30 flex items-center gap-0.5 rounded-lg border border-neutral-200 bg-surface p-0.5 shadow-md ring-1 ring-black/5"
      style={{ left: centerX, top, transform: translate }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <ToolBtn
        icon={allLocked ? Lock : LockOpen}
        label={allLocked ? tr("editor.unlock") : tr("editor.lock")}
        active={allLocked}
        onClick={() => st.setLockedSel(!allLocked)}
      />
      <ToolBtn icon={CopyPlus} label={tr("editor.duplicate")} onClick={() => st.duplicateSelection()} />
      <ToolBtn icon={Trash2} label={tr("editor.delete")} danger onClick={() => st.deleteSelection()} />
      <ToolBtn icon={MoreHorizontal} label={tr("editor.more_actions")} active={menuOpen} onClick={() => setMenuFor(menuOpen ? null : selectionKey)} />
      {menuOpen && (
        <div
          role="menu"
          aria-label={tr("editor.more_actions")}
          className="absolute end-0 top-full z-40 mt-1.5 w-56 rounded-xl border border-neutral-200 bg-surface p-1 shadow-xl ring-1 ring-black/5"
        >
          <MenuItem icon={Paintbrush} label={tr("editor.copy_style")} onClick={run(() => st.copyStyle())} />
          <MenuItem icon={ClipboardPaste} label={tr("editor.paste_style")} onClick={run(() => st.pasteStyle())} />
          <div className="my-1 h-px bg-neutral-100" />
          <MenuItem icon={BringToFront} label={tr("editor.bring_to_front")} onClick={run(() => st.orderSelection("front"))} />
          <MenuItem icon={ArrowUp} label={tr("editor.bring_forward")} onClick={run(() => st.orderSelection("forward"))} />
          <MenuItem icon={ArrowDown} label={tr("editor.send_backward")} onClick={run(() => st.orderSelection("backward"))} />
          <MenuItem icon={SendToBack} label={tr("editor.send_to_back")} onClick={run(() => st.orderSelection("back"))} />
          {(canGroup || isSingleGroup || canReplace) && <div className="my-1 h-px bg-neutral-100" />}
          {canGroup && <MenuItem icon={GroupIcon} label={tr("editor.group")} onClick={run(() => st.group())} />}
          {isSingleGroup && <MenuItem icon={Ungroup} label={tr("editor.ungroup")} onClick={run(() => st.ungroupSelection())} />}
          {canReplace && <MenuItem icon={Replace} label={tr("editor.replace")} onClick={run(() => openReplace(selection[0]))} />}
          <div className="my-1 h-px bg-neutral-100" />
          <MenuItem icon={Move} label={tr("editor.position")} onClick={run(() => st.requestRail("position"))} />
          {(useTemplateLock.getState().canManage || selection.some((id) => effectiveLock(doc, id))) && (
            <MenuItem
              icon={Shield}
              label={tr("editor.template_lock_menu")}
              onClick={run(() => useTemplateLock.getState().openFor(selection, selection.map((id) => effectiveLock(doc, id)).find((e) => !!e) ?? null))}
            />
          )}
        </div>
      )}
    </div>
  );
}
