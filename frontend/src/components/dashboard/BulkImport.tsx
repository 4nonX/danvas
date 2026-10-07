// Bulk import into Projects: many design files at once (.pptx from a Canva
// export, .odp, .md, .hyc), optionally as a whole folder tree. Sub-folders of
// the picked or dropped folder become dashboard folders under the folder that
// is open, existing folders of the same name are reused, and a design whose
// title already exists in its target folder is skipped, so an interrupted or
// repeated migration can simply be run again.

import { useEffect, useRef, useState, type DragEvent } from "react";
import { CheckCircle2, FileWarning, Loader2 } from "lucide-react";
import type { DesignFolder, HomeItem } from "@hc/sdk";
import { oc } from "@/lib/sdk";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { designFromFile, isImportableName } from "@/lib/importDesignFile";
import { tr } from "@/lib/i18n";

/** One file to import and the folder path (relative to the target) it goes to. */
export interface ImportEntry {
  file: File;
  path: string[];
}

/** Entries from an <input type="file"> (with or without webkitdirectory). */
export function entriesFromInput(list: FileList | null): ImportEntry[] {
  return [...(list ?? [])]
    .filter((f) => isImportableName(f.name))
    .map((file) => {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
      const parts = rel.split("/").filter(Boolean);
      return { file, path: parts.slice(0, -1) };
    });
}

/** Whether a drag carries files from the operating system. */
export function hasOsFiles(e: DragEvent): boolean {
  return e.dataTransfer.types.includes("Files");
}

/** Entries from an OS drop: files and whole folders (read recursively). */
export async function entriesFromDrop(e: DragEvent): Promise<ImportEntry[]> {
  const roots = [...e.dataTransfer.items]
    .map((it) => (it.kind === "file" ? (it as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.() ?? null : null))
    .filter((x): x is FileSystemEntry => !!x);
  if (!roots.length) return entriesFromInput(e.dataTransfer.files);
  const out: ImportEntry[] = [];
  const walk = async (entry: FileSystemEntry, path: string[]): Promise<void> => {
    if (entry.isFile) {
      if (!isImportableName(entry.name)) return;
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ file, path });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns at most ~100 entries per call: read until empty.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const child of batch) await walk(child, [...path, entry.name]);
      }
    }
  };
  for (const r of roots) await walk(r, []);
  return out;
}

type Result = { name: string; status: "imported" | "skipped" | "failed"; detail?: string };

export function BulkImportDialog({
  entries, workspaceId, targetFolderId, folders, designs, onClose, onChanged, errorMessage,
}: {
  entries: ImportEntry[];
  workspaceId: string;
  targetFolderId: string | null;
  folders: DesignFolder[];
  designs: HomeItem[];
  onClose: () => void;
  /** Called after each step that changed folders or designs. */
  onChanged: () => void;
  errorMessage: (e: unknown) => string;
}) {
  const [results, setResults] = useState<Result[]>([]);
  const [current, setCurrent] = useState<string>("");
  const [done, setDone] = useState(false);
  const cancelled = useRef(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      // Folder ids by "<parentId>/<lowercased name>", seeded with what exists.
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
      // Titles already present per folder, for skip-on-rerun.
      const existing = new Map<string, Set<string>>();
      for (const d of designs) {
        const k = d.folderId ?? "";
        if (!existing.has(k)) existing.set(k, new Set());
        existing.get(k)!.add(d.title.trim().toLowerCase());
      }
      for (const entry of entries) {
        if (cancelled.current) break;
        const label = [...entry.path, entry.file.name].join(" / ");
        setCurrent(label);
        try {
          const folderId = await ensureFolder(entry.path);
          const { file, title } = await designFromFile(entry.file);
          const seen = existing.get(folderId ?? "") ?? new Set<string>();
          if (seen.has(title.trim().toLowerCase())) {
            setResults((r) => [...r, { name: label, status: "skipped" }]);
            continue;
          }
          const rec = await oc.createDesign({ workspaceId, title, from: file });
          if (folderId) await oc.moveToFolder(workspaceId, { designIds: [rec.id], folderId });
          seen.add(title.trim().toLowerCase());
          existing.set(folderId ?? "", seen);
          setResults((r) => [...r, { name: label, status: "imported" }]);
          onChanged();
        } catch (e) {
          setResults((r) => [...r, { name: label, status: "failed", detail: errorMessage(e) }]);
        }
      }
      setCurrent("");
      setDone(true);
    })();
    // Runs once for the entries the dialog was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const count = (s: Result["status"]) => results.filter((r) => r.status === s).length;
  const failed = results.filter((r) => r.status === "failed");
  const pct = entries.length ? Math.round((results.length / entries.length) * 100) : 100;

  return (
    <Modal open onClose={() => { if (done) onClose(); }} title={tr("dashboard.bulk_import")} width="w-[34rem]">
      <div className="mb-2 flex items-center justify-between text-sm text-neutral-600">
        <span>{tr("dashboard.n_of_m_files", { n: results.length, m: entries.length })}</span>
        <span className="tabular-nums text-neutral-400">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
        <div className="h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 flex min-h-5 items-center gap-1.5 truncate text-xs text-neutral-500">
        {!done && <Loader2 size={13} className="shrink-0 animate-spin" />}
        <span className="truncate">{done ? (cancelled.current ? tr("dashboard.import_stopped") : tr("dashboard.import_finished")) : current}</span>
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-emerald-50 py-2"><div className="text-lg font-semibold text-emerald-700">{count("imported")}</div><div className="text-[11px] text-emerald-700">{tr("dashboard.imported")}</div></div>
        <div className="rounded-xl bg-neutral-100 py-2"><div className="text-lg font-semibold text-neutral-700">{count("skipped")}</div><div className="text-[11px] text-neutral-500">{tr("dashboard.skipped_existing")}</div></div>
        <div className="rounded-xl bg-red-50 py-2"><div className="text-lg font-semibold text-red-700">{count("failed")}</div><div className="text-[11px] text-red-700">{tr("dashboard.failed")}</div></div>
      </div>
      {failed.length > 0 && (
        <ul className="oc-scroll mt-3 max-h-40 overflow-y-auto rounded-xl border border-red-100 p-2 text-xs">
          {failed.map((r) => (
            <li key={r.name} className="flex gap-1.5 py-0.5 text-red-700">
              <FileWarning size={13} className="mt-0.5 shrink-0" />
              <span className="min-w-0"><span className="font-medium">{r.name}</span>{r.detail ? `: ${r.detail}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex justify-end gap-2">
        {done ? (
          <Button onClick={onClose}><CheckCircle2 size={16} /> {tr("dashboard.done")}</Button>
        ) : (
          <Button variant="ghost" onClick={() => { cancelled.current = true; }}>{tr("dashboard.stop_import")}</Button>
        )}
      </div>
    </Modal>
  );
}
