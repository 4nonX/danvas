// Imposed sheets as pictures (F45), for the image PDF and printing: every
// page is drawn once at the output resolution with its bleed, then placed in
// each of its slots on a sheet canvas (turned a quarter clockwise when the
// layout turns items), clipped to the slot's bleed, with the cut marks drawn
// on the sheet. The same layout as the vector PDF (impose.ts).

import type { DesignFile } from "@hc/schema";
import { renderPageCanvas } from "@/lib/exportFormats";
import { CodedError } from "@/lib/errors";
import { MARK_DEFAULTS } from "./sheet";
import { assignSlots, planImposition, type ImposePlan, type ImposeSettings } from "./impose";

export interface ImposedCanvas {
  canvas: HTMLCanvasElement;
  /** Sheet size in mm (after turning). */
  widthMm: number;
  heightMm: number;
}

/** Longest side of a sheet canvas, px (the browser's memory). */
export const IMPOSE_MAX_DIM = 7000;

/** The resolution a sheet is actually drawn at: `dpi`, lowered so the
 *  sheet's longest side stays within IMPOSE_MAX_DIM. */
export function imposedDpi(sheetMm: [number, number], dpi: number): number {
  return Math.min(dpi, (IMPOSE_MAX_DIM / Math.max(sheetMm[0], sheetMm[1])) * 25.4);
}

export function imposeCanvases(doc: DesignFile, pages: number[], s: ImposeSettings, sheetMm: [number, number], dpi: number, bleed: boolean): ImposedCanvas[] {
  const docDpi = doc.dpi ?? 96;
  const out: ImposedCanvas[] = [];
  const cache = new Map<number, HTMLCanvasElement | null>();
  let k = 0;
  while (k < pages.length) {
    const first = doc.pages[pages[k]];
    if (!first) { k++; continue; }
    const group: number[] = [];
    while (k < pages.length && doc.pages[pages[k]] && Math.abs(doc.pages[pages[k]].width - first.width) < 0.01 && Math.abs(doc.pages[pages[k]].height - first.height) < 0.01) group.push(pages[k++]);
    const mm = (px: number) => (px / docDpi) * 25.4;
    const bleedMm = bleed ? mm(first.bleed ?? 0) : 0;
    const plan = planImposition({
      itemW: mm(first.width), itemH: mm(first.height), bleed: bleedMm,
      sheetW: sheetMm[0], sheetH: sheetMm[1], orientation: s.orientation,
      marginMm: s.marginMm, gapMm: s.gapMm, marks: s.marks, rotate: s.rotate,
    });
    if (!plan) throw new CodedError("errors.impose_does_not_fit", "an item is larger than the usable sheet");
    const outDpi = imposedDpi([plan.sheetW, plan.sheetH], dpi);
    const px = (v: number) => (v / 25.4) * outDpi;
    const scale = outDpi / docDpi;
    for (const fill of assignSlots(group, plan.slots.length, s.fill)) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(px(plan.sheetW));
      canvas.height = Math.round(px(plan.sheetH));
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      fill.forEach((pageIndex, j) => {
        if (!cache.has(pageIndex)) cache.set(pageIndex, renderPageCanvas(doc, pageIndex, scale, true, { bleed, marks: false }));
        const img = cache.get(pageIndex);
        if (img) placeImage(ctx, img, plan, plan.slots[j], px, bleed ? (doc.pages[pageIndex].bleed ?? 0) * scale : 0);
      });
      if (plan.marks.length) {
        ctx.save();
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = Math.max(1, (MARK_DEFAULTS.weightPt / 72) * outDpi);
        ctx.beginPath();
        for (const l of plan.marks) { ctx.moveTo(px(l.x1), px(l.y1)); ctx.lineTo(px(l.x2), px(l.y2)); }
        ctx.stroke();
        ctx.restore();
      }
      out.push({ canvas, widthMm: plan.sheetW, heightMm: plan.sheetH });
    }
  }
  return out;
}

/** Draw a page picture (its trim `margin` px inside) into a slot. */
function placeImage(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, plan: ImposePlan, slot: ImposePlan["slots"][number], px: (mm: number) => number, margin: number): void {
  const sx = px(slot.x), sy = px(slot.y);
  const w = px(plan.itemW), h = px(plan.itemH);
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx - px(slot.bleed.left), sy - px(slot.bleed.top), w + px(slot.bleed.left) + px(slot.bleed.right), h + px(slot.bleed.top) + px(slot.bleed.bottom));
  ctx.clip();
  if (!plan.rotated) {
    ctx.drawImage(img, sx - margin, sy - margin);
  } else {
    // A quarter clockwise: a picture point (u, v) goes to (dx - v, dy + u).
    const th = img.height - 2 * margin;
    ctx.setTransform(0, 1, -1, 0, sx + margin + th, sy - margin);
    ctx.drawImage(img, 0, 0);
  }
  ctx.restore();
}
