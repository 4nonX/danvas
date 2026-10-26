// Titled rows of a side panel that each person orders for themselves: drag a
// row by its handle, or use the arrow keys on the handle. The order is kept
// with the account (an interface preference), like the Elements panel's rows.

import { useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { tr } from "@/lib/i18n";
import { useUiPref } from "@/lib/uiPrefs";
import { moveBefore, moveBy, normalizeOrder, storedOrder } from "@/lib/orderPref";

export interface SortableRow {
  id: string;
  title: string;
  count?: number;
  /** Beside the title, at the end (an action or a hint). */
  right?: React.ReactNode;
  body: React.ReactNode;
}

const MIME = "application/x-oc-panel-row";

/** `ids` is every row the panel can show, in its built-in order; rows not
 *  passed this time (nothing to show) keep their place for later. */
export function SortableRows({ prefKey, ids, rows }: { prefKey: string; ids: readonly string[]; rows: SortableRow[] }) {
  const normalize = (raw: unknown) => normalizeOrder(storedOrder(raw), ids);
  const [order, setOrderPref] = useUiPref(prefKey, normalize);
  const setOrder = (next: string[]) => setOrderPref(next);
  const armed = useRef<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; over?: string } | null>(null);
  const [armedRow, setArmedRow] = useState<string | null>(null);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const end = () => { armed.current = null; setArmedRow(null); setDrag(null); };

  return (
    <div className="flex flex-col">
      {order.map((id) => byId.get(id)).filter((r): r is SortableRow => !!r).map((row) => {
        const target = !!drag && drag.over === row.id && drag.id !== row.id;
        return (
          <section
            key={row.id}
            aria-label={row.title}
            draggable={armedRow === row.id}
            onDragStart={(e) => {
              if (armed.current !== row.id) { e.preventDefault(); return; }
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData(MIME, row.id);
              setDrag({ id: row.id });
            }}
            onDragOver={(e) => { if (!drag) return; e.preventDefault(); if (drag.over !== row.id) setDrag({ id: drag.id, over: row.id }); }}
            onDrop={(e) => { if (!drag) return; e.preventDefault(); setOrder(moveBefore(order, drag.id, row.id)); end(); }}
            onDragEnd={end}
            className={`flex flex-col gap-1.5 border-t-2 pb-3 pt-1 ${target ? "border-brand-400" : "border-transparent"} ${drag?.id === row.id ? "opacity-50" : ""}`}
          >
            <div className="flex h-8 items-center gap-1">
              <button
                type="button"
                onPointerDown={() => { armed.current = row.id; setArmedRow(row.id); }}
                onPointerUp={() => { if (!drag) { armed.current = null; setArmedRow(null); } }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    e.preventDefault();
                    setOrder(moveBy(order, row.id, e.key === "ArrowUp" ? -1 : 1));
                  }
                }}
                aria-label={tr("editor.elements_move_row", { name: row.title })}
                title={tr("editor.elements_drag_to_reorder")}
                className="grid h-7 w-5 shrink-0 cursor-grab place-items-center rounded text-neutral-300 hover:bg-neutral-100 hover:text-neutral-500 active:cursor-grabbing"
              >
                <GripVertical size={14} aria-hidden="true" />
              </button>
              <span className="truncate text-[13px] font-semibold text-neutral-800">{row.title}</span>
              {row.count != null && <span className="text-[11px] text-neutral-400">{row.count}</span>}
              <span className="flex-1" />
              {row.right}
            </div>
            <div className="ps-6">{row.body}</div>
          </section>
        );
      })}
    </div>
  );
}
