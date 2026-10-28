// danvas packages (.danvas.zip): designs and templates taken from one
// instance to another with everything they need. A .hyc file alone keeps its uploads as
// references to the instance it came from, and no font files; a package
// carries the designs (as .hyc, the open file format), every upload they use,
// the workspace fonts they name, and the folders they were in.
//
// Export reads the designs and the workspace's uploads and fonts; import
// uploads the files into the target workspace, rewrites the designs'
// references to the new uploads, recreates the folders and creates the
// designs (the server validates each one on create, as for any import).
// Version history, comments and share links stay on the instance, as they do
// when designs move between workspaces. A brand kit assignment is dropped (the
// target has its own brands; a kit travels as its own .brandkit.zip).
//
// Layout:
//   danvas-package.json   the manifest (below)
//   designs/<n>-<slug>.hyc
//   templates/<n>-<slug>.hyc   (format version 2: a package with templates)
//   assets/<id>.<ext>
//   fonts/<family>-<weight>-<style>.<ext>

import type { DesignFile } from "@hc/schema";
import type { UploadedAsset, WorkspaceFont } from "@hc/sdk";
import { CodedError } from "./errors";
import { hycBlob, parseHycFile } from "./hycFile";
import { slug } from "./brandKitFile";
import { unzipFiles, zipFiles, type ZipEntry } from "./zip";

export const PACKAGE_FORMAT = "danvas.design-package";
/** The newest format this version reads. A package is written as version 1
 *  unless it carries templates (version 2), so older versions keep reading
 *  design-only packages and say a template package is from a newer version. */
export const PACKAGE_FORMAT_VERSION = 2;
export const PACKAGE_MANIFEST = "danvas-package.json";
export const PACKAGE_SUFFIX = ".danvas.zip";
/** As many designs as one copy between workspaces takes. */
export const MAX_PACKAGE_DESIGNS = 500;

export interface PackageDesign {
  file: string;
  title: string;
  /** Folder names from the exported level down (empty: top level). */
  path: string[];
}
export interface PackageAsset {
  /** The upload's id on the source instance (as the designs name it). */
  id: string;
  file: string;
  filename: string;
  mimeType: string;
  /** The upload's URL on the source instance (as the designs may name it). */
  url: string;
}
export interface PackageTemplate {
  file: string;
  title: string;
  categories: string[];
}
export interface PackageFont {
  family: string;
  weight: number;
  style: "normal" | "italic";
  file: string;
}
export interface PackageManifest {
  format: typeof PACKAGE_FORMAT;
  formatVersion: number;
  exportedAt: string;
  designs: PackageDesign[];
  /** Templates (format version 2); absent in older packages. */
  templates?: PackageTemplate[];
  assets: PackageAsset[];
  fonts: PackageFont[];
}

// --- references -------------------------------------------------------------

const UUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

/** Every UUID in the design's strings (asset ids as node references and in
 *  asset URLs); data URLs hold none. Which are uploads the caller decides. */
export function uuidsIn(v: unknown, out = new Set<string>()): Set<string> {
  if (typeof v === "string") {
    if (!v.startsWith("data:")) for (const m of v.match(UUID) ?? []) out.add(m.toLowerCase());
  } else if (Array.isArray(v)) {
    for (const x of v) uuidsIn(x, out);
  } else if (v && typeof v === "object") {
    for (const x of Object.values(v)) uuidsIn(x, out);
  }
  return out;
}

/** The font families the design names. */
export function familiesIn(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) {
    for (const x of v) familiesIn(x, out);
  } else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (k === "fontFamily" && typeof x === "string" && x.trim()) out.add(x.trim());
      else familiesIn(x, out);
    }
  }
  return out;
}

/** A copy of `v` pointing at the new uploads: old URLs become new URLs, then
 *  old ids new ids, wherever they appear in a string (not in data URLs). */
export function remapReferences<T>(v: T, ids: Map<string, string>, urls: Map<string, string>): T {
  const walk = (x: unknown): unknown => {
    if (typeof x === "string") {
      if (x.startsWith("data:") || (!ids.size && !urls.size)) return x;
      let s = x;
      for (const [from, to] of urls) if (from && s.includes(from)) s = s.split(from).join(to);
      return s.replace(UUID, (m) => ids.get(m.toLowerCase()) ?? m);
    }
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)]));
    return x;
  };
  return walk(v) as T;
}

/** The design without its brand kit assignment (the target has its own). */
function withoutBrand(file: DesignFile): DesignFile {
  const meta = (file as { meta?: Record<string, unknown> }).meta;
  if (!meta || !("brandKitId" in meta)) return file;
  const rest = { ...meta };
  delete rest.brandKitId;
  delete rest.brandKitVersion;
  delete rest.brandReviewedVersion;
  return { ...file, meta: rest } as DesignFile;
}

// --- export -----------------------------------------------------------------

export interface PackageItem {
  id: string;
  title: string;
  path: string[];
}

/** A template to take along. */
export interface PackageTemplateItem {
  id: string;
  title: string;
  categories: string[];
}

export interface PackageSources {
  designFile(id: string): Promise<DesignFile>;
  /** Needed when the package takes templates. */
  templateFile?(id: string): Promise<DesignFile>;
  /** The workspace's uploads by id. */
  assets: Map<string, Pick<UploadedAsset, "id" | "filename" | "mimeType" | "url">>;
  assetBytes(id: string): Promise<Uint8Array>;
  fonts: WorkspaceFont[];
  fontBytes(id: string): Promise<Uint8Array>;
  onProgress?: (done: number, total: number) => void;
}

export interface PackageExport {
  blob: Blob;
  designs: number;
  templates: number;
  assets: number;
  fonts: number;
  /** Designs and templates that could not be read (left out). */
  failedDesigns: string[];
  /** Uploads that could not be read (left out; the designs show them empty). */
  missingAssets: number;
}

const EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg",
  "image/avif": "avif", "image/tiff": "tif", "video/mp4": "mp4", "video/webm": "webm", "audio/mpeg": "mp3",
  "audio/wav": "wav", "audio/ogg": "ogg", "application/pdf": "pdf", "application/json": "json",
};
const extOf = (filename: string | null | undefined, mime: string | null | undefined, fallback = "bin") =>
  (mime && EXT[mime]) || filename?.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() || fallback;

/** Build the package for `items` (each design once, with its folder path)
 *  and `templates`. */
export async function exportPackage(items: readonly PackageItem[], src: PackageSources, now = new Date(), templates: readonly PackageTemplateItem[] = []): Promise<PackageExport> {
  if (items.length + templates.length > MAX_PACKAGE_DESIGNS) throw new CodedError("errors.package_too_many", "Too many designs for one package.", { max: MAX_PACKAGE_DESIGNS });
  const entries: ZipEntry[] = [];
  const manifest: PackageManifest = { format: PACKAGE_FORMAT, formatVersion: templates.length ? 2 : 1, exportedAt: now.toISOString(), designs: [], assets: [], fonts: [] };
  if (templates.length) manifest.templates = [];
  const failedDesigns: string[] = [];
  const used = new Set<string>();
  const families = new Set<string>();
  let missingAssets = 0;
  const total = items.length + templates.length;

  for (const [i, it] of items.entries()) {
    let file: DesignFile;
    try {
      file = withoutBrand(await src.designFile(it.id));
    } catch {
      failedDesigns.push(it.title);
      src.onProgress?.(i + 1, total);
      continue;
    }
    for (const id of uuidsIn(file)) if (src.assets.has(id)) used.add(id);
    familiesIn(file, families);
    const path = `designs/${String(manifest.designs.length + 1).padStart(3, "0")}-${slug(it.title, "design")}.hyc`;
    entries.push({ name: path, data: new Uint8Array(await hycBlob(file).arrayBuffer()) });
    manifest.designs.push({ file: path, title: it.title, path: it.path });
    src.onProgress?.(i + 1, total);
  }

  for (const [i, t] of templates.entries()) {
    let file: DesignFile;
    try {
      if (!src.templateFile) throw new Error("no template source");
      file = withoutBrand(await src.templateFile(t.id));
    } catch {
      failedDesigns.push(t.title);
      src.onProgress?.(items.length + i + 1, total);
      continue;
    }
    for (const id of uuidsIn(file)) if (src.assets.has(id)) used.add(id);
    familiesIn(file, families);
    const path = `templates/${String(manifest.templates!.length + 1).padStart(3, "0")}-${slug(t.title, "template")}.hyc`;
    entries.push({ name: path, data: new Uint8Array(await hycBlob(file).arrayBuffer()) });
    manifest.templates!.push({ file: path, title: t.title, categories: [...t.categories] });
    src.onProgress?.(items.length + i + 1, total);
  }

  for (const id of used) {
    const a = src.assets.get(id)!;
    try {
      const data = await src.assetBytes(id);
      const path = `assets/${id}.${extOf(a.filename, a.mimeType)}`;
      entries.push({ name: path, data });
      manifest.assets.push({ id, file: path, filename: a.filename ?? `${id}.${extOf(null, a.mimeType)}`, mimeType: a.mimeType ?? "application/octet-stream", url: a.url });
    } catch {
      missingAssets++;
    }
  }

  const names = new Set<string>();
  for (const f of src.fonts.filter((f) => families.has(f.family))) {
    try {
      const data = await src.fontBytes(f.id);
      let path = `fonts/${slug(f.family, "font")}-${f.weight}-${f.style}.${extOf(f.fileName, undefined, f.format || "woff2")}`;
      for (let n = 2; names.has(path); n++) path = path.replace(/(\.[a-z0-9]+)$/, `-${n}$1`);
      names.add(path);
      entries.push({ name: path, data });
      manifest.fonts.push({ family: f.family, weight: f.weight, style: f.style, file: path });
    } catch { /* a font that cannot be read is left out; the design falls back */ }
  }

  entries.unshift({ name: PACKAGE_MANIFEST, data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
  return { blob: zipFiles(entries), designs: manifest.designs.length, templates: manifest.templates?.length ?? 0, assets: manifest.assets.length, fonts: manifest.fonts.length, failedDesigns, missingAssets };
}

/** The download name: the one design's title, or the folder's, or a date. */
export function packageFileName(label: string | null, now = new Date()): string {
  return `${label ? slug(label, "danvas") : `danvas-${now.toISOString().slice(0, 10)}`}${PACKAGE_SUFFIX}`;
}

// --- reading ----------------------------------------------------------------

export interface ParsedPackage {
  manifest: PackageManifest;
  /** The designs, read and brought to this version's file format. */
  designs: { title: string; path: string[]; file: DesignFile }[];
  /** The templates, the same way. */
  templates: { title: string; categories: string[]; file: DesignFile }[];
  files: Map<string, Uint8Array>;
}

const notPackage = () => new CodedError("errors.package_not_a_package", "This file is not a danvas package.");
const str = (v: unknown, max = 500) => typeof v === "string" && v.length <= max;

/** Check a manifest's shape (names, paths, types); throws when it is not one. */
export function checkPackageManifest(raw: unknown): PackageManifest {
  const m = raw as Partial<PackageManifest> | null;
  if (!m || typeof m !== "object" || m.format !== PACKAGE_FORMAT) throw notPackage();
  if (typeof m.formatVersion !== "number" || m.formatVersion > PACKAGE_FORMAT_VERSION) {
    throw new CodedError("errors.package_newer", "This package was made by a newer version of danvas.");
  }
  const okPath = (p: unknown, dir: string) => str(p) && (p as string).startsWith(`${dir}/`) && !(p as string).includes("..");
  const designs = Array.isArray(m.designs) ? m.designs : null;
  const templates = Array.isArray(m.templates) ? m.templates : [];
  const assets = Array.isArray(m.assets) ? m.assets : [];
  const fonts = Array.isArray(m.fonts) ? m.fonts : [];
  if (!designs || !(designs.length + templates.length)) throw notPackage();
  if (designs.length + templates.length > MAX_PACKAGE_DESIGNS) throw new CodedError("errors.package_too_many", "Too many designs for one package.", { max: MAX_PACKAGE_DESIGNS });
  for (const d of designs) {
    if (!okPath(d?.file, "designs") || !str(d?.title) || !Array.isArray(d?.path) || !d.path.every((p) => str(p, 120) && p.trim())) throw notPackage();
  }
  for (const t of templates) {
    if (!okPath(t?.file, "templates") || !str(t?.title) || !Array.isArray(t?.categories) || !t.categories.every((c) => str(c, 120))) throw notPackage();
  }
  for (const a of assets) {
    if (!okPath(a?.file, "assets") || !str(a?.id, 64) || !str(a?.filename) || !str(a?.mimeType, 120) || !str(a?.url, 2000)) throw notPackage();
  }
  for (const f of fonts) {
    if (!okPath(f?.file, "fonts") || !str(f?.family, 200) || typeof f?.weight !== "number" || (f?.style !== "normal" && f?.style !== "italic")) throw notPackage();
  }
  return { format: PACKAGE_FORMAT, formatVersion: m.formatVersion, exportedAt: str(m.exportedAt) ? m.exportedAt! : "", designs, ...(templates.length ? { templates } : {}), assets, fonts };
}

/** Read a .danvas.zip: the manifest, every file it names, and the designs
 *  (validated and migrated like any .hyc). */
export async function readPackage(bytes: Uint8Array): Promise<ParsedPackage> {
  let entries: ZipEntry[];
  try {
    entries = await unzipFiles(bytes);
  } catch {
    throw notPackage();
  }
  const files = new Map<string, Uint8Array>();
  // A zip packed from a folder holds everything under that folder's name.
  const names = entries.map((e) => e.name.replace(/\\/g, "/").replace(/^\.\//, ""));
  const top = names.includes(PACKAGE_MANIFEST) ? "" : (names.find((n) => /^[^/]+\/danvas-package\.json$/.test(n))?.replace(PACKAGE_MANIFEST, "") ?? "");
  entries.forEach((e, i) => { if (names[i].startsWith(top)) files.set(names[i].slice(top.length), e.data); });
  const mb = files.get(PACKAGE_MANIFEST);
  if (!mb) throw notPackage();
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(mb));
  } catch {
    throw notPackage();
  }
  const manifest = checkPackageManifest(raw);
  const absent = [...manifest.designs.map((d) => d.file), ...(manifest.templates ?? []).map((t) => t.file), ...manifest.assets.map((a) => a.file), ...manifest.fonts.map((f) => f.file)].filter((f) => !files.has(f));
  if (absent.length) throw new CodedError("errors.package_file_missing", `The package lacks ${absent[0]}.`, { file: absent[0] });
  const designs = manifest.designs.map((d) => ({ title: d.title, path: d.path, file: parseHycFile(new TextDecoder().decode(files.get(d.file)!)) }));
  const templates = (manifest.templates ?? []).map((t) => ({ title: t.title, categories: t.categories, file: parseHycFile(new TextDecoder().decode(files.get(t.file)!)) }));
  return { manifest, designs, templates, files };
}

// --- importing --------------------------------------------------------------

export interface PackageTarget {
  /** Upload one file as an upload of the target workspace. */
  uploadAsset(file: File, filename: string): Promise<{ id: string; url: string }>;
  /** Add one font face to the target workspace (throws when not allowed). */
  uploadFont(file: File, face: { family: string; weight: number; style: "normal" | "italic" }): Promise<void>;
  /** Font faces the target already has ("family|weight|style"). */
  hasFonts: Set<string>;
  /** The folder for a path below the import's folder (created as needed). */
  folderFor(path: string[]): Promise<string | null>;
  /** Whether the folder already holds a design of this title (skipped). */
  exists(folderId: string | null, title: string): boolean;
  createDesign(title: string, file: DesignFile, folderId: string | null): Promise<void>;
  /** Create a template of the target workspace; absent when the caller may
   *  not publish templates there (the package's templates are then reported
   *  as not imported). */
  createTemplate?(title: string, file: DesignFile, categories: string[]): Promise<void>;
  /** Whether the workspace already has a template of this title (skipped). */
  templateExists?(title: string): boolean;
  onProgress?: (done: number, total: number, label: string) => void;
}

export interface PackageImportResult {
  designs: { title: string; status: "imported" | "skipped" | "failed"; error?: unknown }[];
  templates: { title: string; status: "imported" | "skipped" | "failed"; error?: unknown }[];
  assets: number;
  /** Font families that could not be added (no right, or a failed upload). */
  missingFonts: string[];
}

export const fontKey = (f: { family: string; weight: number; style: string }) => `${f.family}|${f.weight}|${f.style}`;

/** Bring a read package into the target. Each design succeeds or fails on
 *  its own; uploads a design needs are uploaded before it. */
export async function importPackage(p: ParsedPackage, to: PackageTarget): Promise<PackageImportResult> {
  const res: PackageImportResult = { designs: [], templates: [], assets: 0, missingFonts: [] };
  const total = p.manifest.assets.length + p.manifest.fonts.length + p.designs.length + p.templates.length;
  let done = 0;
  const step = (label: string) => to.onProgress?.(++done, total, label);

  const missing = new Set<string>();
  for (const f of p.manifest.fonts) {
    if (!to.hasFonts.has(fontKey(f))) {
      try {
        const name = f.file.split("/").pop()!;
        await to.uploadFont(new File([p.files.get(f.file)! as BlobPart], name), { family: f.family, weight: f.weight, style: f.style });
        to.hasFonts.add(fontKey(f));
      } catch {
        missing.add(f.family);
      }
    }
    step(f.family);
  }
  res.missingFonts = [...missing];

  const ids = new Map<string, string>();
  const urls = new Map<string, string>();
  for (const a of p.manifest.assets) {
    try {
      const up = await to.uploadAsset(new File([p.files.get(a.file)! as BlobPart], a.filename, { type: a.mimeType }), a.filename);
      ids.set(a.id.toLowerCase(), up.id);
      if (a.url && a.url !== up.url) urls.set(a.url, up.url);
      res.assets++;
    } catch { /* the designs show this upload empty */ }
    step(a.filename);
  }

  for (const d of p.designs) {
    try {
      const folderId = await to.folderFor(d.path);
      if (to.exists(folderId, d.title)) {
        res.designs.push({ title: d.title, status: "skipped" });
      } else {
        await to.createDesign(d.title, { ...remapReferences(d.file, ids, urls), title: d.title }, folderId);
        res.designs.push({ title: d.title, status: "imported" });
      }
    } catch (error) {
      res.designs.push({ title: d.title, status: "failed", error });
    }
    step(d.title);
  }

  for (const t of p.templates) {
    try {
      if (!to.createTemplate) throw new CodedError("errors.package_templates_not_allowed", "Your role may not publish templates in this workspace.");
      if (to.templateExists?.(t.title)) {
        res.templates.push({ title: t.title, status: "skipped" });
      } else {
        await to.createTemplate(t.title, { ...remapReferences(t.file, ids, urls), title: t.title }, t.categories);
        res.templates.push({ title: t.title, status: "imported" });
      }
    } catch (error) {
      res.templates.push({ title: t.title, status: "failed", error });
    }
    step(t.title);
  }
  return res;
}

/** What the dashboard knows, for the export: the designs and folders to take
 *  (a folder brings every design and folder inside it, with their path). */
export function packageItems(
  designIds: readonly string[],
  folderIds: readonly string[],
  designs: readonly { id: string; title: string; folderId?: string | null }[],
  folders: readonly { id: string; name: string; parentId?: string | null }[],
): PackageItem[] {
  const out: PackageItem[] = [];
  const seen = new Set<string>();
  const add = (id: string, path: string[]) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, title: designs.find((d) => d.id === id)?.title ?? "design", path });
  };
  for (const id of designIds) add(id, []);
  const selected = new Set(folderIds);
  const inSelected = (f: { parentId?: string | null }) => {
    for (let p = f.parentId; p; p = folders.find((x) => x.id === p)?.parentId) if (selected.has(p)) return true;
    return false;
  };
  const walk = (folderId: string, path: string[]) => {
    for (const d of designs) if (d.folderId === folderId) add(d.id, path);
    for (const c of folders) if (c.parentId === folderId) walk(c.id, [...path, c.name]);
  };
  for (const f of folders) if (selected.has(f.id) && !inSelected(f)) walk(f.id, [f.name]);
  return out;
}
