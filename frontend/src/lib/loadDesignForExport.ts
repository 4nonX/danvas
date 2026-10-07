// Load designs for exporting outside the editor (dashboard downloads): fetch
// each file, register its images and fonts, and wait until they have loaded,
// so the renderer does not draw placeholders or fallback fonts.

import type { DesignFile, Node } from "@hc/schema";
import { oc } from "@/lib/sdk";
import { imageAssets } from "@/lib/assetProvider";
import { fonts } from "@/lib/fontProvider";

const WAIT_MS = 15000;

function familiesOf(doc: DesignFile): Set<string> {
  const out = new Set<string>();
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      if (n.type === "text") {
        for (const p of (n as unknown as { content: { runs: { style: { fontFamily?: string } }[] }[] }).content) {
          for (const r of p.runs) if (r.style.fontFamily) out.add(r.style.fontFamily);
        }
      }
      const kids = (n as unknown as { children?: Node[] }).children;
      if (Array.isArray(kids)) walk(kids);
    }
  };
  for (const page of doc.pages) walk(page.children);
  return out;
}

/** Resolves once every image and font of `doc` is loaded (or failed), or
 *  after a timeout: a broken asset must not hang the export. */
export function whenRenderable(doc: DesignFile): Promise<void> {
  const assets = (doc.assets ?? []).filter((a) => a.kind !== "video" && a.url);
  imageAssets.registerAll(assets);
  fonts.ensureForDoc(doc);
  const families = [...familiesOf(doc)];
  const ready = () => assets.every((a) => imageAssets.status(a.id) !== "loading") && families.every((f) => fonts.isSettled(f));
  if (ready()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { offA(); offF(); clearTimeout(timer); resolve(); };
    const check = () => { if (ready()) done(); };
    const offA = imageAssets.onChange(check);
    const offF = fonts.onChange(check);
    const timer = setTimeout(done, WAIT_MS);
  });
}

/** Fetch designs (a few at a time) and wait until each is ready to render.
 *  The result keeps the order of `ids`. */
export async function loadDesignsForExport(ids: string[], concurrency = 4): Promise<{ id: string; doc: DesignFile }[]> {
  const out: { id: string; doc: DesignFile }[] = new Array(ids.length);
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const i = next++;
      const doc = await oc.getDesignFile(ids[i]);
      await whenRenderable(doc);
      out[i] = { id: ids[i], doc };
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return out;
}
