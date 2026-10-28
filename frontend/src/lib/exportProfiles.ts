// Export profiles: a named set of download settings, so a design exports
// with the same format, size, colour and print options again in one click.
// The server stores the settings object as sent (versioned by `v`); this
// module defines it, fills in what an older profile lacks, compares it with
// the menu, and describes it in a line, so everyone can tell what a profile
// does without opening it.

import type { ExportProfile, ExportProfileKind, FolderDefaults } from "@hc/sdk";
import type { PrintOverride } from "@/lib/print/sheet";
import { defaultImposeSettings, normalizeImpose, type ImposeSettings } from "@/lib/print/impose";
import type { RenderingIntent } from "@/lib/print/cms";
import { tr } from "@/lib/i18n";
import { normalizeTrimSize, trimSizeText, type TrimSize } from "@/lib/trimSize";

export type ExportFormat = "png" | "jpg" | "pdf" | "svg" | "apng" | "gif" | "lottie" | "mp4" | "pptx" | "md" | "hyc" | "tiff" | "eps";
export type PdfMode = "vector" | "image" | "tagged";

/** Bleed and crop marks: the pages' (designs') own settings, each part
 *  switchable, or one setting for the whole export (the designs unchanged). */
export type ProfilePrint =
  | { source: "page"; bleed: boolean; marks: boolean }
  | { source: "fixed"; override: PrintOverride };

export interface ExportSettings {
  v: 1;
  format: ExportFormat;
  pdfMode: PdfMode;
  /** Size multiplier of the raster formats (1 = the design's own size). */
  scale: number;
  transparent: boolean;
  /** JPG quality, 0..100. */
  quality: number;
  /** Several files bundled into one zip. */
  zip: boolean;
  tiffDpi: number;
  color: "cmyk" | "rgb";
  /** The ICC print profile (a workspace profile id or a built-in one);
   *  null takes the workspace's default. */
  iccProfileId: string | null;
  intent: RenderingIntent;
  blackOnly: boolean;
  overprintBlack: boolean;
  pdfx: boolean;
  registration: boolean;
  dieLine: { on: boolean; name: string; radiusMm: number };
  /** The print shop's total ink limit (TAC), per cent; null: the paper's
   *  usual (proof view and output check). */
  tacLimit: number | null;
  /** Round each design's finished size to whole millimetres. */
  roundMm: boolean;
  /** Extend artwork at the page edge into the bleed (when there is one). */
  extendBleed: boolean;
  print: ProfilePrint;
  /** Several pages on one sheet (vector and image PDF; F45). */
  impose: ImposeSettings;
  /** The finished size the profile is made for, in mm; the menu warns about
   *  designs of another size (F48). Null: any size. */
  trimSize: TrimSize | null;
  /** The colour list added to the download, and as which files; null: none.
   *  Added only for people whose role holds design.colorList. */
  colorList: ColorListAs | null;
  /** The print shop's rules the download is checked against (print
   *  formats), each off, a warning, or a reason to refuse the download. */
  rules: PrintRules;
  /** Print files (vector and image PDF, TIFF, EPS) as one package for the
   *  print shop: the file, a soft proof of every page, the colour list and a
   *  report of the settings, the check and the approval. */
  handover: boolean;
}

/** The files a colour list comes as. */
export interface ColorListAs { pdf: boolean; csv: boolean; ase: boolean }

/** What breaking a rule does: nothing, a warning, or no download. */
export type RuleLevel = "off" | "warn" | "block";

export interface PrintRules {
  /** Images below this effective resolution, dpi. */
  minPpi: { level: RuleLevel; value: number };
  /** Lines thinner than this, pt. */
  minLinePt: { level: RuleLevel; value: number };
  /** Text below this size in several inks, pt. */
  richTextPt: { level: RuleLevel; value: number };
  /** Any text below this size, pt. */
  minTextPt: { level: RuleLevel; value: number };
  /** Spot colours other than these (ignoring case); none listed: no spot
   *  colours at all. The die line's own colour is always allowed. */
  spots: { level: RuleLevel; allowed: string[] };
  /** The file must be CMYK (not RGB, not a format without CMYK). */
  cmykOnly: { level: RuleLevel };
  /** Artwork at the edge of a page exported without bleed, or not extended
   *  into it. */
  bleed: { level: RuleLevel };
}

/** The rules every download is checked against unless a profile sets its
 *  own: the checks the menu always made, as warnings. */
export function defaultRules(): PrintRules {
  return {
    minPpi: { level: "warn", value: 150 },
    minLinePt: { level: "warn", value: 0.25 },
    richTextPt: { level: "warn", value: 8 },
    minTextPt: { level: "off", value: 6 },
    spots: { level: "off", allowed: [] },
    cmykOnly: { level: "off" },
    bleed: { level: "warn" },
  };
}

const LEVELS: RuleLevel[] = ["off", "warn", "block"];

/** Stored rules, completed; missing or invalid parts from the defaults. */
export function normalizeRules(raw: unknown): PrintRules {
  const d = defaultRules();
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, Record<string, unknown> | undefined>;
  const level = (v: unknown, fallback: RuleLevel) => (LEVELS.includes(v as RuleLevel) ? (v as RuleLevel) : fallback);
  const valued = (k: "minPpi" | "minLinePt" | "richTextPt" | "minTextPt", min: number, max: number) => ({
    level: level(r[k]?.level, d[k].level),
    value: num(r[k]?.value, d[k].value, min, max),
  });
  const allowed = Array.isArray(r.spots?.allowed)
    ? [...new Set((r.spots!.allowed as unknown[]).filter((s): s is string => typeof s === "string").map((s) => s.trim().slice(0, 40)).filter(Boolean))].slice(0, 50)
    : [];
  return {
    minPpi: valued("minPpi", 50, 2400),
    minLinePt: valued("minLinePt", 0.01, 10),
    richTextPt: valued("richTextPt", 1, 72),
    minTextPt: valued("minTextPt", 1, 72),
    spots: { level: level(r.spots?.level, d.spots.level), allowed },
    cmykOnly: { level: level(r.cmykOnly?.level, d.cmykOnly.level) },
    bleed: { level: level(r.bleed?.level, d.bleed.level) },
  };
}

/** How many rules refuse the download when broken. */
export const blockingRules = (r: PrintRules) => Object.values(r).filter((x) => x.level === "block").length;

const FORMATS: ExportFormat[] = ["png", "jpg", "pdf", "svg", "apng", "gif", "lottie", "mp4", "pptx", "md", "hyc", "tiff", "eps"];

/** What a new menu starts from; also fills in what an older profile lacks. */
export function defaultExportSettings(): ExportSettings {
  return {
    v: 1, format: "png", pdfMode: "vector", scale: 1, transparent: true, quality: 92, zip: true, tiffDpi: 300,
    color: "cmyk", iccProfileId: null, intent: "relative", blackOnly: true, overprintBlack: true, pdfx: true, registration: true,
    dieLine: { on: false, name: tr("editor.die_line_default_name"), radiusMm: 2 },
    tacLimit: null,
    roundMm: false,
    extendBleed: true,
    print: { source: "page", bleed: true, marks: true },
    impose: defaultImposeSettings(),
    trimSize: null,
    colorList: null,
    rules: defaultRules(),
    handover: false,
  };
}

const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);

/** Bleed and marks as stored in a profile, completed; `fallback` when
 *  missing or invalid. Shared by export profiles and print presets. */
export function normalizeProfilePrint(raw: unknown, fallback: ProfilePrint): ProfilePrint {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (p.source === "fixed" && p.override && typeof p.override === "object") {
    const o = p.override as Record<string, unknown>;
    return {
      source: "fixed",
      override: {
        bleed: bool(o.bleed, false), bleedMm: num(o.bleedMm, 3, 0, 50), marks: bool(o.marks, false),
        style: ["solid", "dashed", "dotted"].includes(o.style as string) ? (o.style as string) : "solid",
        ...(o.color && typeof o.color === "object" && "srgb" in (o.color as object) ? { color: o.color as PrintOverride["color"] } : {}),
        weightPt: num(o.weightPt, 0.25, 0.05, 5), lengthMm: num(o.lengthMm, 5, 1, 30), offsetMm: num(o.offsetMm, 3, 0, 30),
      },
    };
  }
  if (p.source === "page") return { source: "page", bleed: bool(p.bleed, fallback.source === "page" ? fallback.bleed : true), marks: bool(p.marks, fallback.source === "page" ? fallback.marks : true) };
  return fallback;
}

/** A stored profile's settings as a complete, valid object: unknown fields
 *  dropped, missing or invalid ones from the defaults. */
export function normalizeSettings(raw: unknown): ExportSettings {
  const d = defaultExportSettings();
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const dl = (r.dieLine && typeof r.dieLine === "object" ? r.dieLine : {}) as Record<string, unknown>;
  const print = normalizeProfilePrint(r.print, d.print);
  return {
    v: 1,
    format: FORMATS.includes(r.format as ExportFormat) ? (r.format as ExportFormat) : d.format,
    pdfMode: r.pdfMode === "image" || r.pdfMode === "tagged" ? r.pdfMode : "vector",
    scale: num(r.scale, d.scale, 0.1, 10),
    transparent: bool(r.transparent, d.transparent),
    quality: num(r.quality, d.quality, 1, 100),
    zip: bool(r.zip, d.zip),
    tiffDpi: num(r.tiffDpi, d.tiffDpi, 72, 2400),
    color: r.color === "rgb" ? "rgb" : "cmyk",
    iccProfileId: typeof r.iccProfileId === "string" && r.iccProfileId ? r.iccProfileId : null,
    intent: r.intent === "perceptual" ? "perceptual" : "relative",
    blackOnly: bool(r.blackOnly, d.blackOnly),
    overprintBlack: bool(r.overprintBlack, d.overprintBlack),
    pdfx: bool(r.pdfx, d.pdfx),
    registration: bool(r.registration, d.registration),
    dieLine: { on: bool(dl.on, false), name: str(dl.name, d.dieLine.name).slice(0, 40), radiusMm: num(dl.radiusMm, 2, 0, 50) },
    tacLimit: typeof r.tacLimit === "number" && Number.isFinite(r.tacLimit) ? Math.min(400, Math.max(200, Math.round(r.tacLimit))) : null,
    roundMm: bool(r.roundMm, d.roundMm),
    extendBleed: bool(r.extendBleed, d.extendBleed),
    print,
    impose: normalizeImpose(r.impose),
    trimSize: normalizeTrimSize(r.trimSize),
    colorList: normalizeColorListAs(r.colorList),
    rules: normalizeRules(r.rules),
    handover: bool(r.handover, d.handover),
  };
}

/** A stored colour list choice; an older profile (without one), or one with
 *  every file switched off, adds none. */
export function normalizeColorListAs(raw: unknown): ColorListAs | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const v = { pdf: r.pdf === true, csv: r.csv === true, ase: r.ase === true };
  return v.pdf || v.csv || v.ase ? v : null;
}

/** Whether the menu still matches the profile (no unsaved change). */
export function sameSettings(a: ExportSettings, b: ExportSettings): boolean {
  return JSON.stringify(normalizeSettings(a)) === JSON.stringify(normalizeSettings(b));
}

export const FORMAT_LABEL: Record<ExportFormat, string> = {
  png: "PNG", jpg: "JPG", pdf: "PDF", svg: "SVG", apng: "APNG", gif: "GIF", lottie: "Lottie", mp4: "MP4", pptx: "PPTX", md: "MD", hyc: "HYC", tiff: "TIFF", eps: "EPS",
};

const mmText = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/** Design resolutions whose "300 dpi" size step a scale can be. */
const PRINT_300 = [96, 72, 150, 300];

/** One line saying what a profile does ("PDF vector · CMYK, PSO Uncoated ·
 *  PDF/X-4 · bleed 1.5 mm · die line Stanze"). `iccName` names a print
 *  profile id; unknown ids say "default profile". */
export function describeSettings(s: ExportSettings, iccName: (id: string) => string | undefined = () => undefined): string {
  const parts: string[] = [];
  const f = s.format;
  if (f === "pdf") parts.push(s.pdfMode === "vector" ? tr("editor.profile_pdf_vector") : s.pdfMode === "image" ? tr("editor.profile_pdf_image") : tr("editor.profile_pdf_tagged"));
  else parts.push(FORMAT_LABEL[f]);
  const raster = f === "png" || f === "jpg" || (f === "pdf" && s.pdfMode === "image");
  // As the size buttons say it: a multiple of the design's size, or 300 dpi
  // (a profile does not know the design, so no pixel size).
  if (raster && s.scale !== 1) parts.push(PRINT_300.some((dpi) => Math.abs(s.scale * dpi - 300) < 0.5) ? "300 dpi" : `${mmText(s.scale)}×`);
  if (f === "tiff") parts.push(`${s.tiffDpi} dpi`);
  if (f === "jpg") parts.push(tr("editor.profile_quality", { q: s.quality }));
  if (f === "png" && s.transparent) parts.push(tr("editor.profile_transparent"));
  const cmykCapable = f === "tiff" || f === "eps" || (f === "pdf" && s.pdfMode !== "tagged");
  if (cmykCapable) {
    const icc = s.iccProfileId ? iccName(s.iccProfileId) ?? tr("editor.profile_chosen_icc") : tr("editor.profile_default_icc");
    parts.push(s.color === "cmyk" ? `CMYK, ${icc}` : "RGB");
    if (s.color === "cmyk" && f === "pdf" && s.pdfx) parts.push("PDF/X-4");
    if (s.color === "cmyk" && s.tacLimit !== null) parts.push(`TAC ${s.tacLimit} %`);
  }
  const sheetCapable = cmykCapable || f === "png" || f === "jpg" || f === "svg";
  if (s.trimSize) parts.push(tr("editor.profile_trim_size", { size: trimSizeText(s.trimSize) }));
  if (sheetCapable && s.roundMm) parts.push(tr("editor.profile_round_mm"));
  if (sheetCapable) {
    if (s.print.source === "fixed") {
      const o = s.print.override;
      if (o.bleed) parts.push(tr("editor.profile_bleed_mm", { mm: mmText(o.bleedMm) }));
      if (o.marks) parts.push(tr("editor.profile_crop_marks"));
      if (!o.bleed && !o.marks) parts.push(tr("editor.profile_bare_page"));
    } else if (s.print.bleed || s.print.marks) {
      parts.push(tr("editor.profile_page_print"));
    }
  }
  const vectorPrint = f === "eps" || (f === "pdf" && s.pdfMode === "vector");
  if (vectorPrint && s.dieLine.on && s.dieLine.name.trim()) parts.push(tr("editor.profile_die_line", { name: s.dieLine.name.trim() }));
  if (f === "pdf" && s.pdfMode !== "tagged" && s.impose.on) parts.push(tr("editor.profile_imposed", { sheet: imposeSheetLabel(s.impose) }));
  if (s.colorList && f !== "hyc" && f !== "md" && f !== "lottie") {
    // i18n-ignore: file type names
    const files = [s.colorList.pdf && "PDF", s.colorList.csv && "CSV", s.colorList.ase && "ASE"].filter(Boolean).join(", ");
    parts.push(tr("editor.profile_color_list", { files }));
  }
  if (s.handover && printFile(s)) parts.push(tr("editor.profile_handover"));
  const blocking = blockingRules(s.rules);
  if (blocking) parts.push(tr("editor.profile_rules_blocking", { count: blocking }));
  else if (JSON.stringify(s.rules) !== JSON.stringify(defaultRules())) parts.push(tr("editor.profile_rules_own"));
  return parts.join(" · ");
}

/** A file for print: vector or image PDF, TIFF, EPS (what the approval
 *  holds back, and what a print shop package is made of). */
export const printFile = (s: Pick<ExportSettings, "format" | "pdfMode">) => (s.format === "pdf" && s.pdfMode !== "tagged") || s.format === "tiff" || s.format === "eps";

/** The profile the menu starts from: the folder's default (F44) when the
 *  designs' folder names one that is in the list, else the user's default,
 *  else the workspace's, else none. */
export function defaultProfile(profiles: ExportProfile[], folderProfileId?: string | null): ExportProfile | null {
  const fromFolder = folderProfileId ? profiles.find((p) => p.id === folderProfileId) : undefined;
  return fromFolder ?? profiles.find((p) => p.scope === "personal" && p.isDefault) ?? profiles.find((p) => p.scope === "workspace" && p.isDefault) ?? null;
}

/** The folder default of one kind that every design opens with: only when
 *  all of them are in folders resolving to the same profile (F44 FR-7). */
export async function folderDefaultFor(folderIds: (string | null | undefined)[], kind: ExportProfileKind, load: (folderId: string) => Promise<FolderDefaults>): Promise<{ profileId: string; folderName: string } | null> {
  if (!folderIds.length || folderIds.some((f) => !f)) return null;
  const distinct = [...new Set(folderIds as string[])];
  const found = await Promise.all(distinct.map((f) => load(f).then((d) => d.effective[kind] ?? null, () => null)));
  const first = found[0];
  if (!first || found.some((e) => !e || e.profileId !== first.profileId)) return null;
  return { profileId: first.profileId, folderName: first.folderName };
}

/** The sheet of an imposition as the interface names it. */
export function imposeSheetLabel(s: ImposeSettings): string {
  // i18n-ignore: paper format names are the same in every language
  const names: Record<string, string> = { a4: "A4", a3: "A3", sra3: "SRA3", letter: "Letter" };
  return s.sheet === "custom" ? `${s.widthMm} x ${s.heightMm} mm` : names[s.sheet]; // i18n-ignore: a size
}

/** A name not yet taken among `taken` (ignoring case): "Name (2)", "(3)"... */
export function freeName(name: string, taken: string[]): string {
  const used = new Set(taken.map((t) => t.trim().toLowerCase()));
  const base = name.trim();
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}
