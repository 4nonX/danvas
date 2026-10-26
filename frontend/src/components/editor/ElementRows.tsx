// The Elements panel as rows (lib/elementRows.ts): a search over everything,
// then one row per kind of element, each showing a single line of tiles (the
// person's pinned tiles, then the ones they use most) with "See all" for the
// whole row. Rows are sorted by dragging their handle (or with the arrow keys
// on it), tiles by dragging them within their row; a tile dropped into a
// row's line is pinned there. Tiles are controls: dragging one never drops
// anything on the page. The arrangement is kept with the account.

import { useMemo, useRef, useState } from "react";
import { ChevronLeft, EyeOff, GripVertical, Pin, Search } from "lucide-react";
import { tr } from "@/lib/i18n";
import { useUiPref } from "@/lib/uiPrefs";
import {
  ELEMENT_ROWS_PREF, moveRowBefore, moveRowBy, moveTileBefore, normalizeRowsPref, recordUse, resetArrangement,
  setRowHidden, sortTiles, stripTiles, togglePin,
} from "@/lib/elementRows";

export interface ElementTileDef {
  /** Stable across languages and releases (it is stored). */
  id: string;
  label: string;
  /** Extra search words (category, synonyms). */
  terms?: string[];
  render: () => React.ReactNode;
  run: () => void | Promise<void>;
}

export interface ElementRowDef {
  id: string;
  title: string;
  tiles: ElementTileDef[];
  /** Shown beside the title when the row holds more than its tiles here. */
  count?: number;
  /** A row too large for a grid opens its own view instead (graphics). */
  browse?: () => React.ReactNode;
}

const ROW_MIME = "application/x-oc-element-row";
const TILE_MIME = "application/x-oc-element-tile";
const MAX_RESULTS = 48;

const tileClass = "relative flex flex-col items-center justify-center gap-1 rounded-lg bg-neutral-50 text-neutral-600 transition hover:bg-brand-50 hover:text-brand-ink";

export function ElementRows({ rows }: { rows: ElementRowDef[] }) {
  const [pref, setPref] = useUiPref(ELEMENT_ROWS_PREF, normalizeRowsPref);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState<string | null>(null);
  // Drag state: refs for the handlers (no stale closures mid-drag), state to draw.
  const armed = useRef<string | null>(null);
  const dragRow = useRef<string | null>(null);
  const dragTile = useRef<{ row: string; id: string } | null>(null);
  const [mark, setMark] = useState<{ dragRow?: string; overRow?: string; dragTile?: string; overTile?: string }>({});
  const [armedRow, setArmedRow] = useState<string | null>(null);

  const byId = useMemo(() => {
    const m = new Map<string, ElementTileDef>();
    for (const r of rows) for (const t of r.tiles) if (!m.has(t.id)) m.set(t.id, t);
    return m;
  }, [rows]);

  const insert = (t: ElementTileDef) => {
    setPref(recordUse(pref, t.id));
    void t.run();
  };

  const rowsById = new Map(rows.map((r) => [r.id, r]));
  const recentTiles = pref.recent.map((id) => byId.get(id)).filter((t): t is ElementTileDef => !!t);
  const visible = pref.order
    .map((id) => (id === "recent" ? { id, title: tr("editor.recently_used"), tiles: recentTiles } as ElementRowDef : rowsById.get(id)))
    .filter((r): r is ElementRowDef => !!r && !pref.hidden.includes(r.id) && (r.id !== "recent" || r.tiles.length > 0));
  const hiddenRows = pref.order.map((id) => rowsById.get(id)).filter((r): r is ElementRowDef => !!r && pref.hidden.includes(r.id));

  const q = query.trim().toLowerCase();
  const results = q
    ? Array.from(byId.values()).filter((t) => t.label.toLowerCase().includes(q) || (t.terms ?? []).some((w) => w.toLowerCase().includes(q))).slice(0, MAX_RESULTS)
    : [];

  const clearDrag = () => {
    armed.current = null; dragRow.current = null; dragTile.current = null;
    setArmedRow(null); setMark({});
  };

  const browsed = browsing ? rowsById.get(browsing) : undefined;
  if (browsed?.browse) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setBrowsing(null)} aria-label={tr("editor.elements_back")} className="grid h-7 w-7 place-items-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800">
            <ChevronLeft size={16} className="rtl:rotate-180" />
          </button>
          <span className="flex-1 text-[13px] font-semibold text-neutral-800">{browsed.title}</span>
          {browsed.count != null && <span className="text-[11px] text-neutral-400">{browsed.count}</span>}
        </div>
        {browsed.browse()}
      </div>
    );
  }

  const tileButton = (t: ElementTileDef, row: string, current: string[], inStrip: boolean, extra?: React.ReactNode) => {
    const sortable = row !== "recent";
    return (
      <div
        key={`${row}-${t.id}`}
        className={`relative ${mark.dragTile === t.id ? "opacity-40" : ""}`}
        draggable={sortable}
        onDragStart={(e) => {
          if (!sortable) return;
          e.stopPropagation();
          dragTile.current = { row, id: t.id };
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData(TILE_MIME, t.id);
          setMark({ dragTile: t.id });
        }}
        onDragOver={(e) => {
          const d = dragTile.current;
          if (!d || d.row !== row) return;
          e.preventDefault();
          e.stopPropagation();
          if (mark.overTile !== t.id) setMark({ dragTile: d.id, overTile: t.id });
        }}
        onDrop={(e) => {
          const d = dragTile.current;
          if (!d || d.row !== row) return;
          e.preventDefault();
          e.stopPropagation();
          setPref(moveTileBefore(pref, row, current, d.id, t.id, inStrip));
          clearDrag();
        }}
        onDragEnd={clearDrag}
      >
        {mark.overTile === t.id && mark.dragTile !== t.id && <span aria-hidden="true" className="absolute -start-1 bottom-2 top-2 w-0.5 rounded bg-brand-500" />}
        {inStrip ? (
          <button
            type="button"
            onClick={() => insert(t)}
            title={pref.pins.includes(t.id) ? tr("editor.elements_pinned", { name: t.label }) : t.label}
            aria-label={t.label}
            className={`${tileClass} h-12 w-full`}
          >
            {t.render()}
            {pref.pins.includes(t.id) && <span aria-hidden="true" className="absolute end-1 top-1 h-1.5 w-1.5 rounded-full bg-brand-500" />}
          </button>
        ) : (
          <button type="button" onClick={() => insert(t)} title={t.label} className={`${tileClass} aspect-square w-full`}>
            {t.render()}
            <span className="max-w-full truncate px-0.5 text-[10px] font-medium leading-tight">{t.label}</span>
          </button>
        )}
        {extra}
      </div>
    );
  };

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 -mx-4 bg-surface px-4 pb-3">
        <label className="flex items-center gap-2 rounded-lg border border-neutral-200 px-2.5 focus-within:border-brand-400">
          <Search size={14} className="shrink-0 text-neutral-400" aria-hidden="true" />
          <span className="sr-only">{tr("editor.elements_search")}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("editor.elements_search")}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none"
          />
        </label>
      </div>

      {q ? (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{tr("editor.elements_results", { count: results.length })}</span>
          {results.length > 0 ? (
            <div className="grid grid-cols-4 gap-1.5">
              {results.map((t) => (
                <button key={t.id} type="button" onClick={() => insert(t)} title={t.label} className={`${tileClass} aspect-square`}>
                  {t.render()}
                  <span className="max-w-full truncate px-0.5 text-[10px] font-medium leading-tight">{t.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="py-2 text-xs text-neutral-400">{tr("editor.elements_no_results")}</p>
          )}
        </div>
      ) : (
        <>
          {visible.map((row) => {
            const isRecent = row.id === "recent";
            const sorted = isRecent ? row.tiles : sortTiles(row.tiles, pref.tileOrder[row.id]);
            const current = sorted.map((t) => t.id);
            const strip = isRecent ? sorted.slice(0, 5) : stripTiles(sorted, pref);
            const expanded = open === row.id;
            const target = mark.overRow === row.id && !!mark.dragRow && mark.dragRow !== row.id;
            return (
              <section
                key={row.id}
                aria-label={row.title}
                draggable={armedRow === row.id}
                onDragStart={(e) => {
                  if (armed.current !== row.id) { e.preventDefault(); return; }
                  dragRow.current = row.id;
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData(ROW_MIME, row.id);
                  setMark({ dragRow: row.id });
                }}
                onDragOver={(e) => {
                  if (!dragRow.current) return;
                  e.preventDefault();
                  if (mark.overRow !== row.id) setMark({ dragRow: dragRow.current ?? undefined, overRow: row.id });
                }}
                onDrop={(e) => {
                  const d = dragRow.current;
                  if (!d) return;
                  e.preventDefault();
                  setPref(moveRowBefore(pref, d, row.id));
                  clearDrag();
                }}
                onDragEnd={clearDrag}
                className={`flex flex-col gap-1.5 border-t-2 pb-3 pt-1 ${target ? "border-brand-400" : "border-transparent"} ${mark.dragRow === row.id ? "opacity-50" : ""}`}
              >
                <div className="flex h-8 items-center gap-1">
                  <button
                    type="button"
                    onPointerDown={() => { armed.current = row.id; setArmedRow(row.id); }}
                    onPointerUp={() => { if (!dragRow.current) { armed.current = null; setArmedRow(null); } }}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                        e.preventDefault();
                        setPref(moveRowBy(pref, row.id, e.key === "ArrowUp" ? -1 : 1));
                      }
                    }}
                    aria-label={tr("editor.elements_move_row", { name: row.title })}
                    title={tr("editor.elements_drag_to_reorder")}
                    className="grid h-7 w-5 shrink-0 cursor-grab place-items-center rounded text-neutral-300 hover:bg-neutral-100 hover:text-neutral-500 active:cursor-grabbing"
                  >
                    <GripVertical size={14} aria-hidden="true" />
                  </button>
                  <span className="truncate text-[13px] font-semibold text-neutral-800">{row.title}</span>
                  {!isRecent && <span className="text-[11px] text-neutral-400">{row.count ?? row.tiles.length}</span>}
                  <span className="flex-1" />
                  {!isRecent && (
                    <button
                      type="button"
                      onClick={() => { setPref(setRowHidden(pref, row.id, true)); if (expanded) setOpen(null); }}
                      aria-label={tr("editor.elements_hide_row", { name: row.title })}
                      title={tr("editor.elements_hide_row", { name: row.title })}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-neutral-300 hover:bg-neutral-100 hover:text-neutral-600"
                    >
                      <EyeOff size={14} aria-hidden="true" />
                    </button>
                  )}
                  {!isRecent && (
                    <button
                      type="button"
                      onClick={() => (row.browse ? setBrowsing(row.id) : setOpen(expanded ? null : row.id))}
                      aria-expanded={row.browse ? undefined : expanded}
                      className="shrink-0 rounded-md px-1.5 py-1 text-[12px] font-medium text-brand-ink hover:bg-brand-50"
                    >
                      {row.browse ? tr("editor.elements_browse_all") : expanded ? tr("editor.elements_done") : tr("editor.elements_see_all")}
                    </button>
                  )}
                </div>
                {expanded ? (
                  <>
                    <p className="px-0.5 text-[11px] leading-snug text-neutral-400">{tr("editor.elements_grid_hint")}</p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {sorted.map((t) => {
                        const pinned = pref.pins.includes(t.id);
                        const pinLabel = pinned ? tr("editor.elements_unpin", { name: t.label }) : tr("editor.elements_pin", { name: t.label });
                        return tileButton(t, row.id, current, false, (
                          <button
                            type="button"
                            onClick={() => setPref(togglePin(pref, t.id))}
                            aria-pressed={pinned}
                            aria-label={pinLabel}
                            title={pinLabel}
                            className={`absolute end-0.5 top-0.5 grid h-5 w-5 place-items-center rounded ${pinned ? "bg-brand-500 text-white" : "text-neutral-300 hover:bg-neutral-100 hover:text-neutral-600"}`}
                          >
                            <Pin size={11} aria-hidden="true" />
                          </button>
                        ));
                      })}
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-5 gap-1.5">{strip.map((t) => tileButton(t, row.id, current, true))}</div>
                )}
              </section>
            );
          })}

          <div className="mt-1 flex flex-col gap-2 border-t border-neutral-100 pt-3">
            {hiddenRows.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-neutral-500">
                <span>{tr("editor.elements_hidden")}</span>
                {hiddenRows.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setPref(setRowHidden(pref, r.id, false))}
                    aria-label={tr("editor.elements_show_row", { name: r.title })}
                    className="rounded-full border border-neutral-200 px-2.5 py-0.5 text-[11.5px] text-neutral-700 hover:bg-neutral-50"
                  >
                    {r.title} +
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="flex-1 text-[11px] leading-snug text-neutral-400">{tr("editor.elements_saved_note")}</span>
              <button type="button" onClick={() => { setPref(resetArrangement(pref)); setOpen(null); }} className="shrink-0 text-[11.5px] text-neutral-500 underline hover:text-neutral-800">
                {tr("editor.elements_reset")}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
