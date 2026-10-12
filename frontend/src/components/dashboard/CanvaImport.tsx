// Import from Canva (docs/roadmap/41-canva-import.md): pick designs and
// folders in the user's Canva library and bring them into the open dashboard
// folder, folder tree included.
//
// Starting the import queues it on the server (store/canvaImport.ts), which
// runs it with this dialog, the tab or the browser closed; its progress shows
// on every page (CanvaImportProgress). A run started while another is going
// waits for it.

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Folder, Link2, Loader2, Settings } from "lucide-react";
import type { CanvaConnection, CanvaItem } from "@hc/sdk";
import { oc } from "@/lib/sdk";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { CanvaPick } from "@/lib/canvaImport";
import { useCanvaImport } from "@/store/canvaImport";
import { tr } from "@/lib/i18n";

const ROOT: CanvaItem = { type: "folder", id: "root", name: "" };

export function CanvaImportDialog({
  workspaceId, targetFolderId, isAdmin, onClose, onOpenSettings, errorMessage: errorMessageProp,
}: {
  workspaceId: string;
  targetFolderId: string | null;
  isAdmin: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  errorMessage: (e: unknown) => string;
}) {
  // The caller's errorMessage may be a new function each render; effects and
  // the folder loaders key on a stable one, or they would reload forever.
  const errorRef = useRef(errorMessageProp);
  useEffect(() => { errorRef.current = errorMessageProp; });
  const errorMessage = useCallback((e: unknown) => errorRef.current(e), []);
  const [conn, setConn] = useState<CanvaConnection | null>(null);
  const [connError, setConnError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Map<string, CanvaPick>>(new Map());
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    oc.getCanvaConnection(workspaceId).then(
      (c) => { if (!cancelled) setConn(c); },
      (e) => { if (!cancelled) setConnError(errorMessage(e)); },
    );
    return () => { cancelled = true; };
  }, [workspaceId, errorMessage]);

  async function connect() {
    try {
      const returnTo = `${window.location.pathname}${window.location.search}`;
      const { authorizeUrl } = await oc.connectCanva(workspaceId, returnTo);
      window.location.assign(authorizeUrl);
    } catch (e) {
      setConnError(errorMessage(e));
    }
  }

  const toggle = useCallback((pick: CanvaPick) => {
    setPicks((m) => {
      const next = new Map(m);
      if (next.has(pick.item.id)) next.delete(pick.item.id);
      else next.set(pick.item.id, pick);
      return next;
    });
  }, []);

  async function startImport() {
    setStarting(true);
    setStartError(null);
    try {
      await useCanvaImport.getState().start({ workspaceId, targetFolderId, picks: [...picks.values()] });
      onClose();
    } catch (e) {
      setStartError(errorMessage(e));
      setStarting(false);
    }
  }

  const title = tr("dashboard.import_from_canva");
  if (connError) {
    return (
      <Modal open onClose={onClose} title={title} width="w-[34rem]">
        <p className="text-sm text-red-700">{connError}</p>
        <div className="mt-5 flex justify-end"><Button variant="secondary" onClick={onClose}>{tr("dashboard.cancel")}</Button></div>
      </Modal>
    );
  }
  if (!conn) {
    return (
      <Modal open onClose={onClose} title={title} width="w-[34rem]">
        <p className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 size={14} className="animate-spin" /> {tr("dashboard.loading")}</p>
      </Modal>
    );
  }
  if (!conn.configured) {
    return (
      <Modal open onClose={onClose} title={title} width="w-[34rem]">
        <p className="text-sm text-neutral-600">{isAdmin ? tr("dashboard.canva_not_set_up_admin") : tr("dashboard.canva_integration_missing_member")}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{tr("dashboard.cancel")}</Button>
          {isAdmin && <Button onClick={onOpenSettings}><Settings size={15} /> {tr("dashboard.canva_open_settings")}</Button>}
        </div>
      </Modal>
    );
  }
  if (!conn.connected) {
    return (
      <Modal open onClose={onClose} title={title} width="w-[34rem]">
        <p className="text-sm text-neutral-600">{tr("dashboard.canva_connect_hint")}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{tr("dashboard.cancel")}</Button>
          <Button onClick={() => void connect()}><Link2 size={15} /> {tr("dashboard.canva_connect")}</Button>
        </div>
      </Modal>
    );
  }

  const everything = picks.has("root");
  return (
    <Modal open onClose={onClose} title={title} width="w-[40rem]">
      <p className="mb-3 text-xs text-neutral-500">
        {conn.displayName ? tr("dashboard.canva_connected_as", { name: conn.displayName }) : tr("dashboard.canva_connected")}
        {" · "}
        {tr("dashboard.canva_pick_hint")}
      </p>
      <label className="mb-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50">
        <input type="checkbox" checked={everything} onChange={() => toggle({ item: ROOT, ancestors: [] })} className="h-4 w-4 accent-brand-600" />
        {tr("dashboard.canva_everything")}
      </label>
      <div className="oc-scroll max-h-[50vh] overflow-y-auto rounded-xl border border-neutral-200 p-1">
        <CanvaFolderList workspaceId={workspaceId} folderId="root" ancestors={["root"]} picks={picks} onToggle={toggle} errorMessage={errorMessage} />
      </div>
      <p className="mt-3 text-xs text-neutral-500">{tr("dashboard.canva_server_run_hint")}</p>
      {startError && <p className="mt-2 text-xs text-red-700">{startError}</p>}
      <div className="mt-4 flex items-center justify-end gap-2">
        <span className="me-auto text-xs text-neutral-500">
          {everything ? tr("dashboard.canva_everything_selected") : tr("dashboard.canva_n_selected", { count: picks.size })}
        </span>
        <Button variant="secondary" onClick={onClose}>{tr("dashboard.cancel")}</Button>
        <Button disabled={picks.size === 0 || starting} onClick={() => void startImport()}>
          {starting && <Loader2 size={15} className="animate-spin" />} {tr("dashboard.canva_import_selected")}
        </Button>
      </div>
    </Modal>
  );
}

/** One folder's entries, loaded when shown; sub-folders expand in place. */
function CanvaFolderList({
  workspaceId, folderId, ancestors, picks, onToggle, errorMessage,
}: {
  workspaceId: string;
  folderId: string;
  ancestors: string[];
  picks: Map<string, CanvaPick>;
  onToggle: (p: CanvaPick) => void;
  errorMessage: (e: unknown) => string;
}) {
  const [items, setItems] = useState<CanvaItem[] | null>(null);
  const [cont, setCont] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  // Loads a page; the first one (no continuation) replaces what is shown.
  const fetchPage = useCallback((continuation?: string) => oc.listCanvaFolder(workspaceId, folderId, continuation).then(
    (page) => {
      setItems((cur) => [...(continuation ? cur ?? [] : []), ...page.items]);
      setCont(page.continuation || undefined);
      setLoading(false);
    },
    (e) => {
      setError(errorMessage(e));
      setLoading(false);
    },
  ), [workspaceId, folderId, errorMessage]);
  const load = (continuation?: string) => {
    setLoading(true);
    setError(null);
    void fetchPage(continuation);
  };

  useEffect(() => { void fetchPage(); }, [fetchPage]);

  // A ticked folder above covers everything here: shown ticked, not editable.
  const covered = ancestors.some((a) => picks.get(a)?.item.type === "folder");

  if (error) {
    return (
      <p className="flex items-center gap-2 px-2 py-1 text-xs text-red-700">
        {error}
        <button type="button" onClick={() => void load()} className="font-medium underline">{tr("dashboard.retry")}</button>
      </p>
    );
  }
  if (!items) {
    return <p className="flex items-center gap-1.5 px-2 py-1 text-xs text-neutral-400"><Loader2 size={12} className="animate-spin" /> {tr("dashboard.loading")}</p>;
  }
  if (!items.length) return <p className="px-2 py-1 text-xs text-neutral-400">{tr("dashboard.canva_folder_empty")}</p>;

  return (
    <ul>
      {items.map((it) => {
        const checked = covered || picks.has(it.id);
        const isOpen = open.has(it.id);
        return (
          <li key={`${it.type}:${it.id}`}>
            <div className="flex items-center gap-1.5 rounded-lg px-1 py-1 hover:bg-neutral-50">
              {it.type === "folder" ? (
                <button
                  type="button"
                  aria-label={isOpen ? tr("dashboard.collapse") : tr("dashboard.expand")}
                  aria-expanded={isOpen}
                  onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(it.id)) n.delete(it.id); else n.add(it.id); return n; })}
                  className="grid h-5 w-5 shrink-0 place-items-center rounded text-neutral-500 hover:bg-neutral-200"
                >
                  <ChevronRight size={14} className={`transition-transform ${isOpen ? "rotate-90" : ""}`} />
                </button>
              ) : (
                <span className="w-5 shrink-0" />
              )}
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm text-neutral-800">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={covered}
                  onChange={() => onToggle({ item: it, ancestors })}
                  className="h-4 w-4 shrink-0 accent-brand-600"
                />
                {it.type === "folder" ? (
                  <Folder size={16} className="shrink-0 text-neutral-400" />
                ) : it.thumbnail ? (
                  // Canva's own thumbnail URL, shown as is (static export, no image optimizer).
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.thumbnail} alt="" referrerPolicy="no-referrer" loading="lazy" className="h-7 w-10 shrink-0 rounded border border-neutral-200 object-cover" />
                ) : (
                  <span className="h-7 w-10 shrink-0 rounded border border-neutral-200 bg-neutral-100" />
                )}
                <span className="min-w-0 flex-1 truncate">{it.name || tr("dashboard.untitled")}</span>
                {it.type === "design" && it.pageCount ? (
                  <span className="shrink-0 text-[11px] text-neutral-400">{tr("dashboard.canva_n_pages", { count: it.pageCount })}</span>
                ) : null}
              </label>
            </div>
            {it.type === "folder" && isOpen && (
              <div className="ms-5 border-s border-neutral-100 ps-1">
                <CanvaFolderList
                  workspaceId={workspaceId}
                  folderId={it.id}
                  ancestors={[...ancestors, it.id]}
                  picks={picks}
                  onToggle={onToggle}
                  errorMessage={errorMessage}
                />
              </div>
            )}
          </li>
        );
      })}
      {cont && (
        <li>
          <button type="button" disabled={loading} onClick={() => void load(cont)} className="px-2 py-1 text-xs font-medium text-brand-ink hover:underline">
            {loading ? tr("dashboard.loading") : tr("dashboard.load_more")}
          </button>
        </li>
      )}
    </ul>
  );
}
