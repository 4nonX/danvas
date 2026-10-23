// Export a brand kit as a `.brandkit.zip` and import one (brand managers). The
// file format lives in lib/brandKitFile.ts and docs/brand-kit-format.md.
//
// An import whose name is already taken asks first: replace the existing kit
// (its current state stays in the version history) or keep both and import
// under another name.

import { useCallback, useMemo, useRef, useState } from "react";
import { Download, Upload, Loader2 } from "lucide-react";
import { ApiError, type BrandKit, type UploadedAsset } from "@hc/sdk";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { directUploadWithProgress, oc, resolveAssetUrl } from "@/lib/sdk";
import { tr } from "@/lib/i18n";
import { userMessage } from "@/lib/errors";
import { formatDate } from "@/lib/datetime";
import { useAuth } from "@/store/auth";
import {
  exportKit, freeKitName, kitFileSummary, kitNamed, kitSummary, readKitFile, sha256, uploadKitContent,
  type ParsedKitFile,
} from "@/lib/brandKitFile";

async function assetMap(workspaceId: string): Promise<Map<string, UploadedAsset>> {
  const list = (await oc.listAssets(workspaceId)) as UploadedAsset[];
  return new Map(list.map((a) => [a.id, a]));
}

async function bytesOf(url: string): Promise<Uint8Array> {
  const res = await fetch(resolveAssetUrl(url), { credentials: "include" });
  if (!res.ok) throw new Error(`asset ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export function BrandKitTransfer({
  workspaceId,
  kit,
  kits,
  onImported,
}: {
  workspaceId: string;
  /** The kit shown in the panel (exported at its latest version). */
  kit: BrandKit | null;
  kits: BrandKit[];
  onImported: (kit: BrandKit, replaced: boolean) => void | Promise<void>;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [reading, setReading] = useState(false);
  const [parsed, setParsed] = useState<ParsedKitFile | null>(null);

  const doExport = useCallback(async () => {
    if (!kit) return;
    setExporting(true);
    try {
      const [latest, assets, fonts] = await Promise.all([oc.getBrandKit(kit.id), assetMap(workspaceId), oc.listWorkspaceFonts(workspaceId)]);
      const res = await exportKit(latest, {
        assets,
        assetBytes: (id) => {
          const a = assets.get(id);
          if (!a) return Promise.reject(new Error("unknown asset"));
          return bytesOf(a.url);
        },
        fonts,
        fontBytes: (id) => oc.workspaceFontFile(id),
      });
      const href = URL.createObjectURL(res.blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = res.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
      if (res.missing.length) toast.toast(tr("editor.brandkit_export_missing", { count: res.missing.length }), "info");
      else toast.success(tr("editor.brandkit_exported"));
    } catch (e) {
      toast.error(userMessage(e, tr("editor.brandkit_export_failed")));
    } finally {
      setExporting(false);
    }
  }, [kit, workspaceId, toast]);

  const pick = useCallback(async (file: File) => {
    setReading(true);
    try {
      setParsed(await readKitFile(new Uint8Array(await file.arrayBuffer())));
    } catch (e) {
      toast.error(userMessage(e, tr("editor.brandkit_import_failed")));
    } finally {
      setReading(false);
    }
  }, [toast]);

  const btn = "flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50";
  return (
    <>
      <div className="flex gap-2">
        {kit && (
          <button type="button" onClick={() => void doExport()} disabled={exporting} className={btn} title={tr("editor.brandkit_export_hint")}>
            {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {tr("editor.brandkit_export")}
          </button>
        )}
        <button type="button" onClick={() => fileRef.current?.click()} disabled={reading} className={btn} title={tr("editor.brandkit_import_hint")}>
          {reading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} {tr("editor.brandkit_import")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".zip,.json,application/zip,application/json"
          hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void pick(f); }}
        />
      </div>
      {parsed && (
        <ImportDialog
          workspaceId={workspaceId}
          parsed={parsed}
          kits={kits}
          onClose={() => setParsed(null)}
          onDone={async (k, replaced) => { setParsed(null); await onImported(k, replaced); }}
        />
      )}
    </>
  );
}

function Counts({ c }: { c: { colors: number; fonts: number; logos: number; assets: number } }) {
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
      <dt className="text-neutral-500">{tr("editor.colors")}</dt><dd className="text-end tabular-nums text-neutral-800">{c.colors}</dd>
      <dt className="text-neutral-500">{tr("editor.fonts")}</dt><dd className="text-end tabular-nums text-neutral-800">{c.fonts}</dd>
      <dt className="text-neutral-500">{tr("editor.logos")}</dt><dd className="text-end tabular-nums text-neutral-800">{c.logos}</dd>
      <dt className="text-neutral-500">{tr("editor.brandkit_images")}</dt><dd className="text-end tabular-nums text-neutral-800">{c.assets}</dd>
    </dl>
  );
}

function ImportDialog({
  workspaceId,
  parsed,
  kits,
  onClose,
  onDone,
}: {
  workspaceId: string;
  parsed: ParsedKitFile;
  kits: BrandKit[];
  onClose: () => void;
  onDone: (kit: BrandKit, replaced: boolean) => void | Promise<void>;
}) {
  const toast = useToast();
  const user = useAuth((s) => s.user);
  const m = parsed.manifest;
  // The kit the file's name collides with, if any: then the dialog asks.
  const existing = useMemo(() => kitNamed(kits, m.name), [kits, m.name]);
  const [choice, setChoice] = useState<"replace" | "rename">(existing ? "replace" : "rename");
  const [name, setName] = useState(() => (existing ? freeKitName(m.name, kits.map((k) => k.name)) : m.name));
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);

  const replacing = !!existing && choice === "replace";
  const taken = !replacing && !!kitNamed(kits, name);
  const empty = !replacing && !name.trim();

  const run = useCallback(async () => {
    setBusy({ done: 0, total: 0 });
    try {
      // Replacing reuses the assets the kit already has when the file carries
      // the same bytes, so a kit exported and imported again keeps its ids.
      const reuse = new Map<string, string>();
      if (replacing && existing) {
        const assets = await assetMap(workspaceId);
        const ids = new Set([
          ...existing.logos.flatMap((l) => [l.assetId, l.variants?.dark, l.variants?.light]),
          ...existing.collections.flatMap((c) => c.assetIds),
        ].filter((x): x is string => !!x));
        for (const id of ids) {
          const a = assets.get(id);
          if (!a) continue;
          try {
            const h = await sha256(await bytesOf(a.url));
            if (h) reuse.set(h, id);
          } catch { /* not reusable, uploaded again */ }
        }
      }
      const content = await uploadKitContent(parsed, {
        uploadAsset: (file, filename) => directUploadWithProgress(workspaceId, file, { filename }),
        uploadFont: async (file, face) => {
          try {
            await oc.uploadWorkspaceFont(workspaceId, file, face);
          } catch (e) {
            // The same file is already a workspace font.
            if (!(e instanceof ApiError && e.status === 409)) throw e;
          }
        },
        reuse,
        hash: sha256,
        onProgress: (done, total) => setBusy({ done, total }),
      });
      let kit: BrandKit;
      if (replacing && existing) {
        kit = await oc.updateBrandKit(existing.id, content);
      } else {
        const created = await oc.createBrandKit(workspaceId, { name: name.trim() });
        try {
          kit = await oc.updateBrandKit(created.id, content);
        } catch (e) {
          // Leave no empty kit behind for a failed import.
          await oc.deleteBrandKit(created.id).catch(() => {});
          throw e;
        }
      }
      // A font file that is already in the workspace under another family
      // name was not added again; the kit then names a family nobody has.
      if (m.fontFiles.length) {
        const have = new Set((await oc.listWorkspaceFonts(workspaceId).catch(() => [])).map((f) => f.family));
        const absent = [...new Set(m.fontFiles.map((f) => f.family))].filter((f) => !have.has(f));
        if (absent.length) toast.toast(tr("editor.brandkit_font_elsewhere", { families: absent.join(", ") }), "info");
      }
      toast.success(replacing ? tr("editor.brandkit_replaced", { name: kit.name }) : tr("editor.brandkit_imported", { name: kit.name }));
      await onDone(kit, replacing);
    } catch (e) {
      toast.error(userMessage(e, tr("editor.brandkit_import_failed")));
      setBusy(null);
    }
  }, [replacing, existing, workspaceId, parsed, name, m.fontFiles, toast, onDone]);

  const radio = "mt-0.5 h-3.5 w-3.5 shrink-0 accent-brand-600";
  return (
    <Modal open onClose={() => { if (!busy) onClose(); }} title={tr("editor.brandkit_import_title")} width="w-[30rem]">
      {existing ? (
        <>
          <p className="mb-3 text-sm text-neutral-700">{tr("editor.brandkit_name_exists", { name: existing.name })}</p>
          <div className="mb-4 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-neutral-200 p-2.5">
              <div className="mb-1 text-xs font-semibold text-neutral-800">{tr("editor.brandkit_in_workspace")}</div>
              <div className="mb-2 text-[11px] text-neutral-500">{tr("editor.brandkit_version_changed", { version: existing.version, date: formatDate(existing.updatedAt, user) })}</div>
              <Counts c={kitSummary(existing)} />
            </div>
            <div className="rounded-lg border border-neutral-200 p-2.5">
              <div className="mb-1 text-xs font-semibold text-neutral-800">{tr("editor.brandkit_in_file")}</div>
              <div className="mb-2 text-[11px] text-neutral-500">{m.exportedAt ? tr("editor.brandkit_exported_on", { date: formatDate(m.exportedAt, user) }) : " "}</div>
              <Counts c={kitFileSummary(m)} />
            </div>
          </div>
          <div className="flex flex-col gap-2.5">
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="radio" name="brandkit-import" checked={choice === "replace"} onChange={() => setChoice("replace")} disabled={!!busy} className={radio} />
              <span>
                <span className="font-medium text-neutral-800">{tr("editor.brandkit_replace")}</span>
                <span className="block text-xs text-neutral-500">{tr("editor.brandkit_replace_hint")}</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="radio" name="brandkit-import" checked={choice === "rename"} onChange={() => setChoice("rename")} disabled={!!busy} className={radio} />
              <span className="font-medium text-neutral-800">{tr("editor.brandkit_keep_both")}</span>
            </label>
          </div>
        </>
      ) : (
        <div className="mb-3 rounded-lg border border-neutral-200 p-2.5">
          <div className="mb-2 text-[11px] text-neutral-500">{m.exportedAt ? tr("editor.brandkit_exported_on", { date: formatDate(m.exportedAt, user) }) : " "}</div>
          <Counts c={kitFileSummary(m)} />
        </div>
      )}

      {!replacing && (
        <label className={`block ${existing ? "mt-2 ps-5.5" : ""}`}>
          <span className="mb-1 block text-xs font-medium text-neutral-600">{tr("editor.name")}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!!busy}
            maxLength={120}
            aria-invalid={taken || empty}
            className="w-full rounded-lg border border-neutral-200 bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand-400 aria-[invalid=true]:border-red-400"
          />
          {taken && <span className="mt-1 block text-xs text-red-600">{tr("editor.brandkit_name_taken")}</span>}
        </label>
      )}

      {busy && (
        <div className="mt-4">
          <div className="mb-1 text-xs text-neutral-500">
            {busy.total ? tr("editor.brandkit_uploading", { done: busy.done, total: busy.total }) : tr("editor.brandkit_preparing")}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
            <div className="h-full bg-brand-600 transition-[width]" style={{ width: `${busy.total ? Math.round((busy.done / busy.total) * 100) : 5}%` }} />
          </div>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} disabled={!!busy} className="rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-50">
          {tr("editor.cancel")}
        </button>
        <button
          type="button"
          onClick={() => void run()}
          disabled={!!busy || taken || empty}
          className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          {replacing ? tr("editor.brandkit_replace_action") : tr("editor.brandkit_import_action")}
        </button>
      </div>
    </Modal>
  );
}
