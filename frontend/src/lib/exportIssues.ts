// What an export would lose without saying so: text drawn in a fallback font
// because its font is unknown or did not load, images that did not load,
// (vector formats) text that becomes a picture because the export has no
// font file to outline it from, and (print formats) images placed larger than
// their pixels carry. The download dialog lists these before the
// file is made, so nobody finds them on the printed sheet.
//
// Call after whenRenderable(doc): "loading" counts as fine here, the export
// itself waits the same way.

import type { DesignFile, ImageNode, Node } from "@hc/schema";
import { computeEffectivePpi, createScene, type SceneNode } from "@hc/engine";
import { imageAssets } from "@/lib/assetProvider";
import { faceOf, fonts, type RunFont } from "@/lib/fontProvider";

export type ExportIssueKind = "font" | "font-outline" | "image" | "image-resolution" | "hairline" | "small-rich-text" | "edge-no-bleed";

/** Below this effective resolution an image looks soft in print. */
export const PRINT_MIN_PPI = 150;
/** Strokes thinner than this (points, at print size) may not print. */
export const HAIRLINE_PT = 0.25;
/** Text below this size (points) in several inks blurs when the plates are
 *  slightly out of register. */
export const SMALL_TEXT_PT = 8;

export interface ExportIssue {
  kind: ExportIssueKind;
  /** The font face ("Trajan Pro Bold") or the image's name. */
  subject: string;
  /** image-resolution: the lowest effective resolution found, in dpi. */
  ppi?: number;
  /** Where it is used: page number (1-based) and the element's label. */
  where: { page: number; element: string }[];
}

type TextNodeLike = { content?: { runs?: { text?: string; style?: RunFont }[] }[] };

/** A short label for an element: its name, else its text, else its type. */
function labelOf(n: Node): string {
  const name = (n as { name?: string }).name?.trim();
  if (name) return name;
  if (n.type === "text") {
    const text = ((n as unknown as TextNodeLike).content ?? []).flatMap((p) => (p.runs ?? []).map((r) => r.text ?? "")).join(" ").replace(/\s+/g, " ").trim();
    if (text) return text.length > 32 ? `${text.slice(0, 31)}…` : text;
  }
  return n.type;
}

/** Every non-empty assetId a node draws (image source, image or pattern
 *  fills, icons, stickers), wherever the schema keeps it. */
function assetIdsOf(n: Node): string[] {
  const out: string[] = [];
  const visit = (v: unknown, depth: number) => {
    if (!v || typeof v !== "object" || depth > 6) return;
    if (Array.isArray(v)) { for (const x of v) visit(x, depth + 1); return; }
    for (const [k, x] of Object.entries(v)) {
      if (k === "children") continue; // the walk visits children itself
      if (k === "assetId" && typeof x === "string" && x) out.push(x);
      else visit(x, depth + 1);
    }
  };
  visit(n, 0);
  return out;
}

/** Effective resolution of a placed image at the page's physical size; the
 *  loaded file's pixels stand in when the node does not record them (as
 *  imported images often do not). 0 when unknown. */
function imagePpi(n: ImageNode, doc: DesignFile): number {
  let { naturalWidth, naturalHeight } = n.source;
  if (!naturalWidth || !naturalHeight) {
    const img = imageAssets.image(n.source.assetId) as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number } | null;
    naturalWidth = img?.naturalWidth || img?.width || 0;
    naturalHeight = img?.naturalHeight || img?.height || 0;
  }
  return computeEffectivePpi({ ...n, source: { ...n.source, naturalWidth, naturalHeight } }, doc);
}

/** What the print checks need to know about the export. */
export interface PrintCheck {
  /** The colour conversion of a CMYK export (null: RGB). */
  cmyk?: ((r: number, g: number, b: number) => [number, number, number, number]) | null;
  /** Pure black goes on the black plate alone (vector print files). */
  blackOnly?: boolean;
  /** Whether the export includes a bleed. */
  bleed?: boolean;
}

const hex = (c: { r: number; g: number; b: number }) => `#${[c.r, c.g, c.b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

/** Print preflight on what the export draws (the engine's own scene, with
 *  groups, rotation and scaling): strokes too thin to print, small text in
 *  several inks, artwork at the edge of a page exported without bleed. */
function printChecks(doc: DesignFile, pages: number[], check: PrintCheck, add: (kind: ExportIssueKind, subject: string, page: number, element: string) => void, backgroundLabel: string) {
  const dpi = doc.dpi ?? 96;
  const toPt = 72 / dpi;
  for (const i of pages) {
    const pg = doc.pages[i];
    if (!pg) continue;
    const page = i + 1;
    const visit = (sn: SceneNode, top: boolean) => {
      const n = sn.node;
      const t = sn.worldTransform;
      const scale = Math.sqrt(Math.abs(t[0] * t[3] - t[1] * t[2])) || 1;
      const stroke = (n as { stroke?: { width?: number } }).stroke;
      if (stroke?.width && stroke.width > 0 && stroke.width * scale * toPt < HAIRLINE_PT) {
        add("hairline", `${Math.round(stroke.width * scale * toPt * 100) / 100} pt`, page, labelOf(n));
      }
      if (n.type === "text" && check.cmyk) {
        for (const p of (n as unknown as TextNodeLike).content ?? []) {
          for (const r of p.runs ?? []) {
            type PrintKeys = { cmyk?: { c: number; m: number; y: number; k: number }; spot?: { name: string } };
            const st = r.style as (RunFont & { fontSize?: number; fill?: { type?: string; color?: { srgb?: { r: number; g: number; b: number } } & PrintKeys } }) | undefined;
            const color = st?.fill?.type === "solid" ? st.fill.color : undefined;
            const c = color?.srgb;
            if (!r.text?.trim() || !st?.fontSize || !c || st.fontSize * scale * toPt >= SMALL_TEXT_PT) continue;
            // A spot colour is one ink; explicit CMYK is printed as given.
            if (color?.spot?.name) continue;
            if (!color?.cmyk && check.blackOnly && c.r <= 0.002 && c.g <= 0.002 && c.b <= 0.002) continue;
            const values = color?.cmyk ? [color.cmyk.c, color.cmyk.m, color.cmyk.y, color.cmyk.k] : check.cmyk(c.r, c.g, c.b);
            const inks = values.filter((v) => v >= 0.1).length;
            if (inks >= 2) add("small-rich-text", hex(c), page, labelOf(n));
          }
        }
      }
      // Only whole elements: a group's bounds already hold its children.
      if (top && check.bleed === false) {
        const b = sn.worldBounds;
        const e = 0.5;
        if (b.x <= e || b.y <= e || b.x + b.width >= pg.width - e || b.y + b.height >= pg.height - e) add("edge-no-bleed", "", page, labelOf(n));
      }
      for (const ch of sn.children ?? []) visit(ch, false);
    };
    for (const ch of createScene(doc, i).root.children ?? []) visit(ch, true);
    // A coloured page background always reaches the edge.
    const bg = pg.background as { type?: string; color?: { srgb?: { r: number; g: number; b: number; a?: number } } } | undefined;
    const bc = bg?.type === "solid" ? bg.color?.srgb : undefined;
    if (check.bleed === false && bg && (bg.type !== "solid" || (bc && (bc.a ?? 1) > 0 && (bc.r < 0.98 || bc.g < 0.98 || bc.b < 0.98)))) {
      add("edge-no-bleed", "", page, backgroundLabel);
    }
  }
}

/** The problems an export of `pages` of `doc` would have. `vector` adds the
 *  font-file check of the vector formats (PDF, EPS, SVG), `print` the image
 *  resolution check of the print formats, `printCheck` the print preflight
 *  (hairlines, small text in several inks, artwork at the edge without
 *  bleed). */
export async function exportIssues(doc: DesignFile, pages: number[], o: { vector: boolean; print?: boolean; printCheck?: PrintCheck; backgroundLabel?: string }): Promise<ExportIssue[]> {
  const issues = new Map<string, ExportIssue>();
  const add = (kind: ExportIssueKind, subject: string, page: number, element: string) => {
    const key = `${kind}|${subject}`;
    const issue = issues.get(key) ?? { kind, subject, where: [] };
    if (!issue.where.some((w) => w.page === page && w.element === element)) issue.where.push({ page, element });
    issues.set(key, issue);
  };

  const assetName = new Map<string, string>();
  for (const a of doc.assets ?? []) assetName.set(a.id, (a as { name?: string }).name || a.id);
  // Faces the canvas draws fine, for the vector check: key -> request + uses.
  const outline = new Map<string, { family: string; weight: number; italic: boolean; subject: string; where: { page: number; element: string }[] }>();

  const walk = (nodes: Node[], page: number) => {
    for (const n of nodes) {
      if ((n as { hidden?: boolean }).hidden) continue;
      if (n.type !== "video" && n.type !== "audio") {
        for (const id of assetIdsOf(n)) {
          if (imageAssets.status(id) === "missing") add("image", assetName.get(id) ?? id, page, labelOf(n));
        }
      }
      if (o.print && n.type === "image" && imageAssets.status((n as ImageNode).source.assetId) === "ready") {
        const ppi = imagePpi(n as ImageNode, doc);
        if (ppi > 0 && ppi < PRINT_MIN_PPI) {
          const name = assetName.get((n as ImageNode).source.assetId) ?? labelOf(n);
          add("image-resolution", name, page, labelOf(n));
          const issue = issues.get(`image-resolution|${name}`)!;
          issue.ppi = Math.min(issue.ppi ?? Infinity, Math.round(ppi));
        }
      }
      if (n.type === "text") {
        for (const p of (n as unknown as TextNodeLike).content ?? []) {
          for (const r of p.runs ?? []) {
            if (!r.text?.trim() || !r.style?.fontFamily) continue;
            const face = faceOf(r.style);
            const subject = `${r.style.fontFamily} ${r.style.fontStyle || face.weight}`;
            if (fonts.faceState(r.style.fontFamily, face) === "failed") { add("font", subject, page, labelOf(n)); continue; }
            if (!o.vector || r.style.fontFamily.toLowerCase() === "system") continue;
            const key = `${r.style.fontFamily.toLowerCase()}|${face.weight}|${face.italic ? 1 : 0}`;
            const entry = outline.get(key) ?? { family: r.style.fontFamily, ...face, subject, where: [] };
            entry.where.push({ page, element: labelOf(n) });
            outline.set(key, entry);
          }
        }
      }
      const kids = (n as unknown as { children?: Node[] }).children;
      if (Array.isArray(kids)) walk(kids, page);
    }
  };
  for (const i of pages) {
    const pg = doc.pages[i];
    if (pg) walk(pg.children, i + 1);
  }

  if (outline.size) {
    const { loadFace } = await import("@/lib/vectorPdf/fontSource");
    const docFonts = (doc as unknown as { fonts?: { family?: string; url?: string }[] }).fonts ?? [];
    await Promise.all([...outline.values()].map(async (f) => {
      if (await loadFace({ family: f.family, weight: f.weight, italic: f.italic, stretch: 100 }, docFonts)) return;
      for (const w of f.where) add("font-outline", f.subject, w.page, w.element);
    }));
  }
  if (o.print && o.printCheck) printChecks(doc, pages, o.printCheck, add, o.backgroundLabel ?? "background");
  return [...issues.values()];
}
