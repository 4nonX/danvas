// A page as it will print, for the proof view and the print shop package:
// rendered, converted to CMYK through the export's profile, with the vector
// files' rules applied (black on the black plate alone, elements that
// overprint) and the die line as a plate of its own. A preview computed
// from the render; the output check examines the real file.

import type { DesignFile, Node, Page } from "@hc/schema";
import { createScene, renderScene, type CanvasLike } from "@hc/engine";
import { renderPageCanvas } from "@/lib/exportFormats";
import { imageAssets } from "@/lib/assetProvider";
import type { CmykConverter } from "./cms";
import { clipToBleed, DIE_LINE_CMYK, drawDieLine, printSheet, sheetViewport, type DieLine, type PrintParts } from "./sheet";
import { applyBlackOnly } from "./proof";
import { dieLinePage, hasOverprint, isOverprint, withoutDieLines } from "./nodePrint";

export interface ProofRender {
  width: number;
  height: number;
  /** Device px per page px. */
  scale: number;
  /** The plain render (straight alpha, on white). */
  rgba: Uint8ClampedArray;
  /** Interleaved CMYK bytes, 0..255 = 0..100 % ink. */
  cmyk: Uint8Array;
  /** The die line drawn alone (alpha is the line), or null. */
  dieMask: Uint8ClampedArray | null;
}

const kids = (n: Node) => (n as unknown as { children?: Node[] }).children;

/** Whether a node or anything inside it overprints. */
function anyOverprint(n: Node): boolean {
  return isOverprint(n) || (kids(n) ?? []).some((c) => !c.hidden && anyOverprint(c));
}

/** The drawing order of a page cut where overprinting starts or stops:
 *  whole elements that do not overprint (or overprint as a whole), and the
 *  insides of containers that mix both. A container's own paint goes with
 *  the run of its first element. */
interface Leaf { id: string; overprint: boolean }
function leaves(nodes: Node[], inherited: boolean, out: Leaf[]): void {
  for (const n of nodes) {
    if (n.hidden) continue;
    const op = inherited || isOverprint(n);
    const c = kids(n);
    if (op || !Array.isArray(c) || !c.length || !anyOverprint(n)) { out.push({ id: n.id, overprint: op }); continue; }
    out.push({ id: `${n.id}#paint`, overprint: false });
    leaves(c, false, out);
  }
}

/** The page with only these leaves (and the containers around them, whose
 *  own paint stays only where `#paint` is part of the run). */
function runPage(page: Page, ids: Set<string>): Page {
  const walk = (nodes: Node[]): Node[] => {
    const out: Node[] = [];
    for (const n of nodes) {
      if (ids.has(n.id)) { out.push(n); continue; }
      const c = kids(n);
      if (!Array.isArray(c)) continue;
      const inner = walk(c);
      const own = ids.has(`${n.id}#paint`);
      if (!inner.length && !own) continue;
      const g = { ...n, children: inner } as Record<string, unknown>;
      if (!own) {
        if ("fills" in g) g.fills = [];
        delete g.stroke;
        delete g.effects;
      }
      out.push(g as unknown as Node);
    }
    return out;
  };
  return { ...page, children: walk(page.children) };
}

function pixelsOf(canvas: HTMLCanvasElement): Uint8ClampedArray {
  return canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
}

/** CMYK of a transparent render's colours (each pixel as if opaque), with
 *  the black-only rule. */
function opaqueCmyk(rgba: Uint8ClampedArray, conv: CmykConverter, blackOnly: boolean): Uint8Array {
  const solid = new Uint8ClampedArray(rgba);
  for (let i = 3; i < solid.length; i += 4) solid[i] = 255;
  const cmyk = conv.pixels(solid, solid.length / 4);
  if (blackOnly) applyBlackOnly(solid, cmyk);
  return cmyk;
}

/**
 * A page's sheet in CMYK at `scale` (device px per page px), as it prints:
 * converted through the profile, pure black on the black plate alone when
 * `blackOnly`, and elements that overprint leaving the inks under them
 * they do not use. The proof and the CMYK raster files (TIFF, image PDF)
 * both come from here, so they agree.
 */
export function pageCmyk(doc: DesignFile, page: number, scale: number, parts: PrintParts | false, conv: CmykConverter, blackOnly: boolean): { width: number; height: number; rgba: Uint8ClampedArray; cmyk: Uint8Array } {
  const art = withoutDieLines(doc);
  const canvas = renderPageCanvas(art, page, scale, true, parts);
  if (!canvas) throw new Error("render failed");
  const { width, height } = canvas;
  const rgba = pixelsOf(canvas);
  const n = width * height;
  let cmyk: Uint8Array;
  if (!hasOverprint(art, [page])) {
    cmyk = conv.pixels(rgba, n);
    if (blackOnly) applyBlackOnly(rgba, cmyk);
  } else {
    // In drawing order, run by run: what knocks out covers the inks below
    // it, what overprints leaves every ink it does not use (overprint mode
    // 1, as the vector files write it).
    const list: Leaf[] = [];
    leaves(art.pages[page].children, false, list);
    const runs: Leaf[][] = [];
    for (const l of list) {
      const last = runs[runs.length - 1];
      if (last && last[0].overprint === l.overprint) last.push(l);
      else runs.push([l]);
    }
    const bare = { ...art, pages: art.pages.map((p, i) => (i === page ? { ...p, children: [] } : p)) } as DesignFile;
    const base = renderPageCanvas(bare, page, scale, true, parts);
    if (!base) throw new Error("render failed");
    cmyk = conv.pixels(pixelsOf(base), n);
    for (const run of runs) {
      const ids = new Set(run.map((l) => l.id));
      const runDoc = { ...art, pages: art.pages.map((p, i) => (i === page ? runPage(p, ids) : p)) } as DesignFile;
      const c = renderPageCanvas(runDoc, page, scale, false, parts);
      if (!c) throw new Error("render failed");
      const px = pixelsOf(c);
      const ink = opaqueCmyk(px, conv, blackOnly);
      const over = run[0].overprint;
      for (let i = 0; i < n; i++) {
        const a = px[i * 4 + 3] / 255;
        if (!a) continue;
        for (let k = 0; k < 4; k++) {
          const j = i * 4 + k;
          if (over && ink[j] === 0) continue;
          cmyk[j] = Math.round(cmyk[j] * (1 - a) + ink[j] * a);
        }
      }
    }
  }
  return { width, height, rgba, cmyk };
}

export async function renderProof(doc: DesignFile, page: number, parts: PrintParts, conv: CmykConverter, o: { blackOnly: boolean; dieLine?: DieLine; maxSide: number; maxScale?: number }): Promise<ProofRender> {
  const pg = doc.pages[page];
  if (!pg) throw new Error("no such page");
  const dpi = doc.dpi ?? 96;
  const sheet = printSheet(pg, dpi, parts);
  const scale = Math.min(o.maxScale ?? 2, o.maxSide / Math.max(1, sheet.sheetWidth, sheet.sheetHeight));
  const { width, height, rgba, cmyk } = pageCmyk(doc, page, scale, parts, conv, o.blackOnly);
  let dieMask: Uint8ClampedArray | null = null;
  if (o.dieLine) {
    const diePage = dieLinePage(pg, 0.25 * (dpi / 72));
    if (diePage) {
      // The die line elements alone on the same sheet, without the marks.
      const dieDoc = { ...doc, pages: doc.pages.map((p, i) => (i === page ? diePage : p)) } as DesignFile;
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      const ctx = c.getContext("2d")!;
      const vp = sheetViewport(sheet, scale);
      ctx.save();
      clipToBleed(ctx, sheet, scale);
      renderScene(createScene(dieDoc, page), ctx as unknown as CanvasLike, { ...vp, width, height }, { assets: imageAssets, clear: false, skipBackground: true } as Parameters<typeof renderScene>[3]);
      ctx.restore();
      dieMask = ctx.getImageData(0, 0, width, height).data;
    } else {
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      const ctx = c.getContext("2d")!;
      // The same outline the file gets; a plain canvas has no spot colours
      // or layers, so those calls do nothing here.
      const spotCtx = Object.assign(ctx, { setSpot: () => {}, beginLayer: () => {}, endLayer: () => {} });
      drawDieLine(spotCtx as unknown as Parameters<typeof drawDieLine>[0], sheet, scale, o.dieLine, dpi);
      dieMask = ctx.getImageData(0, 0, width, height).data;
    }
  }
  return { width, height, scale, rgba, cmyk, dieMask };
}

/** The die line's colour on screen (as its spot colour is defined). */
export function dieLineTint(): [number, number, number] {
  const [sc, sm, sy, sk] = DIE_LINE_CMYK;
  return [255 * (1 - sc) * (1 - sk), 255 * (1 - sm) * (1 - sk), 255 * (1 - sy) * (1 - sk)];
}
