// Background removal for an image node, shared by the context toolbar and the
// properties panel: fetch the image, run the in-browser segmentation model,
// keep the original and store only the alpha as a mask asset (undoable,
// refinable). A small store carries which node is being processed and how far,
// so both places show the same progress and cannot start it twice.

import { create } from "zustand";
import { useEditor } from "@/store/editor";
import { alphaMaskFromCutout, rasterizeToPng, removeBackground } from "@/lib/imageFilters";
import { directUploadWithProgress, resolveAssetUrl } from "@/lib/sdk";
import { CodedError } from "@/lib/errors";

export const useBgRemoval = create<{ nodeId: string | null; progress: number }>(() => ({ nodeId: null, progress: 0 }));

/** Remove the background of image node `id`. Throws a CodedError on failure. */
export async function removeImageBackground(id: string, workspaceId: string | null): Promise<void> {
  if (useBgRemoval.getState().nodeId) return; // one at a time: the model is large
  const node = useEditor.getState().doc.pages.flatMap(function walk(n: unknown): unknown[] {
    const kids = (n as { children?: unknown[] }).children ?? [];
    return [n, ...kids.flatMap(walk)];
  }).find((n) => (n as { id?: string }).id === id) as { type?: string; source?: { assetId: string; naturalWidth?: number; naturalHeight?: number } } | undefined;
  if (!node || node.type !== "image" || !node.source) return;
  const src = node.source;
  const url = useEditor.getState().doc.assets.find((a) => a.id === src.assetId)?.url;
  if (!url) throw new CodedError("editor.this_image_has_no_resolvable_source_url", "This image has no resolvable source URL.");
  useBgRemoval.setState({ nodeId: id, progress: 0 });
  try {
    // Fetch the image through the app's own path (absolute URL + credentials)
    // and hand the bytes to the remover as a Blob, so it never has to fetch a
    // relative/cross-origin URL itself.
    const resp = await fetch(resolveAssetUrl(url), { credentials: "include" });
    if (!resp.ok) throw new CodedError("errors.image_load_failed", `Couldn't load the image (${resp.status}).`, { status: resp.status });
    let blob = await resp.blob();
    // The model only accepts raster images; rasterize anything else first.
    if (!/^image\/(png|jpeg|webp)$/.test(blob.type)) {
      blob = await rasterizeToPng(blob, src.naturalWidth ?? 0, src.naturalHeight ?? 0);
    }
    const { dataUrl } = await removeBackground(blob, (f) => useBgRemoval.setState({ progress: f }));
    // Non-destructive: the original stays in `source`; only the alpha travels,
    // as a mask asset beside it.
    const mask = await alphaMaskFromCutout(dataUrl);
    // A real uploaded asset, never a data URL (which would bloat the document,
    // every snapshot and every collaborator's load). The data URL remains the
    // fallback without a workspace or when the upload fails.
    let maskUrl = mask.dataUrl;
    if (workspaceId) {
      try {
        const maskBlob = await (await fetch(mask.dataUrl)).blob();
        const asset = await directUploadWithProgress(workspaceId, maskBlob, { filename: `mask-${Date.now()}.png` });
        maskUrl = resolveAssetUrl(asset.url);
      } catch { /* keep the inline mask rather than losing the work */ }
    }
    useEditor.getState().setImageAlphaMask(id, maskUrl, mask.width, mask.height);
  } finally {
    useBgRemoval.setState({ nodeId: null, progress: 0 });
  }
}
