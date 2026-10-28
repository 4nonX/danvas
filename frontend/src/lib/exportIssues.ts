// What an export would lose without saying so: text drawn in a fallback font
// because its font is unknown or did not load, images that did not load,
// (vector formats) text that becomes a picture because the export has no
// font file to outline it from, and (print formats) images placed larger than
// their pixels carry, and barcodes that may not scan. The download dialog
// lists these before the file is made, so nobody finds them on the printed sheet.
//
// Call after whenRenderable(doc): "loading" counts as fine here, the export
// itself waits the same way.

import type { DesignFile, ImageNode, Node } from "@hc/schema";
import { computeEffectivePpi, createScene, type SceneNode } from "@hc/engine";
import { imageAssets } from "@/lib/assetProvider";
import { faceOf, fonts, type RunFont } from "@/lib/fontProvider";
import { barcodeOf, encodeOptionsOf, loadBarcode, symbologyLabel } from "@/lib/barcode";
import { defaultRules, type PrintRules, type RuleLevel } from "@/lib/exportProfiles";
import { isDieLine, isOverprint, withoutDieLines } from "@/lib/print/nodePrint";
import { spotNamesOf } from "@/lib/print/printColor";

export type ExportIssueKind = "font" | "font-outline" | "image" | "image-resolution" | "hairline" | "small-rich-text" | "small-text" | "edge-no-bleed" | "edge-not-extended"
  | "spot-not-allowed" | "not-cmyk" | "overprint-white" | "overprint-flattened" | "die-line-unused" | "die-line-flattened"
  | "barcode-invalid" | "barcode-small" | "barcode-quiet" | "barcode-light" | "barcode-inks" | "barcode-raster";

/** Below this effective resolution an image looks soft in print. */
export const PRINT_MIN_PPI = 150;
/** Strokes thinner than this (points, at print size) may not print. */
export const HAIRLINE_PT = 0.25;
/** Text below this size (points) in several inks blurs when the plates are
 *  slightly out of register. */
export const SMALL_TEXT_PT = 8;
/** A raster export needs at least this many pixels per barcode module. */
export const BARCODE_MIN_PX = 2;

export interface ExportIssue {
  kind: ExportIssueKind;
  /** The font face ("Trajan Pro Bold") or the image's name. */
  subject: string;
  /** image-resolution: the lowest effective resolution found, in dpi. */
  ppi?: number;
  /** The rule's limit the element falls below (dpi, pt). */
  limit?: number;
  /** Breaks a rule that refuses the download. */
  blocking?: boolean;
  /** Where it is used: page number (1-based) and the element's label. */
  where: { page: number; element: string }[];
}

type Add = (kind: ExportIssueKind, subject: string, page: number, element: string, rule?: { level: RuleLevel; limit?: number }) => void;

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
  /** The print shop's rules (else the defaults: warnings). */
  rules?: PrintRules;
  /** The vector print files (PDF, EPS): die lines take effect; elsewhere
   *  they are left out. */
  vectorPrint?: boolean;
  /** What becomes of elements that overprint: written into the file
   *  (vector PDF, EPS), computed into the pixels (CMYK TIFF, image PDF), or
   *  lost (an imposed image PDF). */
  overprint?: "file" | "raster" | "lost";
  /** The download includes a die line (vector print files). */
  dieLine?: { name: string } | null;
}

const hex = (c: { r: number; g: number; b: number }) => `#${[c.r, c.g, c.b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

/** Print preflight on what the export draws (the engine's own scene, with
 *  groups, rotation and scaling): strokes too thin to print, small text in
 *  several inks, artwork at the edge of a page exported without bleed. */
function printChecks(doc: DesignFile, pages: number[], check: PrintCheck, add: Add, backgroundLabel: string) {
  const dpi = doc.dpi ?? 96;
  const toPt = 72 / dpi;
  const rules = check.rules ?? defaultRules();
  const line = rules.minLinePt, rich = rules.richTextPt, small = rules.minTextPt, edge = rules.bleed;
  const pt = (v: number) => `${Math.round(v * 100) / 100} pt`;
  // The colours in the file: the die line's own spot is always allowed.
  const allowed = new Set([...rules.spots.allowed, ...(check.dieLine ? [check.dieLine.name] : [])].map((s) => s.trim().toLowerCase()));
  for (const i of pages) {
    const pg = doc.pages[i];
    if (!pg) continue;
    const page = i + 1;
    const visit = (sn: SceneNode, top: boolean, overprinted: boolean) => {
      const n = sn.node;
      const label = labelOf(n);
      const t = sn.worldTransform;
      const scale = Math.sqrt(Math.abs(t[0] * t[3] - t[1] * t[2])) || 1;
      const stroke = (n as { stroke?: { width?: number } }).stroke;
      if (line.level !== "off" && stroke?.width && stroke.width > 0 && stroke.width * scale * toPt < line.value) {
        add("hairline", pt(stroke.width * scale * toPt), page, label, { level: line.level, limit: line.value });
      }
      if (n.type === "text") {
        for (const p of (n as unknown as TextNodeLike).content ?? []) {
          for (const r of p.runs ?? []) {
            type PrintKeys = { cmyk?: { c: number; m: number; y: number; k: number }; spot?: { name: string } };
            const st = r.style as (RunFont & { fontSize?: number; fill?: { type?: string; color?: { srgb?: { r: number; g: number; b: number } } & PrintKeys } }) | undefined;
            if (!r.text?.trim() || !st?.fontSize) continue;
            const size = st.fontSize * scale * toPt;
            if (small.level !== "off" && size < small.value) add("small-text", pt(size), page, label, { level: small.level, limit: small.value });
            const color = st.fill?.type === "solid" ? st.fill.color : undefined;
            const c = color?.srgb;
            if (rich.level === "off" || !check.cmyk || !c || size >= rich.value) continue;
            // A spot colour is one ink; explicit CMYK is printed as given.
            if (color?.spot?.name) continue;
            if (!color?.cmyk && check.blackOnly && c.r <= 0.002 && c.g <= 0.002 && c.b <= 0.002) continue;
            const values = color?.cmyk ? [color.cmyk.c, color.cmyk.m, color.cmyk.y, color.cmyk.k] : check.cmyk(c.r, c.g, c.b);
            const inks = values.filter((v) => v >= 0.1).length;
            if (inks >= 2) add("small-rich-text", hex(c), page, label, { level: rich.level, limit: rich.value });
          }
        }
      }
      if (rules.spots.level !== "off") {
        const own = { ...n } as Record<string, unknown>;
        delete own.children;
        for (const name of spotNamesOf(own)) {
          if (!allowed.has(name.trim().toLowerCase())) add("spot-not-allowed", name, page, label, { level: rules.spots.level });
        }
      }
      // Overprinting white (or no ink at all) leaves nothing on the sheet.
      const op = overprinted || isOverprint(n);
      if (op && check.overprint !== "lost" && check.cmyk && paintsNoInk(n, check)) add("overprint-white", "", page, label);
      if (isOverprint(n) && check.cmyk && check.overprint === "lost") add("overprint-flattened", "", page, label);
      // Only whole elements: a group's bounds already hold its children.
      if (top && check.bleed === false && edge.level !== "off") {
        const b = sn.worldBounds;
        const e = 0.5;
        if (b.x <= e || b.y <= e || b.x + b.width >= pg.width - e || b.y + b.height >= pg.height - e) add("edge-no-bleed", "", page, label, { level: edge.level });
      }
      for (const ch of sn.children ?? []) visit(ch, false, op);
    };
    for (const ch of createScene(doc, i).root.children ?? []) visit(ch, true, false);
    // A coloured page background always reaches the edge.
    const bg = pg.background as { type?: string; color?: { srgb?: { r: number; g: number; b: number; a?: number } } } | undefined;
    const bc = bg?.type === "solid" ? bg.color?.srgb : undefined;
    if (check.bleed === false && edge.level !== "off" && bg && (bg.type !== "solid" || (bc && (bc.a ?? 1) > 0 && (bc.r < 0.98 || bc.g < 0.98 || bc.b < 0.98)))) {
      add("edge-no-bleed", "", page, backgroundLabel, { level: edge.level });
    }
    if (rules.spots.level !== "off") {
      for (const name of spotNamesOf(pg.background ?? null)) {
        if (!allowed.has(name.trim().toLowerCase())) add("spot-not-allowed", name, page, backgroundLabel, { level: rules.spots.level });
      }
    }
  }
}

/** Whether an element's own solid paint (fills, stroke, text) puts no ink
 *  on the sheet in a CMYK file: white, which overprinted disappears. */
function paintsNoInk(n: Node, check: PrintCheck): boolean {
  type Paint = { type?: string; color?: { srgb?: { r: number; g: number; b: number; a?: number }; cmyk?: { c: number; m: number; y: number; k: number }; spot?: { name: string } } };
  const o = n as unknown as { fills?: Paint[]; stroke?: { fill?: Paint; width?: number }; content?: { runs?: { text?: string; style?: { fill?: Paint } }[] }[] };
  const paints: Paint[] = [...(o.fills ?? []), ...(o.stroke?.width ? [o.stroke.fill ?? {}] : [])];
  for (const p of o.content ?? []) for (const r of p.runs ?? []) if (r.text?.trim() && r.style?.fill) paints.push(r.style.fill);
  const solid = paints.filter((p) => p.type === "solid" && p.color && (p.color.srgb?.a ?? 1) > 0);
  if (!solid.length || solid.length !== paints.length) return false;
  return solid.every((p) => {
    const c = p.color!;
    if (c.spot?.name) return false;
    const v = c.cmyk ? [c.cmyk.c, c.cmyk.m, c.cmyk.y, c.cmyk.k] : check.cmyk!(c.srgb!.r, c.srgb!.g, c.srgb!.b);
    return v.every((x) => x < 0.005);
  });
}

/** Barcodes that may not scan: a value that no longer encodes, modules
 *  below the symbology's minimum at their printed size, no quiet zones, bars
 *  too light, bars in several inks of a CMYK file, and for raster outputs
 *  modules narrower than BARCODE_MIN_PX pixels. */
async function barcodeChecks(doc: DesignFile, pages: number[], o: { printCheck?: PrintCheck; rasterDpi?: number }, add: (kind: ExportIssueKind, subject: string, page: number, element: string) => void) {
  // Most designs have none: look for one before building any scene.
  const has = (nodes: Node[]): boolean => nodes.some((n) => !!barcodeOf(n) || has((n as unknown as { children?: Node[] }).children ?? []));
  if (!pages.some((i) => doc.pages[i] && has(doc.pages[i].children))) return;
  const found: { sn: SceneNode; page: number }[] = [];
  for (const i of pages) {
    if (!doc.pages[i]) continue;
    const visit = (sn: SceneNode) => {
      if (barcodeOf(sn.node)) { found.push({ sn, page: i + 1 }); return; }
      for (const ch of sn.children ?? []) visit(ch);
    };
    for (const ch of createScene(doc, i).root.children ?? []) visit(ch);
  }
  if (!found.length) return;
  const mod = await loadBarcode();
  const names = symbologyLabel();
  for (const { sn, page } of found) {
    const spec = barcodeOf(sn.node)!;
    const element = labelOf(sn.node);
    const name = names[spec.symbology] ?? spec.symbology;
    if ((sn.node as { hidden?: boolean }).hidden) continue;
    const enc = mod.encode(spec.symbology, spec.value, encodeOptionsOf(spec));
    if (!enc.ok) { add("barcode-invalid", name, page, element); continue; }
    const t = sn.worldTransform;
    const scale = Math.sqrt(Math.abs(t[0] * t[3] - t[1] * t[2])) || 1;
    const rules = mod.RULES[spec.symbology];
    const moduleMm = spec.moduleMm * scale;
    if (moduleMm < rules.minModuleMm - 1e-6) add("barcode-small", `${name} ${Math.round(moduleMm * 1000) / 1000} mm`, page, element);
    if (!spec.quietZones) add("barcode-quiet", name, page, element);
    const c = spec.color.srgb;
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    if (lum > 0.4) add("barcode-light", name, page, element);
    const cmyk = o.printCheck?.cmyk;
    if (cmyk && !spec.color.spot?.name) {
      const pureBlack = !spec.color.cmyk && o.printCheck?.blackOnly && c.r <= 0.002 && c.g <= 0.002 && c.b <= 0.002;
      const values = spec.color.cmyk ? [spec.color.cmyk.c, spec.color.cmyk.m, spec.color.cmyk.y, spec.color.cmyk.k] : cmyk(c.r, c.g, c.b);
      if (!pureBlack && values.filter((v) => v >= 0.1).length >= 2) add("barcode-inks", name, page, element);
    }
    if (o.rasterDpi) {
      const px = (moduleMm / 25.4) * o.rasterDpi;
      if (px < BARCODE_MIN_PX - 1e-6) add("barcode-raster", `${name} ${Math.round(px * 10) / 10} px`, page, element);
    }
  }
}

/** The problems an export of `pages` of `doc` would have. `vector` adds the
 *  font-file check of the vector formats (PDF, EPS, SVG), `print` the image
 *  resolution check of the print formats, `printCheck` the print preflight
 *  (hairlines, small text in several inks, artwork at the edge without
 *  bleed). */
export async function exportIssues(source: DesignFile, pages: number[], o: { vector: boolean; print?: boolean; printCheck?: PrintCheck; backgroundLabel?: string; rasterDpi?: number }): Promise<ExportIssue[]> {
  const issues = new Map<string, ExportIssue>();
  const add: Add = (kind, subject, page, element, rule) => {
    if (rule?.level === "off") return;
    const key = `${kind}|${subject}`;
    const issue = issues.get(key) ?? { kind, subject, where: [], ...(rule?.limit !== undefined ? { limit: rule.limit } : {}) };
    if (rule?.level === "block") issue.blocking = true;
    if (!issue.where.some((w) => w.page === page && w.element === element)) issue.where.push({ page, element });
    issues.set(key, issue);
  };
  const rules = o.printCheck?.rules ?? defaultRules();

  // Die line elements are cut information, not artwork: checked apart.
  const doc = withoutDieLines(source);
  if (o.print && o.printCheck) {
    const visit = (nodes: Node[], page: number) => {
      for (const n of nodes) {
        if (n.hidden) continue;
        if (isDieLine(n)) {
          if (!o.printCheck!.vectorPrint) add("die-line-flattened", "", page, labelOf(n));
          else if (!o.printCheck!.dieLine) add("die-line-unused", "", page, labelOf(n));
          continue;
        }
        const c = (n as unknown as { children?: Node[] }).children;
        if (Array.isArray(c)) visit(c, page);
      }
    };
    if (doc !== source) for (const i of pages) if (source.pages[i]) visit(source.pages[i].children, i + 1);
  }

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
      if (o.print && rules.minPpi.level !== "off" && n.type === "image" && imageAssets.status((n as ImageNode).source.assetId) === "ready") {
        const ppi = imagePpi(n as ImageNode, doc);
        if (ppi > 0 && ppi < rules.minPpi.value) {
          const name = assetName.get((n as ImageNode).source.assetId) ?? labelOf(n);
          add("image-resolution", name, page, labelOf(n), { level: rules.minPpi.level, limit: rules.minPpi.value });
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
  await barcodeChecks(doc, pages, o, add);
  return [...issues.values()];
}
