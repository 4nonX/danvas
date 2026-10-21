// Export profiles: a named set of download settings, so a design exports
// with the same format, size, colour and print options again in one click.
// The server stores the settings object as sent (versioned by `v`); this
// module defines it, fills in what an older profile lacks, compares it with
// the menu, and describes it in a line, so everyone can tell what a profile
// does without opening it.

import type { ExportProfile } from "@hc/sdk";
import type { PrintOverride } from "@/lib/print/sheet";
import type { RenderingIntent } from "@/lib/print/cms";
import { tr } from "@/lib/i18n";

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
}

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
  };
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
  return parts.join(" · ");
}

/** The profile the menu starts from: the user's default, else the
 *  workspace's, else none. */
export function defaultProfile(profiles: ExportProfile[]): ExportProfile | null {
  return profiles.find((p) => p.scope === "personal" && p.isDefault) ?? profiles.find((p) => p.scope === "workspace" && p.isDefault) ?? null;
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
