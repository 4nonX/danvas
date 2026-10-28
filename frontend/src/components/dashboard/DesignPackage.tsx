// danvas packages in the dashboard (lib/designPackage): export the selected
// designs and folders, or templates, as a .danvas.zip with their uploads and
// fonts, and import such a package (designs into the open folder, templates
// as templates of the workspace), for taking designs to another
// danvas instance. Import skips a design whose title already exists in its
// target folder, like the bulk import, so a repeated import adds nothing twice.

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileWarning, Loader2, Package } from "lucide-react";
import type { DesignFile } from "@hc/schema";
import type { DesignFolder, HomeItem, UploadedAsset } from "@hc/sdk";
import { ApiError } from "@hc/sdk";
import { directUploadWithProgress, oc, resolveAssetUrl } from "@/lib/sdk";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { userMessage } from "@/lib/errors";
import { formatDate } from "@/lib/datetime";
import { useAuth } from "@/store/auth";
import {
  exportPackage, fontKey, importPackage, packageFileName, packageItems, readPackage,
  type PackageExport, type PackageImportResult, type PackageTemplateItem, type ParsedPackage,
} from "@/lib/designPackage";
import { tr } from "@/lib/i18n";

async function bytesOf(url: string): Promise<Uint8Array> {
  const res = await fetch(resolveAssetUrl(url), { credentials: "include" });
  if (!res.ok) throw new Error(`asset ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <>
      <div className="mb-2 flex items-center justify-between text-sm text-neutral-600">
        <span className="min-w-0 truncate">{label}</span>
        <span className="tabular-nums text-neutral-400">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
        <div className="h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </>
  );
}

/** Export: runs once when opened and downloads the package. */
export function PackageExportDialog({ workspaceId, designIds = [], folderIds = [], templates = [], onClose }: {
  workspaceId: string;
  designIds?: string[];
  folderIds?: string[];
  /** Templates to take along (their uploads come from this workspace). */
  templates?: PackageTemplateItem[];
  onClose: () => void;
}) {
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [result, setResult] = useState<PackageExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        // The full lists, not the dashboard's view of them (a search shows only part).
        const needDesigns = designIds.length + folderIds.length > 0;
        const [designs, folders, assetList, fonts] = await Promise.all([
          needDesigns ? oc.home(workspaceId, "recent") : Promise.resolve([]),
          needDesigns ? oc.listDesignFolders(workspaceId) : Promise.resolve([]),
          oc.listAssets(workspaceId) as Promise<UploadedAsset[]>,
          oc.listWorkspaceFonts(workspaceId).catch(() => []),
        ]);
        const items = packageItems(designIds, folderIds, designs, folders);
        if (!items.length && !templates.length) { setError(tr("dashboard.package_nothing")); return; }
        const assets = new Map(assetList.map((a) => [a.id.toLowerCase(), a]));
        const res = await exportPackage(items, {
          designFile: (id) => oc.getDesignFile(id),
          templateFile: (id) => oc.getTemplateFile(id),
          assets,
          assetBytes: (id) => bytesOf(assets.get(id)!.url),
          fonts,
          fontBytes: (id) => oc.workspaceFontFile(id),
          onProgress: (done, total) => setProgress({ done, total }),
        }, new Date(), templates);
        const label = items.length === 1 && !templates.length ? items[0].title
          : templates.length === 1 && !items.length ? templates[0].title
          : folderIds.length === 1 && !designIds.length && !templates.length ? folders.find((f) => f.id === folderIds[0])?.name ?? null
          : null;
        const href = URL.createObjectURL(res.blob);
        const a = document.createElement("a");
        a.href = href;
        a.download = packageFileName(label);
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 60_000);
        setResult(res);
      } catch (e) {
        setError(userMessage(e, tr("dashboard.package_export_failed")));
      }
    })();
    // Runs once for the selection the dialog was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const done = !!result || !!error;
  return (
    <Modal open onClose={() => { if (done) onClose(); }} title={tr("dashboard.package_export_title")} width="w-[30rem]">
      {!done && <Progress done={progress.done} total={progress.total} label={tr("dashboard.package_reading_designs", { n: progress.done, m: progress.total || "…" })} />}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {result && (
        <div className="flex flex-col gap-2 text-sm text-neutral-700">
          <p className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-600" /> {result.templates
            ? tr("dashboard.package_exported_templates", { designs: result.designs, templates: result.templates, assets: result.assets, fonts: result.fonts })
            : tr("dashboard.package_exported", { designs: result.designs, assets: result.assets, fonts: result.fonts })}</p>
          {result.failedDesigns.length > 0 && <p className="text-xs text-red-600">{tr("dashboard.package_designs_left_out", { titles: result.failedDesigns.join(", ") })}</p>}
          {result.missingAssets > 0 && <p className="text-xs text-amber-700">{tr("dashboard.package_assets_left_out", { count: result.missingAssets })}</p>}
          <p className="text-xs text-neutral-500">{tr("dashboard.package_export_hint")}</p>
        </div>
      )}
      <div className="mt-5 flex justify-end">
        <Button onClick={onClose} disabled={!done}>{done ? <CheckCircle2 size={16} /> : <Loader2 size={16} className="animate-spin" />} {tr("dashboard.done")}</Button>
      </div>
    </Modal>
  );
}

/** Import: reads the package, shows what it holds, imports on confirmation. */
export function PackageImportDialog({ file, workspaceId, targetFolderId, canPublishTemplates = false, onClose, onChanged }: {
  file: File;
  workspaceId: string;
  targetFolderId: string | null;
  /** The caller may publish templates here; otherwise a package's templates
   *  are reported as not imported. */
  canPublishTemplates?: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [parsed, setParsed] = useState<ParsedPackage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string }>({ done: 0, total: 0, label: "" });
  const [result, setResult] = useState<PackageImportResult | null>(null);
  const user = useAuth((s) => s.user);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const p = await readPackage(new Uint8Array(await file.arrayBuffer()));
        if (!cancelled) setParsed(p);
      } catch (e) {
        if (!cancelled) setError(userMessage(e, tr("dashboard.package_not_readable")));
      }
    })();
    return () => { cancelled = true; };
  }, [file]);

  async function run() {
    if (!parsed) return;
    setRunning(true);
    try {
      const [folders, designs, fonts, existingTemplates] = await Promise.all([
        oc.listDesignFolders(workspaceId),
        oc.home(workspaceId, "recent") as Promise<HomeItem[]>,
        oc.listWorkspaceFonts(workspaceId).catch(() => []),
        parsed.templates.length ? oc.listTemplates({ workspaceId }).catch(() => []) : Promise.resolve([]),
      ]);
      const templateTitles = new Set(existingTemplates.map((t) => t.title.trim().toLowerCase()));
      // Folder ids by "<parentId>/<lowercased name>", seeded with what exists
      // (an existing folder of the same name is used, as in the bulk import).
      const folderIds = new Map<string, string>();
      for (const f of folders as DesignFolder[]) folderIds.set(`${f.parentId ?? ""}/${f.name.toLowerCase()}`, f.id);
      const titles = new Map<string, Set<string>>();
      for (const d of designs) {
        const k = d.folderId ?? "";
        if (!titles.has(k)) titles.set(k, new Set());
        titles.get(k)!.add(d.title.trim().toLowerCase());
      }
      const res = await importPackage(parsed, {
        uploadAsset: async (f, filename) => {
          const a = await directUploadWithProgress(workspaceId, f, { filename });
          return { id: a.id, url: a.url };
        },
        uploadFont: async (f, face) => {
          try {
            await oc.uploadWorkspaceFont(workspaceId, f, { ...face, fileName: f.name });
          } catch (e) {
            // The same file is already a workspace font.
            if (!(e instanceof ApiError && e.status === 409)) throw e;
          }
        },
        hasFonts: new Set(fonts.map(fontKey)),
        folderFor: async (path) => {
          let parent = targetFolderId;
          for (const name of path) {
            const key = `${parent ?? ""}/${name.toLowerCase()}`;
            let id = folderIds.get(key);
            if (!id) {
              id = (await oc.createDesignFolder(workspaceId, { name, parentId: parent })).id;
              folderIds.set(key, id);
            }
            parent = id;
          }
          return parent;
        },
        exists: (folderId, title) => titles.get(folderId ?? "")?.has(title.trim().toLowerCase()) ?? false,
        createDesign: async (title, f, folderId) => {
          const rec = await oc.createDesign({ workspaceId, title, from: f });
          if (folderId) await oc.moveToFolder(workspaceId, { designIds: [rec.id], folderId });
          const k = folderId ?? "";
          if (!titles.has(k)) titles.set(k, new Set());
          titles.get(k)!.add(title.trim().toLowerCase());
        },
        ...(canPublishTemplates ? {
          createTemplate: async (title: string, f: DesignFile, categories: string[]) => {
            await oc.saveAsTemplate({ workspaceId, file: f, title, visibility: "workspace", ...(categories[0] ? { category: categories[0] } : {}) });
            templateTitles.add(title.trim().toLowerCase());
          },
        } : {}),
        templateExists: (title) => templateTitles.has(title.trim().toLowerCase()),
        onProgress: (done, total, label) => setProgress({ done, total, label }),
      });
      setResult(res);
      onChanged();
    } catch (e) {
      setError(userMessage(e, tr("dashboard.package_import_failed")));
    } finally {
      setRunning(false);
    }
  }

  const all = [...(result?.designs ?? []), ...(result?.templates ?? [])];
  const count = (s: "imported" | "skipped" | "failed") => all.filter((d) => d.status === s).length;
  const failed = all.filter((d) => d.status === "failed");
  const m = parsed?.manifest;
  return (
    <Modal open onClose={() => { if (!running) onClose(); }} title={tr("dashboard.package_import_title")} width="w-[32rem]">
      {!parsed && !error && <p className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 size={14} className="animate-spin" /> {tr("dashboard.package_reading")}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {m && !result && !running && (
        <div className="flex flex-col gap-2 text-sm text-neutral-700">
          <p className="flex items-center gap-2 font-medium"><Package size={16} className="text-neutral-500" /> {file.name}</p>
          <p>{m.templates?.length
            ? tr("dashboard.package_holds_templates", { designs: m.designs.length, templates: m.templates.length, assets: m.assets.length, fonts: m.fonts.length })
            : tr("dashboard.package_holds", { designs: m.designs.length, assets: m.assets.length, fonts: m.fonts.length })}</p>
          {!!m.templates?.length && !canPublishTemplates && <p className="text-xs text-amber-700">{tr("dashboard.package_templates_no_right")}</p>}
          {m.exportedAt && <p className="text-xs text-neutral-500">{tr("dashboard.package_exported_at", { date: formatDate(m.exportedAt, user) })}</p>}
          <p className="text-xs text-neutral-500">{tr("dashboard.package_import_hint")}</p>
        </div>
      )}
      {running && <Progress done={progress.done} total={progress.total} label={progress.label} />}
      {result && (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-emerald-50 py-2"><div className="text-lg font-semibold text-emerald-700">{count("imported")}</div><div className="text-[11px] text-emerald-700">{tr("dashboard.imported")}</div></div>
            <div className="rounded-xl bg-neutral-100 py-2"><div className="text-lg font-semibold text-neutral-700">{count("skipped")}</div><div className="text-[11px] text-neutral-500">{tr("dashboard.skipped_existing")}</div></div>
            <div className="rounded-xl bg-red-50 py-2"><div className="text-lg font-semibold text-red-700">{count("failed")}</div><div className="text-[11px] text-red-700">{tr("dashboard.failed")}</div></div>
          </div>
          {m && result.assets < m.assets.length && <p className="mt-2 text-xs text-amber-700">{tr("dashboard.package_assets_not_uploaded", { count: m.assets.length - result.assets })}</p>}
          {result.missingFonts.length > 0 && <p className="mt-2 text-xs text-amber-700">{tr("dashboard.package_fonts_not_added", { families: result.missingFonts.join(", ") })}</p>}
          {failed.length > 0 && (
            <ul className="oc-scroll mt-3 max-h-40 overflow-y-auto rounded-xl border border-red-100 p-2 text-xs">
              {failed.map((r, i) => (
                <li key={`${r.title}-${i}`} className="flex gap-1.5 py-0.5 text-red-700">
                  <FileWarning size={13} className="mt-0.5 shrink-0" />
                  <span className="min-w-0"><span className="font-medium">{r.title}</span>: {userMessage(r.error, tr("dashboard.package_import_failed"))}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="mt-5 flex justify-end gap-2">
        {result || error ? (
          <Button onClick={onClose}><CheckCircle2 size={16} /> {tr("dashboard.done")}</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={running}>{tr("dashboard.cancel")}</Button>
            <Button onClick={() => void run()} disabled={!parsed || running}>{running ? <Loader2 size={16} className="animate-spin" /> : <Package size={16} />} {tr("dashboard.package_import_action")}</Button>
          </>
        )}
      </div>
    </Modal>
  );
}
