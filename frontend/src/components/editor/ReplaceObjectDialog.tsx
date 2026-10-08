// Replace object: the picker (brand kit logos, workspace uploads, a new file
// from the device) and the size modes offered right after a replace. The
// sizing itself lives in lib/replaceObject.ts.

import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { Loader2, Upload } from "lucide-react";
import type { UploadedAsset } from "@hc/sdk";
import { locate } from "@hc/editor";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { tr } from "@/lib/i18n";
import { directUploadWithProgress, oc, resolveAssetUrl } from "@/lib/sdk";
import { useBrand } from "@/store/brand";
import { templateLockBlocking, useEditor } from "@/store/editor";
import {
  finishReplacement,
  measureVisible,
  prepareReplacement,
  whenImagesReady,
  type Prepared,
  type ReplaceMode,
  type ReplacementSource,
  type Visible,
} from "@/lib/replaceObject";

type Mode = Exclude<ReplaceMode, "auto">;

interface LastReplace {
  oldId: string;
  nodeId: string;
  mode: Mode;
  /** Undo stack length right after the replace: the size modes are offered
   *  only while the replace is still the latest edit. */
  stackLen: number;
  oldVisible: Visible;
  newVisible: Visible;
  prepared: Prepared;
  parent: { width: number; height: number };
}

export const useReplace = create<{ targetId: string | null; last: LastReplace | null }>(() => ({ targetId: null, last: null }));

/** Open the picker for a node (toolbar button, element menu). */
export function openReplace(id: string): void {
  useReplace.setState({ targetId: id });
}

class ReplaceError extends Error {}

/** Replace `targetId` by `src` as one undo step. Throws (with nothing
 *  changed) when the file is unusable or the object cannot be replaced. */
async function runReplace(targetId: string, src: ReplacementSource): Promise<void> {
  const st = useEditor.getState();
  const doc = st.doc;
  const loc = locate(doc, targetId);
  if (!loc) throw new ReplaceError("gone");
  const old = loc.node;
  // A template frame at the "content" level: the picture changes, the frame
  // stays (same object, place and size), so no sizing modes either.
  if (old.type === "image" && templateLockBlocking(targetId, "structure") && !templateLockBlocking(targetId, "content")) {
    const before = st.undoStack.length;
    st.setImageSource(targetId, src.url);
    if (useEditor.getState().undoStack.length === before) throw new ReplaceError("blocked");
    useReplace.setState({ last: null });
    return;
  }
  const parent = loc.parent ? { width: loc.parent.size.width, height: loc.parent.size.height } : { width: loc.page.width, height: loc.page.height };
  await whenImagesReady(old, doc.assets ?? []);
  const oldVisible = measureVisible(old, doc) ?? { box: { x: 0, y: 0, w: old.size.width, h: old.size.height }, opaque: false };
  const prepared = await prepareReplacement(src);
  const newVisible = measureVisible(prepared.node, { ...doc, assets: [...(doc.assets ?? []), ...prepared.assets] });
  if (!newVisible) throw new ReplaceError("empty");
  const { node, mode } = finishReplacement(old, oldVisible, prepared, newVisible, parent, "auto");
  if (!useEditor.getState().replaceNode(targetId, node, prepared.assets)) throw new ReplaceError("blocked");
  useReplace.setState({
    last: { oldId: targetId, nodeId: node.id, mode, stackLen: useEditor.getState().undoStack.length, oldVisible, newVisible, prepared, parent },
  });
}

/** Switch the latest replace to another size mode: the replace is undone and
 *  redone in the new mode, so it stays one undo step. */
export function setReplaceMode(mode: Mode): void {
  const last = useReplace.getState().last;
  const st = useEditor.getState();
  if (!last || last.mode === mode || st.undoStack.length !== last.stackLen) return;
  st.undo();
  const loc = locate(useEditor.getState().doc, last.oldId);
  if (!loc) return;
  const { node } = finishReplacement(loc.node, last.oldVisible, last.prepared, last.newVisible, last.parent, mode);
  if (!useEditor.getState().replaceNode(last.oldId, node, last.prepared.assets)) return;
  useReplace.setState({ last: { ...last, nodeId: node.id, mode, stackLen: useEditor.getState().undoStack.length } });
}

/** The size modes, shown in the toolbar while the selected object is the
 *  result of the latest replace. */
export function ReplaceModeChips() {
  const last = useReplace((s) => s.last);
  const selection = useEditor((s) => s.selection);
  const stackLen = useEditor((s) => s.undoStack.length);
  if (!last || selection.length !== 1 || selection[0] !== last.nodeId || stackLen !== last.stackLen) return null;
  const modes: { value: Mode; label: string; hint: string }[] = [
    { value: "optical", label: tr("editor.replace_mode_optical"), hint: tr("editor.replace_mode_optical_hint") },
    { value: "contain", label: tr("editor.replace_mode_contain"), hint: tr("editor.replace_mode_contain_hint") },
    { value: "cover", label: tr("editor.replace_mode_cover"), hint: tr("editor.replace_mode_cover_hint") },
  ];
  return (
    <div role="radiogroup" aria-label={tr("editor.size")} className="flex items-center gap-0.5 rounded-lg bg-neutral-100 p-0.5">
      {modes.map((m) => (
        <button
          key={m.value}
          type="button"
          role="radio"
          aria-checked={last.mode === m.value}
          title={m.hint}
          onClick={() => setReplaceMode(m.value)}
          className={`rounded-md px-2 py-1 text-xs font-medium transition ${last.mode === m.value ? "bg-surface text-brand-ink shadow-sm" : "text-neutral-600 hover:text-neutral-900"}`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

const isPicture = (a: UploadedAsset) =>
  (a.mimeType ?? "").startsWith("image/") || /\.(svg|png|jpe?g|webp|gif|avif)$/i.test(a.filename ?? "");

/** The picker. Mounted once in the editor; opens via openReplace(). */
export function ReplaceObjectDialog({ workspaceId }: { workspaceId: string | null }) {
  const targetId = useReplace((s) => s.targetId);
  const kit = useBrand((s) => s.kit);
  const toast = useToast();
  // The picture list, tagged with the target it was loaded for, so a new
  // target shows the loading state until its own list arrives.
  const [loaded, setLoaded] = useState<{ for: string; list: UploadedAsset[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const close = () => { if (!busy) useReplace.setState({ targetId: null }); };

  useEffect(() => {
    if (!targetId || !workspaceId) return;
    void oc.listAssets(workspaceId)
      .then((a) => setLoaded({ for: targetId, list: (a as UploadedAsset[]).filter(isPicture) }))
      .catch(() => setLoaded({ for: targetId, list: [] }));
  }, [targetId, workspaceId]);
  const assets = targetId && loaded?.for === targetId ? loaded.list : workspaceId ? null : [];

  const pick = async (src: ReplacementSource) => {
    if (!targetId) return;
    setBusy(true);
    try {
      await runReplace(targetId, src);
      useReplace.setState({ targetId: null });
    } catch (e) {
      toast.error(e instanceof ReplaceError && e.message === "blocked" ? tr("editor.replace_blocked") : tr("editor.replace_failed"));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    if (!workspaceId) return;
    setBusy(true);
    try {
      const asset = await directUploadWithProgress(workspaceId, file, { filename: file.name });
      setBusy(false);
      await pick({ url: resolveAssetUrl(asset.url), name: file.name.replace(/\.[a-z0-9]+$/i, "") });
    } catch {
      setBusy(false);
      toast.error(tr("editor.replace_failed"));
    }
  };

  const byId = new Map((assets ?? []).map((a) => [a.id, a]));
  const logoTiles: { key: string; asset: UploadedAsset; label: string }[] = [];
  for (const l of kit?.logos ?? []) {
    const main = byId.get(l.assetId);
    if (main) logoTiles.push({ key: l.id, asset: main, label: l.label });
    const dark = l.variants?.dark ? byId.get(l.variants.dark) : undefined;
    if (dark) logoTiles.push({ key: `${l.id}-dark`, asset: dark, label: tr("editor.replace_dark_variant", { name: l.label }) });
  }
  const logoIds = new Set(logoTiles.map((t) => t.asset.id));
  const uploads = (assets ?? []).filter((a) => !logoIds.has(a.id));

  const tile = (key: string, asset: UploadedAsset, label: string, dark = false) => (
    <button
      key={key}
      type="button"
      disabled={busy}
      title={label}
      onClick={() => void pick({ url: resolveAssetUrl(asset.url), name: label })}
      className={`light group flex aspect-square flex-col overflow-hidden rounded-lg border border-neutral-200 text-start transition hover:border-brand-400 disabled:opacity-50 ${dark ? "bg-neutral-800" : "bg-white"}`}
    >
      <span className="flex min-h-0 flex-1 items-center justify-center p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={asset.thumbnail ?? resolveAssetUrl(asset.url)} alt="" className="max-h-full max-w-full object-contain" />
      </span>
      <span className="truncate border-t border-neutral-200 bg-white px-1.5 py-1 text-[10px] text-neutral-600">{label}</span>
    </button>
  );

  return (
    <Modal open={!!targetId} onClose={close} title={tr("editor.replace_object")} width="w-[36rem]">
      <p className="mb-3 text-xs leading-snug text-neutral-500">{tr("editor.replace_object_hint")}</p>
      <div className="max-h-[60vh] space-y-4 overflow-y-auto pe-1">
        {assets === null ? (
          <div className="flex items-center gap-2 py-6 text-sm text-neutral-500"><Loader2 size={16} className="animate-spin" />{tr("editor.loading")}</div>
        ) : (
          <>
            {logoTiles.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{tr("editor.logos")}</h3>
                <div className="grid grid-cols-4 gap-2">{logoTiles.map((t) => tile(t.key, t.asset, t.label, t.key.endsWith("-dark")))}</div>
              </section>
            )}
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{tr("editor.uploads")}</h3>
              <div className="grid grid-cols-4 gap-2">
                <input ref={fileRef} type="file" accept="image/*,.svg" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
                <button
                  type="button"
                  disabled={busy || !workspaceId}
                  onClick={() => fileRef.current?.click()}
                  title={tr("editor.replace_from_a_file_on_your_device")}
                  className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-neutral-300 text-xs text-neutral-500 transition hover:border-brand-300 hover:text-brand-ink disabled:opacity-50"
                >
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                  {tr("editor.upload")}
                </button>
                {uploads.map((a) => tile(a.id, a, (a.filename ?? tr("editor.logo")).replace(/\.[a-z0-9]+$/i, "")))}
              </div>
              {uploads.length === 0 && <p className="mt-2 text-xs text-neutral-400">{tr("editor.no_uploads")}</p>}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}
