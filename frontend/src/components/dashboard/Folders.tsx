// Dashboard design folders: tree helpers, the drag payload shared by design
// cards and folder tiles, a folder tile, the folder path bar, and the
// "Move to folder" dialog. Folder state lives in DashboardApp; these pieces
// only render it and report what the user did.

import { useState, type DragEvent, type ReactNode } from "react";
import { ChevronRight, Folder as FolderIcon, FolderOpen, FolderPlus, MoreHorizontal, Pencil, Trash2, FolderInput, Check, LayoutTemplate } from "lucide-react";
import type { DesignFolder } from "@hc/sdk";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { tr } from "@/lib/i18n";

/** What a drag carries: the designs and folders being moved. */
export type DragItems = { designIds: string[]; folderIds: string[] };

const DRAG_TYPE = "application/x-hc-items";

export function setDragItems(e: DragEvent, items: DragItems) {
  e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(items));
  e.dataTransfer.effectAllowed = "move";
}

export function hasDragItems(e: DragEvent): boolean {
  return e.dataTransfer.types.includes(DRAG_TYPE);
}

export function getDragItems(e: DragEvent): DragItems | null {
  try {
    const v = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as DragItems;
    return Array.isArray(v.designIds) && Array.isArray(v.folderIds) ? v : null;
  } catch {
    return null;
  }
}

/** Children of each folder id ("" = root), sorted by name. */
export function childrenMap(folders: DesignFolder[]): Map<string, DesignFolder[]> {
  const m = new Map<string, DesignFolder[]>();
  for (const f of folders) {
    const k = f.parentId ?? "";
    m.set(k, [...(m.get(k) ?? []), f]);
  }
  for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return m;
}

/** Root-to-folder path (empty for the root or an unknown id). */
export function folderPath(folders: DesignFolder[], id: string | null): DesignFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: DesignFolder[] = [];
  let cur = id ? byId.get(id) : undefined;
  for (let i = 0; cur && i < 100; i++) {
    out.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

/** The ids of a folder and everything below it. */
export function subtreeIds(folders: DesignFolder[], id: string): Set<string> {
  const kids = childrenMap(folders);
  const out = new Set<string>();
  const walk = (x: string) => {
    out.add(x);
    for (const c of kids.get(x) ?? []) walk(c.id);
  };
  walk(id);
  return out;
}

/** Drop-target props: highlight while a drag hovers, report the drop. */
export function useDropTarget(onDrop: (items: DragItems) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        if (!hasDragItems(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      },
      onDragLeave: (e: DragEvent) => {
        if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as globalThis.Node | null)) return;
        setOver(false);
      },
      onDrop: (e: DragEvent) => {
        setOver(false);
        const items = getDragItems(e);
        if (!items) return;
        e.preventDefault();
        onDrop(items);
      },
    },
  };
}

/** A folder in the Projects grid: open on click, drop designs/folders on it. */
export function FolderTile({
  folder, subfolders, selected, menuOpen, onOpen, onToggleMenu, onRename, onMove, onDelete, onDropItems, onDragStart, onToggleSelect,
}: {
  folder: DesignFolder;
  subfolders: number;
  selected: boolean;
  menuOpen: boolean;
  onOpen: () => void;
  onToggleMenu: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
  onDropItems: (items: DragItems) => void;
  onDragStart: (e: DragEvent) => void;
  onToggleSelect: () => void;
}) {
  const drop = useDropTarget(onDropItems);
  // Counts as icon + number: short at any tile width and in any language.
  // The design count always shows (0 for an empty folder), so every tile reads
  // the same way; sub-folders only when there are any.
  const count = (
    <span className="flex items-center gap-2.5">
      <span className="flex items-center gap-1" title={tr("dashboard.n_designs", { n: folder.designCount })}><LayoutTemplate size={11} />{folder.designCount}</span>
      {subfolders > 0 && <span className="flex items-center gap-1" title={tr("dashboard.n_folders", { n: subfolders })}><FolderIcon size={11} />{subfolders}</span>}
    </span>
  );
  return (
    <li
      {...drop.props}
      draggable
      onDragStart={onDragStart}
      className={`group relative flex items-center gap-3 rounded-xl border bg-surface px-3 py-2.5 shadow-sm transition hover:shadow-md ${
        drop.over ? "border-brand-400 ring-2 ring-brand-200" : selected ? "border-brand-400 ring-2 ring-brand-100" : "border-neutral-200"
      }`}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
        aria-label={tr("dashboard.select")}
        aria-pressed={selected}
        className={`absolute -start-2 -top-2 grid h-5 w-5 place-items-center rounded-md border shadow-sm transition ${
          selected ? "border-brand-600 bg-brand-600 text-white" : "border-neutral-300 bg-surface text-transparent opacity-0 group-hover:opacity-100"
        }`}
      ><Check size={12} strokeWidth={3} /></button>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-start">
        {drop.over ? <FolderOpen size={22} className="shrink-0 text-brand-600" /> : <FolderIcon size={22} className="shrink-0 text-brand-600" fill="currentColor" fillOpacity={0.15} />}
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-neutral-800">{folder.name}</span>
          <span className="block truncate text-xs text-neutral-400">{count}</span>
        </span>
      </button>
      <div className="relative">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleMenu(); }}
          aria-label={tr("dashboard.more")}
          className="grid h-7 w-7 place-items-center rounded-lg text-neutral-400 opacity-0 transition hover:bg-neutral-100 hover:text-neutral-700 group-hover:opacity-100 aria-expanded:opacity-100"
          aria-expanded={menuOpen}
        ><MoreHorizontal size={16} /></button>
        {menuOpen && (
          <div className="absolute end-0 z-30 mt-1 w-44 overflow-hidden rounded-xl border border-neutral-200 bg-surface py-1 text-sm shadow-lg" onClick={(e) => e.stopPropagation()}>
            <FolderMenuRow icon={FolderOpen} onClick={onOpen}>{tr("dashboard.open")}</FolderMenuRow>
            <FolderMenuRow icon={Pencil} onClick={onRename}>{tr("dashboard.rename")}</FolderMenuRow>
            <FolderMenuRow icon={FolderInput} onClick={onMove}>{tr("dashboard.move_to_folder")}</FolderMenuRow>
            <FolderMenuRow icon={Trash2} danger onClick={onDelete}>{tr("dashboard.delete_folder")}</FolderMenuRow>
          </div>
        )}
      </div>
    </li>
  );
}

function FolderMenuRow({ children, onClick, danger, icon: Icon }: { children: ReactNode; onClick: () => void; danger?: boolean; icon: typeof Trash2 }) {
  return (
    <button type="button" onClick={onClick} className={`flex w-full items-center gap-2.5 px-3 py-2 text-start transition hover:bg-neutral-50 ${danger ? "text-red-600" : "text-neutral-700"}`}>
      <Icon size={15} className="shrink-0" /> {children}
    </button>
  );
}

/** One crumb of the folder path; also a drop target. */
function Crumb({ label, current, onClick, onDropItems }: { label: string; current: boolean; onClick: () => void; onDropItems: (items: DragItems) => void }) {
  const drop = useDropTarget(onDropItems);
  return (
    <button
      type="button"
      {...drop.props}
      onClick={onClick}
      aria-current={current ? "page" : undefined}
      className={`max-w-[16rem] truncate rounded-lg px-2 py-1 transition ${
        drop.over ? "bg-brand-100 text-brand-ink" : current ? "font-semibold text-neutral-900" : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
      }`}
    >{label}</button>
  );
}

/** "Projects > A > B": click to go up, drop to move up. */
export function FolderPathBar({ path, onNavigate, onDropItems }: { path: DesignFolder[]; onNavigate: (id: string | null) => void; onDropItems: (target: string | null, items: DragItems) => void }) {
  return (
    <nav aria-label={tr("dashboard.folder_path")} className="flex min-w-0 flex-wrap items-center gap-0.5 text-xl">
      <Crumb label={tr("dashboard.projects")} current={path.length === 0} onClick={() => onNavigate(null)} onDropItems={(it) => onDropItems(null, it)} />
      {path.map((f, i) => (
        <span key={f.id} className="flex min-w-0 items-center gap-0.5">
          <ChevronRight size={18} className="shrink-0 text-neutral-300" />
          <Crumb label={f.name} current={i === path.length - 1} onClick={() => onNavigate(f.id)} onDropItems={(it) => onDropItems(f.id, it)} />
        </span>
      ))}
    </nav>
  );
}

/** A folder in the rail under "Projects": navigate or drop onto it. */
/** How many designs of one folder the tree lists before it points to the
 *  folder itself. */
const RAIL_DESIGNS = 50;

/** The sidebar's tree below Projects: every folder level, indented, and under
 *  an opened folder its sub-folders and then its designs, like a file
 *  manager. A folder with anything in it opens and closes by its chevron.
 *  The path to the open folder is always shown. Each folder row takes dropped
 *  designs and folders; a design row opens the design and can be dragged. */
export function RailFolderTree({
  folders, designs, current, expanded, onToggle, onOpen, onDropItems, onOpenDesign, onDragDesign,
}: {
  folders: DesignFolder[];
  /** The workspace's designs, or null when they are not all at hand (a
   *  search is showing): the tree then lists folders only. */
  designs: { id: string; title: string; folderId?: string | null }[] | null;
  /** The folder that is open in the main view. */
  current: string | null;
  /** The folders the user opened in the tree. */
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onDropItems: (items: DragItems, target: string) => void;
  onOpenDesign: (id: string) => void;
  onDragDesign: (e: DragEvent, id: string) => void;
}) {
  const kids = childrenMap(folders);
  const inFolder = new Map<string, { id: string; title: string }[]>();
  for (const d of designs ?? []) {
    if (d.folderId) inFolder.set(d.folderId, [...(inFolder.get(d.folderId) ?? []), d]);
  }
  for (const list of inFolder.values()) list.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
  // The way to the open folder shows without the user having opened it. They
  // can still close a folder on that way; that holds until they move on.
  const onPath = new Set(folderPath(folders, current).map((f) => f.id));
  onPath.delete(current ?? "");
  const [closed, setClosed] = useState<{ at: string | null; ids: Set<string> }>({ at: current, ids: new Set() });
  const closedNow = closed.at === current ? closed.ids : new Set<string>();
  const isOpen = (id: string) => !closedNow.has(id) && (expanded.has(id) || onPath.has(id));
  const toggle = (id: string) => {
    const ids = new Set(closedNow);
    if (isOpen(id)) {
      if (expanded.has(id)) onToggle(id);
      if (onPath.has(id)) ids.add(id);
    } else {
      ids.delete(id);
      if (!expanded.has(id)) onToggle(id);
    }
    setClosed({ at: current, ids });
  };
  const rows = (parent: string, depth: number): ReactNode[] =>
    (kids.get(parent) ?? []).flatMap((f) => {
      const children = kids.get(f.id) ?? [];
      const own = inFolder.get(f.id) ?? [];
      const expandable = children.length > 0 || own.length > 0;
      const open = expandable && isOpen(f.id);
      return [
        <RailFolder
          key={f.id}
          folder={f}
          depth={depth}
          active={f.id === current}
          expandable={expandable}
          open={open}
          onToggle={() => toggle(f.id)}
          onClick={() => onOpen(f.id)}
          onDropItems={(it) => onDropItems(it, f.id)}
        />,
        ...(open ? rows(f.id, depth + 1) : []),
        ...(open
          ? own.slice(0, RAIL_DESIGNS).map((d) => (
              <RailDesign key={d.id} title={d.title} depth={depth + 1} onClick={() => onOpenDesign(d.id)} onDragStart={(e) => onDragDesign(e, d.id)} />
            ))
          : []),
        // A long folder: the rest is one click away, in the folder itself.
        ...(open && own.length > RAIL_DESIGNS
          ? [<RailMore key={`${f.id}-more`} count={own.length - RAIL_DESIGNS} depth={depth + 1} folder={f.name} onClick={() => onOpen(f.id)} />]
          : []),
      ];
    });
  return <>{rows("", 0)}</>;
}

function RailFolder({
  folder, depth, active, expandable, open, onToggle, onClick, onDropItems,
}: {
  folder: DesignFolder;
  depth: number;
  active: boolean;
  expandable: boolean;
  open: boolean;
  onToggle: () => void;
  onClick: () => void;
  onDropItems: (items: DragItems) => void;
}) {
  const drop = useDropTarget(onDropItems);
  return (
    <div
      {...drop.props}
      className={`flex items-center rounded-lg text-[13px] transition ${
        drop.over ? "bg-brand-100 text-brand-ink" : active ? "bg-brand-50 font-medium text-brand-ink dark:bg-brand-500/20" : "text-neutral-600 hover:bg-neutral-100"
      }`}
      style={{ paddingInlineStart: 14 + depth * 14 }}
    >
      {expandable ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? tr("dashboard.collapse") : tr("dashboard.expand")}
          aria-expanded={open}
          className="grid h-7 w-5 shrink-0 place-items-center rounded text-neutral-400 hover:text-neutral-700"
        ><ChevronRight size={13} className={`transition-transform rtl:-scale-x-100 ${open ? "rotate-90 rtl:rotate-90" : ""}`} /></button>
      ) : (
        // An empty folder has nothing to unfold; a click here opens it too.
        <button type="button" tabIndex={-1} aria-hidden onClick={onClick} className="h-7 w-5 shrink-0" />
      )}
      <button type="button" onClick={onClick} title={folder.name} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pe-3 text-start">
        {open ? <FolderOpen size={14} className="shrink-0 text-neutral-400" /> : <FolderIcon size={14} className="shrink-0 text-neutral-400" />}
        <span className="truncate">{folder.name}</span>
      </button>
    </div>
  );
}

/** A design in the sidebar's tree, below its folder. */
function RailDesign({ title, depth, onClick, onDragStart }: { title: string; depth: number; onClick: () => void; onDragStart: (e: DragEvent) => void }) {
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      title={title}
      className="flex items-center gap-2 rounded-lg py-1 pe-3 text-start text-[12.5px] text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700"
      style={{ paddingInlineStart: 14 + depth * 14 + 20 }}
    >
      <LayoutTemplate size={13} className="shrink-0 text-neutral-400" />
      <span className="truncate">{title}</span>
    </button>
  );
}

/** "+N": the designs of a long folder the tree does not list. */
function RailMore({ count, depth, folder, onClick }: { count: number; depth: number; folder: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={folder}
      className="rounded-lg py-1 pe-3 text-start text-[12px] text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
      style={{ paddingInlineStart: 14 + depth * 14 + 20 + 21 }}
    >+{count}</button>
  );
}

/** Pick a destination folder (or the root). Folders being moved, and what is
 *  below them, cannot be picked. */
export function MoveToFolderDialog({
  open, folders, exclude, current, count, onClose, onPick, onCreate,
}: {
  open: boolean;
  folders: DesignFolder[];
  /** Folder ids that may not be targets (the moved folders' subtrees). */
  exclude: Set<string>;
  /** Where the items are now (pre-selected, shown as current). */
  current: string | null;
  count: number;
  onClose: () => void;
  onPick: (target: string | null) => void;
  onCreate: (name: string, parentId: string | null) => Promise<DesignFolder | null>;
}) {
  const kids = childrenMap(folders);
  const [target, setTarget] = useState<string | null>(current);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(folderPath(folders, current).map((f) => f.id)));
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState("");

  const row = (f: DesignFolder | null, depth: number): ReactNode => {
    const id = f?.id ?? null;
    const children = kids.get(id ?? "") ?? [];
    const isOpen = id === null || expanded.has(id);
    const blocked = id !== null && exclude.has(id);
    return (
      <li key={id ?? "root"}>
        <div
          className={`flex items-center gap-1 rounded-lg pe-2 transition ${target === id ? "bg-brand-50 text-brand-ink" : blocked ? "opacity-40" : "hover:bg-neutral-50"}`}
          style={{ paddingInlineStart: depth * 16 }}
        >
          <button
            type="button"
            aria-label={isOpen ? tr("dashboard.collapse") : tr("dashboard.expand")}
            disabled={id === null || children.length === 0}
            onClick={() => id && setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
            className="grid h-7 w-6 shrink-0 place-items-center text-neutral-400 disabled:invisible"
          ><ChevronRight size={14} className={`transition ${isOpen ? "rotate-90" : ""}`} /></button>
          <button
            type="button"
            disabled={blocked}
            onClick={() => setTarget(id)}
            onDoubleClick={() => { if (!blocked) onPick(id); }}
            className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-start text-sm"
          >
            <FolderIcon size={15} className="shrink-0 text-brand-600" />
            <span className="truncate">{f ? f.name : tr("dashboard.projects")}</span>
            {id === current && <span className="ms-auto shrink-0 text-[11px] text-neutral-400">{tr("dashboard.current")}</span>}
          </button>
        </div>
        {isOpen && children.length > 0 && <ul>{children.map((c) => row(c, depth + 1))}</ul>}
      </li>
    );
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    const f = await onCreate(name, target);
    if (f) {
      setExpanded((s) => new Set([...s, ...(target ? [target] : [])]));
      setTarget(f.id);
    }
    setNaming(false);
    setNewName("");
  };

  return (
    <Modal open={open} onClose={onClose} title={tr("dashboard.move_n_items", { n: count })} width="w-[28rem]">
      <ul className="oc-scroll max-h-[50vh] overflow-y-auto rounded-xl border border-neutral-200 p-1">{row(null, 0)}</ul>
      <div className="mt-3 flex items-center gap-2">
        {naming ? (
          <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={tr("dashboard.folder_name")}
              maxLength={120}
              className="h-9 min-w-0 flex-1 rounded-lg border border-neutral-200 bg-surface px-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
            <Button type="submit" variant="ghost" disabled={!newName.trim()}>{tr("dashboard.create")}</Button>
          </form>
        ) : (
          <button type="button" onClick={() => setNaming(true)} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-neutral-600 transition hover:bg-neutral-100">
            <FolderPlus size={15} /> {tr("dashboard.new_folder")}
          </button>
        )}
        <span className="flex-1" />
        <Button variant="ghost" onClick={onClose}>{tr("dashboard.cancel")}</Button>
        <Button onClick={() => onPick(target)} disabled={target === current || (target !== null && exclude.has(target))}>{tr("dashboard.move")}</Button>
      </div>
    </Modal>
  );
}

/** Wraps any element as a drop target (e.g. the rail's "Projects" entry). */
export function DropZone({ onDropItems, children, className = "", overClassName = "rounded-xl ring-2 ring-brand-300" }: { onDropItems: (items: DragItems) => void; children: ReactNode; className?: string; overClassName?: string }) {
  const drop = useDropTarget(onDropItems);
  return <div {...drop.props} className={`${className} ${drop.over ? overClassName : ""}`}>{children}</div>;
}
