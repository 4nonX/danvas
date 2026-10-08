// Import from Canva (docs/roadmap/41-canva-import.md): pick designs and
// folders in the user's Canva library and bring them into the open dashboard
// folder, folder tree included.
//
// The run happens in this tab, one design at a time: Canva exports it (PPTX
// when every page supports it, else PNG pages), the browser downloads it
// through the server and converts it with the same importers as a file
// import, then the design is created, moved into its folder and recorded, so
// a second run skips it. Exports are paced under Canva's limits; a rate limit
// waits and carries on, the daily limit stops the run (run it again tomorrow).

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronRight, FileWarning, Folder, Link2, Loader2, Settings } from "lucide-react";
import type { CanvaConnection, CanvaItem, DesignFolder } from "@hc/sdk";
import { ApiError } from "@hc/sdk";
import { oc } from "@/lib/sdk";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { designFromFile } from "@/lib/importDesignFile";
import { ExportPacer, imagePagesDesign, planImport, type CanvaPick, type ImportPlan } from "@/lib/canvaImport";
import { tr } from "@/lib/i18n";

const ROOT: CanvaItem = { type: "folder", id: "root", name: "" };
const RATE_WAIT_MS = 60_000;
const POLL_MS = 2_000;
const EXPORT_TIMEOUT_MS = 15 * 60_000;
/** Rate limits in a row on one call before the run gives up on Canva. */
const MAX_RATE_RETRIES = 6;

type Result = { name: string; status: "imported" | "skipped" | "failed"; detail?: string };

const codeOf = (e: unknown) => (e instanceof ApiError ? (e.body as { code?: string } | null)?.code : undefined);

class StopRun extends Error {}

export function CanvaImportDialog({
  workspaceId, targetFolderId, folders, isAdmin, onClose, onChanged, onOpenSettings, errorMessage: errorMessageProp,
}: {
  workspaceId: string;
  targetFolderId: string | null;
  folders: DesignFolder[];
  isAdmin: boolean;
  onClose: () => void;
  /** Called after each step that changed folders or designs. */
  onChanged: () => void;
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
  const [running, setRunning] = useState(false);

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

  if (running) {
    return (
      <CanvaImportRun
        workspaceId={workspaceId}
        targetFolderId={targetFolderId}
        folders={folders}
        picks={[...picks.values()]}
        onChanged={onChanged}
        onClose={onClose}
        errorMessage={errorMessage}
      />
    );
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
      <p className="mt-3 text-xs text-neutral-500">{tr("dashboard.canva_run_hint")}</p>
      <div className="mt-4 flex items-center justify-end gap-2">
        <span className="me-auto text-xs text-neutral-500">
          {everything ? tr("dashboard.canva_everything_selected") : tr("dashboard.canva_n_selected", { count: picks.size })}
        </span>
        <Button variant="secondary" onClick={onClose}>{tr("dashboard.cancel")}</Button>
        <Button disabled={picks.size === 0} onClick={() => setRunning(true)}>{tr("dashboard.canva_import_selected")}</Button>
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

/** The import run: plan, then one design at a time. */
function CanvaImportRun({
  workspaceId, targetFolderId, folders, picks, onChanged, onClose, errorMessage,
}: {
  workspaceId: string;
  targetFolderId: string | null;
  folders: DesignFolder[];
  picks: CanvaPick[];
  onChanged: () => void;
  onClose: () => void;
  errorMessage: (e: unknown) => string;
}) {
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [current, setCurrent] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [done, setDone] = useState(false);
  const [halted, setHalted] = useState<string | null>(null);
  const stop = useRef(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const stopped = () => stop.current;
    const sleep = (ms: number) => new Promise<void>((r) => {
      const until = Date.now() + ms;
      const tick = () => (stop.current || Date.now() >= until ? r() : setTimeout(tick, 250));
      tick();
    });
    // A Canva call that waits out rate limits; the daily limit ends the run.
    const canva = async <T,>(call: () => Promise<T>): Promise<T> => {
      for (let attempt = 0; ; attempt++) {
        try {
          const out = await call();
          setWaiting(false);
          return out;
        } catch (e) {
          const code = codeOf(e);
          if (code === "canva_daily_limit") throw new StopRun(tr("dashboard.canva_daily_limit_reached"));
          if (code !== "canva_rate_limited") throw e;
          if (attempt >= MAX_RATE_RETRIES) throw new StopRun(tr("dashboard.canva_rate_limit_persistent"));
          setWaiting(true);
          await sleep(RATE_WAIT_MS);
          if (stop.current) throw new StopRun("");
        }
      }
    };

    void (async () => {
      try {
        setCurrent(tr("dashboard.canva_reading_folders"));
        const p = await planImport(picks, (id, c) => canva(() => oc.listCanvaFolder(workspaceId, id, c)), {
          stopped,
          untitled: { design: tr("dashboard.untitled"), folder: tr("dashboard.untitled") },
          onFolder: (name) => setCurrent(name ? tr("dashboard.canva_reading_folder", { name }) : tr("dashboard.canva_reading_folders")),
        });
        setPlan(p);
        if (stop.current) return;

        // Mirror the folders (existing ones of the same name are reused).
        const folderIds = new Map<string, string>();
        for (const f of folders) folderIds.set(`${f.parentId ?? ""}/${f.name.toLowerCase()}`, f.id);
        const ensureFolder = async (path: string[]): Promise<string | null> => {
          let parent = targetFolderId;
          for (const name of path) {
            const key = `${parent ?? ""}/${name.toLowerCase()}`;
            let id = folderIds.get(key);
            if (!id) {
              id = (await oc.createDesignFolder(workspaceId, { name, parentId: parent })).id;
              folderIds.set(key, id);
              onChanged();
            }
            parent = id;
          }
          return parent;
        };
        for (const path of p.folders) {
          if (stop.current) return;
          await ensureFolder(path);
        }

        const imported = await oc.canvaImported(workspaceId).catch(() => ({} as Record<string, string>));
        const pacer = new ExportPacer();
        for (const d of p.designs) {
          if (stop.current) break;
          const label = [...d.path, d.title].join(" / ");
          if (imported[d.id]) {
            setResults((r) => [...r, { name: label, status: "skipped" }]);
            continue;
          }
          setCurrent(label);
          try {
            await pacer.wait(stopped);
            if (stop.current) break;
            const exp = await canva(() => oc.startCanvaExport(workspaceId, d.id));
            const deadline = Date.now() + EXPORT_TIMEOUT_MS;
            let st = await canva(() => oc.getCanvaExport(workspaceId, exp.jobId));
            while (st.status === "in_progress") {
              if (Date.now() > deadline) throw new Error(tr("dashboard.canva_export_timed_out"));
              await sleep(POLL_MS);
              if (stop.current) throw new StopRun("");
              st = await canva(() => oc.getCanvaExport(workspaceId, exp.jobId));
            }
            if (st.status !== "success" || st.files === 0) throw new Error(tr("dashboard.canva_export_failed", { reason: st.error ?? st.status }));
            const blobs: Blob[] = [];
            for (let i = 0; i < st.files; i++) blobs.push(await canva(() => oc.canvaExportFile(workspaceId, exp.jobId, i)));
            const file = exp.format === "pptx"
              ? { ...(await designFromFile(new File([blobs[0]], `${d.title}.pptx`, { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }))).file, title: d.title }
              : await imagePagesDesign(d.title, blobs);
            const folderId = await ensureFolder(d.path);
            const rec = await oc.createDesign({ workspaceId, title: d.title, from: file });
            if (folderId) await oc.moveToFolder(workspaceId, { designIds: [rec.id], folderId });
            await oc.recordCanvaImport(workspaceId, d.id, rec.id).catch(() => undefined);
            setResults((r) => [...r, { name: label, status: "imported", detail: exp.format === "png" ? tr("dashboard.canva_as_images") : undefined }]);
            onChanged();
          } catch (e) {
            if (e instanceof StopRun) throw e;
            setResults((r) => [...r, { name: label, status: "failed", detail: errorMessage(e) }]);
          }
        }
      } catch (e) {
        if (e instanceof StopRun) {
          if (e.message) setHalted(e.message);
        } else {
          setHalted(errorMessage(e));
        }
      } finally {
        setWaiting(false);
        setCurrent("");
        setDone(true);
      }
    })();
    // Runs once for the selection the dialog was started with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = plan?.designs.length ?? 0;
  const count = (s: Result["status"]) => results.filter((r) => r.status === s).length;
  const failed = results.filter((r) => r.status === "failed");
  const images = results.filter((r) => r.status === "imported" && r.detail);
  const pct = total ? Math.round((results.length / total) * 100) : done ? 100 : 0;

  return (
    <Modal open onClose={() => { if (done) onClose(); }} title={tr("dashboard.import_from_canva")} width="w-[34rem]">
      <div className="mb-2 flex items-center justify-between text-sm text-neutral-600">
        <span>{plan ? tr("dashboard.canva_n_of_m_designs", { n: results.length, m: total }) : tr("dashboard.canva_reading_folders")}</span>
        <span className="tabular-nums text-neutral-400">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
        <div className="h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 flex min-h-5 items-center gap-1.5 truncate text-xs text-neutral-500">
        {!done && <Loader2 size={13} className="shrink-0 animate-spin" />}
        <span className="truncate">
          {done
            ? halted ?? (stop.current ? tr("dashboard.import_stopped") : tr("dashboard.import_finished"))
            : waiting ? tr("dashboard.canva_waiting_rate_limit") : current}
        </span>
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-emerald-50 py-2"><div className="text-lg font-semibold text-emerald-700">{count("imported")}</div><div className="text-[11px] text-emerald-700">{tr("dashboard.imported")}</div></div>
        <div className="rounded-xl bg-neutral-100 py-2"><div className="text-lg font-semibold text-neutral-700">{count("skipped")}</div><div className="text-[11px] text-neutral-500">{tr("dashboard.canva_already_imported")}</div></div>
        <div className="rounded-xl bg-red-50 py-2"><div className="text-lg font-semibold text-red-700">{count("failed")}</div><div className="text-[11px] text-red-700">{tr("dashboard.failed")}</div></div>
      </div>
      {images.length > 0 && (
        <p className="mt-3 text-xs text-neutral-500">{tr("dashboard.canva_n_as_images", { count: images.length })}</p>
      )}
      {failed.length > 0 && (
        <ul className="oc-scroll mt-3 max-h-40 overflow-y-auto rounded-xl border border-red-100 p-2 text-xs">
          {failed.map((r, i) => (
            <li key={`${r.name}-${i}`} className="flex gap-1.5 py-0.5 text-red-700">
              <FileWarning size={13} className="mt-0.5 shrink-0" />
              <span className="min-w-0"><span className="font-medium">{r.name}</span>{r.detail ? `: ${r.detail}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
      {done && failed.length > 0 && <p className="mt-2 text-xs text-neutral-500">{tr("dashboard.canva_rerun_hint")}</p>}
      <div className="mt-5 flex justify-end gap-2">
        {done ? (
          <Button onClick={onClose}><CheckCircle2 size={16} /> {tr("dashboard.done")}</Button>
        ) : (
          <Button variant="ghost" onClick={() => { stop.current = true; }}>{tr("dashboard.stop_import")}</Button>
        )}
      </div>
    </Modal>
  );
}
