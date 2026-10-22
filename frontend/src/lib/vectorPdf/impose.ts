// Imposed sheets for the vector PDF (F45): each drawn page becomes one Form
// XObject, and every slot of a sheet places it with a transformation, clipped
// to the slot's bleed, so ten business cards on a sheet are ten references to
// one piece of vector content. The cut marks are drawn on the sheet.

import { assignSlots, planImposition, type ImposePlan, type ImposeSettings } from "@/lib/print/impose";
import { CodedError } from "@/lib/errors";
import { num } from "./pdfCanvas";
import type { DrawnPage } from "./index";

const PT_PER_MM = 72 / 25.4;

export interface ImposedSheet {
  /** Sheet size in pt. */
  width: number;
  height: number;
  /** Content stream (PDF user space: pt, origin bottom left). */
  stream: string;
}

export interface FormPage {
  /** Resource name of the page's Form XObject. */
  name: string;
  /** Its bounding box (the drawn page's sheet) in pt. */
  width: number;
  height: number;
  /** Trim offset inside the form (the bleed around the page), pt. */
  margin: number;
  /** Trim size and bleed, mm. */
  trimW: number;
  trimH: number;
  bleed: number;
}

/** The form a drawn page becomes: its content mapped from device px (y down)
 *  to pt (y up). */
export function formOf(p: DrawnPage, dpi: number, name: string): { form: FormPage; stream: string } {
  const pt = 72 / dpi;
  const width = p.sheet.sheetWidth * pt;
  const height = p.sheet.sheetHeight * pt;
  const k = 72 / (dpi * p.zoom);
  const mm = 25.4 / dpi;
  return {
    form: { name, width, height, margin: p.sheet.margin * pt, trimW: p.sheet.width * mm, trimH: p.sheet.height * mm, bleed: p.sheet.bleed * mm },
    stream: `${num(k)} 0 0 ${num(-k)} 0 ${num(height)} cm\n${p.content}`,
  };
}

/** The operators placing `form` in a slot of a sheet `sheetH` pt high:
 *  clipped to the slot's trim box plus its allowed bleed, turned a quarter
 *  clockwise when the plan turns items. */
export function placeForm(form: FormPage, plan: ImposePlan, slot: ImposePlan["slots"][number], sheetH: number): string {
  const sx = slot.x * PT_PER_MM, sy = slot.y * PT_PER_MM;
  const w = plan.itemW * PT_PER_MM, h = plan.itemH * PT_PER_MM;
  const b = { l: slot.bleed.left * PT_PER_MM, r: slot.bleed.right * PT_PER_MM, t: slot.bleed.top * PT_PER_MM, bt: slot.bleed.bottom * PT_PER_MM };
  const clip = `${num(sx - b.l)} ${num(sheetH - (sy + h + b.bt))} ${num(w + b.l + b.r)} ${num(h + b.t + b.bt)} re W n`;
  const m = form.margin;
  let cm: string;
  if (!plan.rotated) {
    // Form point (u, v up) to sheet: shift so the form's trim corner lands
    // on the slot's top left.
    cm = `1 0 0 1 ${num(sx - m)} ${num(sheetH - form.height + m - sy)} cm`;
  } else {
    // A quarter clockwise as seen: the form's top edge becomes the right
    // edge. Visually (y down) a form point (u, v) goes to (dx - v, dy + u)
    // with dx = sx + m + trim height and dy = sy - m.
    const th = form.height - 2 * m;
    const dx = sx + m + th;
    const dy = sy - m;
    cm = `0 -1 1 0 ${num(dx - form.height)} ${num(sheetH - dy)} cm`;
  }
  return `q ${clip} ${cm} /${form.name} Do Q`;
}

export interface ImposeMarksStyle {
  /** Stroke colour operator(s), e.g. "0 0 0 1 K" or "/CS1 CS 1 SCN". */
  stroke: string;
  /** Line weight, pt. */
  weight: number;
}

/** All imposed sheets for the drawn pages: pages of one trim size share a
 *  grid; a new size starts a new grid. */
export function imposeSheets(forms: FormPage[], s: ImposeSettings, sheetMm: [number, number], marks: ImposeMarksStyle): { sheets: ImposedSheet[]; plans: ImposePlan[] } {
  const sheets: ImposedSheet[] = [];
  const plans: ImposePlan[] = [];
  let k = 0;
  while (k < forms.length) {
    const first = forms[k];
    const group: number[] = [];
    while (k < forms.length && Math.abs(forms[k].trimW - first.trimW) < 0.01 && Math.abs(forms[k].trimH - first.trimH) < 0.01) group.push(k++);
    const plan = planImposition({
      itemW: first.trimW, itemH: first.trimH, bleed: first.bleed,
      sheetW: sheetMm[0], sheetH: sheetMm[1], orientation: s.orientation,
      marginMm: s.marginMm, gapMm: s.gapMm, marks: s.marks, rotate: s.rotate,
    });
    if (!plan) throw new CodedError("errors.impose_does_not_fit", "an item is larger than the usable sheet");
    plans.push(plan);
    const W = plan.sheetW * PT_PER_MM, H = plan.sheetH * PT_PER_MM;
    for (const fill of assignSlots(group, plan.slots.length, s.fill)) {
      const ops = fill.map((fi, j) => placeForm(forms[fi], plan, plan.slots[j], H));
      if (plan.marks.length) {
        const lines = plan.marks.map((l) => `${num(l.x1 * PT_PER_MM)} ${num(H - l.y1 * PT_PER_MM)} m ${num(l.x2 * PT_PER_MM)} ${num(H - l.y2 * PT_PER_MM)} l`).join(" ");
        ops.push(`q ${marks.stroke} ${num(marks.weight)} w 0 J [] 0 d ${lines} S Q`);
      }
      sheets.push({ width: W, height: H, stream: ops.join("\n") });
    }
  }
  return { sheets, plans };
}
