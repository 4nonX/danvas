// Import from Canva (docs/roadmap/41-canva-import.md): turn the user's picks in
// their Canva library into a plan (which designs go into which folder path),
// pace the exports under Canva's limits, and turn each export into a design:
// a PPTX through the PPTX importer (editable), PNG pages as image pages.
//
// Everything Canva-facing goes through the server (@hc/sdk); this module only
// decides what to fetch, in what order, and how fast.

import { createBlankDesign, createNode, type DesignFile, type Node } from "@hc/schema";
import type { CanvaFolderPage, CanvaItem } from "@hc/sdk";

/** A ticked entry of the tree: a design or a folder ("root" = everything),
 *  with the ids of the folders above it, for "a ticked folder covers what is
 *  below it". */
export interface CanvaPick {
  item: CanvaItem;
  ancestors: string[];
}

/** One design to import and its folder path below the import target. */
export interface PlannedDesign {
  id: string;
  title: string;
  path: string[];
}

export interface ImportPlan {
  /** Every folder path to mirror, parents before children (empty folders too). */
  folders: string[][];
  designs: PlannedDesign[];
}

/** The picks that are not already covered by a ticked folder above them. */
export function effectivePicks(picks: CanvaPick[]): CanvaPick[] {
  const ticked = new Set(picks.filter((p) => p.item.type === "folder").map((p) => p.item.id));
  return picks.filter((p) => !p.ancestors.some((a) => ticked.has(a)));
}

/** Rate limits while listing are waited out (a minute, Canva's window). */
export type ListFolder = (folderId: string, continuation?: string) => Promise<CanvaFolderPage>;

/** Every entry of a folder, across pages. */
export async function listAll(list: ListFolder, folderId: string, stopped: () => boolean): Promise<CanvaItem[]> {
  const out: CanvaItem[] = [];
  let cont: string | undefined;
  do {
    if (stopped()) break;
    const page = await list(folderId, cont);
    out.push(...page.items);
    cont = page.continuation || undefined;
  } while (cont);
  return out;
}

/**
 * Build the plan for a selection: a ticked design goes straight into the
 * target, a ticked folder becomes a folder of the same name with everything
 * below it mirrored, and "root" (everything) mirrors the whole library into the
 * target. A design reached twice is planned once.
 */
export async function planImport(
  picks: CanvaPick[],
  list: ListFolder,
  opts: { stopped?: () => boolean; onFolder?: (name: string) => void; untitled: { design: string; folder: string } },
): Promise<ImportPlan> {
  const stopped = opts.stopped ?? (() => false);
  const folderName = (name: string) => name.trim() || opts.untitled.folder;
  const plan: ImportPlan = { folders: [], designs: [] };
  const seenDesigns = new Set<string>();
  const seenFolders = new Set<string>();
  const addFolder = (path: string[]) => {
    const key = path.map((p) => p.toLowerCase()).join("\u0000");
    if (path.length && !seenFolders.has(key)) {
      seenFolders.add(key);
      plan.folders.push(path);
    }
  };
  const addDesign = (item: CanvaItem, path: string[]) => {
    if (seenDesigns.has(item.id)) return;
    seenDesigns.add(item.id);
    plan.designs.push({ id: item.id, title: item.name.trim() || opts.untitled.design, path });
  };
  const walk = async (folderId: string, path: string[], visiting: Set<string>): Promise<void> => {
    if (stopped() || visiting.has(folderId)) return;
    visiting.add(folderId);
    addFolder(path);
    opts.onFolder?.(path[path.length - 1] ?? "");
    for (const it of await listAll(list, folderId, stopped)) {
      if (it.type === "design") addDesign(it, path);
      else await walk(it.id, [...path, folderName(it.name)], visiting);
    }
    visiting.delete(folderId);
  };
  for (const p of effectivePicks(picks)) {
    if (stopped()) break;
    if (p.item.type === "design") addDesign(p.item, []);
    else await walk(p.item.id, p.item.id === "root" ? [] : [folderName(p.item.name)], new Set());
  }
  return plan;
}

/**
 * Paces export starts: at most `max` in any `windowMs` (14 a minute keeps a
 * run under Canva's 75 exports per 5 minutes). `wait` returns once a start is
 * allowed; `now`/`sleep` are injectable for tests.
 */
export class ExportPacer {
  private starts: number[] = [];
  constructor(
    private max = 14,
    private windowMs = 60_000,
    private now: () => number = () => Date.now(),
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async wait(stopped: () => boolean = () => false): Promise<void> {
    for (;;) {
      const t = this.now();
      this.starts = this.starts.filter((s) => t - s < this.windowMs);
      if (this.starts.length < this.max || stopped()) break;
      await this.sleep(Math.max(250, this.windowMs - (t - this.starts[0])));
    }
    this.starts.push(this.now());
  }
}

/** The pixel size of an image blob. */
async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bmp = await createImageBitmap(blob);
  const size = { width: bmp.width, height: bmp.height };
  bmp.close();
  return size;
}

async function blobToDataUrl(blob: Blob, mime: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

/**
 * A design whose pages each show one exported page image, full-bleed at its
 * own pixel size (looks exactly like the Canva page, not editable). Images are
 * self-contained data: URL assets, as in the PPTX import.
 */
export async function imagePagesDesign(
  title: string,
  images: Blob[],
  measure: (b: Blob) => Promise<{ width: number; height: number }> = imageSize,
): Promise<DesignFile> {
  if (!images.length) throw new Error("the export has no pages");
  const sizes = await Promise.all(images.map(measure));
  const file = createBlankDesign({ title, width: sizes[0].width, height: sizes[0].height });
  const assets: { id: string; kind: string; url: string; mime: string; checksum: string }[] = [];
  file.pages = [];
  for (let i = 0; i < images.length; i++) {
    const { width, height } = sizes[i];
    const mime = images[i].type || "image/png";
    const assetId = `canva-page-${i + 1}`;
    assets.push({ id: assetId, kind: "image", url: await blobToDataUrl(images[i], mime), mime, checksum: "" });
    const image = createNode("image", {
      id: `canva-image-${i + 1}`,
      name: `Page ${i + 1}`,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      size: { width, height },
      source: { assetId, naturalWidth: width, naturalHeight: height },
      fit: "stretch",
    } as Partial<Node>);
    file.pages.push({ id: `canva-page-${i + 1}`, width, height, children: [image] } as never);
  }
  (file as { assets?: unknown[] }).assets = assets;
  return file;
}
