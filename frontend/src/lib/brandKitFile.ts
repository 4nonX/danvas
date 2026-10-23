// Brand kit files: a kit as one portable `.brandkit.zip`, to move it between
// workspaces or instances, keep it as a backup, or write one by hand. The
// format is described in docs/brand-kit-format.md; keep the two in step.
//
// A kit in the database points at workspace data by id (logo and collection
// assets, fonts by family name). A file cannot carry ids that mean anything
// elsewhere, so the export puts the files themselves in the archive and the
// import uploads them into the target workspace and writes the new ids.
//
// The pure parts (building the manifest, reading and checking a file, turning
// a manifest into a kit patch) take their I/O as arguments so they run in
// tests without a server.

import type { BrandCollection, BrandControls, BrandFont, BrandKit, BrandKitPatch, BrandLogo, BrandPalette, BrandVoice, UploadedAsset, WorkspaceFont } from "@hc/sdk";
import { CodedError } from "./errors";
import { unzipFiles, zipFiles, type ZipEntry } from "./zip";

export const KIT_FORMAT = "danvas.brandkit";
export const KIT_FORMAT_VERSION = 1;
export const MANIFEST = "brandkit.json";

type Cmyk = { c: number; m: number; y: number; k: number };
/** A swatch. `hex` is the sRGB value; `cmyk` and `spot` carry the print
 *  definitions when the kit has them. */
export interface KitFileColor { id?: string; role: string; name?: string; hex: string; cmyk?: Cmyk; spot?: { name: string; book?: string; fallback: Cmyk } }
export interface KitFilePalette { id?: string; name: string; colors: KitFileColor[] }
export interface KitFileFont { id?: string; role: string; family: string; defaultStyle?: BrandFont["defaultStyle"] }
export interface KitFileFontFile { family: string; weight: number; style: "normal" | "italic"; file: string }
export interface KitFileLogo {
  id?: string; label: string; file: string; darkFile?: string; lightFile?: string; clearSpaceRatio?: number; minSizePx?: number;
  /** One file per version of the kit (logoVersions), by version id. */
  versionFiles?: Record<string, string>;
}
export interface KitFileLogoVersion { id: string; name: string; ground: "light" | "dark" }
export interface KitFileCollection { id?: string; kind: BrandCollection["kind"]; name?: string; files: string[] }

/** The manifest, `brandkit.json` at the root of the archive. */
export interface KitFile {
  format: typeof KIT_FORMAT;
  formatVersion: number;
  name: string;
  exportedAt?: string;
  palettes: KitFilePalette[];
  fonts: KitFileFont[];
  fontFiles: KitFileFontFile[];
  logos: KitFileLogo[];
  /** The versions the logos come in (colour, black, white, ...). Optional. */
  logoVersions?: KitFileLogoVersion[];
  collections: KitFileCollection[];
  voice: Omit<BrandVoice, "modelProfileId"> | null;
  controls?: Partial<BrandControls>;
  /** The original upload name of a file by its path (paths are slugged), so
   *  an imported graphic keeps its name. Optional. */
  fileNames?: Record<string, string>;
}

/** A read kit file: the manifest plus the archive's other files by path. */
export interface ParsedKitFile {
  manifest: KitFile;
  files: Map<string, Uint8Array>;
}

// --- colors -----------------------------------------------------------------

const byte = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");

/** sRGB color -> `#rrggbb`, or `#rrggbbaa` when not opaque. */
export function hexOfColor(c: BrandPalette["colors"][number]["value"]): string {
  const { r, g, b, a } = c.srgb;
  const hex = `#${byte(r)}${byte(g)}${byte(b)}`;
  return a !== undefined && a < 1 ? hex + byte(a) : hex;
}

/** `#rgb`, `#rrggbb` or `#rrggbbaa` -> sRGB color; null when malformed. */
export function colorOfHex(hex: string): BrandPalette["colors"][number]["value"] | null {
  let h = hex.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(h)) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) return null;
  const at = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return { srgb: { r: at(0), g: at(2), b: at(4), a: h.length === 8 ? at(6) : 1 } } as BrandPalette["colors"][number]["value"];
}

// --- export -----------------------------------------------------------------

const MIME_EXT: Record<string, string> = {
  "image/svg+xml": "svg", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif",
};

/** A file name made of safe characters only, so every zip tool and file
 *  system takes it. */
export function slug(s: string, fallback = "file"): string {
  const out = s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return out || fallback;
}

function extOf(asset: Pick<UploadedAsset, "filename" | "mimeType"> | undefined): string {
  const fromName = asset?.filename?.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  return (asset?.mimeType && MIME_EXT[asset.mimeType]) || fromName || "bin";
}

export interface ExportSources {
  /** The workspace's assets by id (name and type, for the file names). */
  assets: Map<string, Pick<UploadedAsset, "id" | "filename" | "mimeType">>;
  /** The bytes of one asset. */
  assetBytes(id: string): Promise<Uint8Array>;
  /** The workspace's font faces. */
  fonts: WorkspaceFont[];
  fontBytes(id: string): Promise<Uint8Array>;
}

export interface ExportResult {
  blob: Blob;
  fileName: string;
  /** Asset ids the kit names that could not be read (left out of the file). */
  missing: string[];
}

/** Build the archive for `kit`. */
export async function exportKit(kit: BrandKit, src: ExportSources, now = new Date()): Promise<ExportResult> {
  const entries: ZipEntry[] = [];
  const written = new Map<string, string>(); // asset id -> path in the archive
  const used = new Set<string>([MANIFEST]);
  const missing: string[] = [];

  const unique = (path: string) => {
    if (!used.has(path)) { used.add(path); return path; }
    const dot = path.lastIndexOf(".");
    for (let i = 2; ; i++) {
      const p = `${path.slice(0, dot)}-${i}${path.slice(dot)}`;
      if (!used.has(p)) { used.add(p); return p; }
    }
  };

  const fileNames: Record<string, string> = {};
  const put = async (assetId: string | undefined, dir: string, name: string): Promise<string | undefined> => {
    if (!assetId) return undefined;
    const known = written.get(assetId);
    if (known) return known;
    try {
      const data = await src.assetBytes(assetId);
      const asset = src.assets.get(assetId);
      const base = asset?.filename ? asset.filename.replace(/\.[a-z0-9]{2,5}$/i, "") : name;
      const path = unique(`${dir}/${slug(base, name)}.${extOf(asset)}`);
      entries.push({ name: path, data });
      written.set(assetId, path);
      if (asset?.filename) fileNames[path] = asset.filename;
      return path;
    } catch {
      missing.push(assetId);
      return undefined;
    }
  };

  const logos: KitFileLogo[] = [];
  for (const l of kit.logos) {
    const file = await put(l.assetId, "logos", l.label || "logo");
    if (!file) continue;
    const darkFile = await put(l.variants?.dark, "logos", `${l.label || "logo"}-dark`);
    const lightFile = await put(l.variants?.light, "logos", `${l.label || "logo"}-light`);
    const versionFiles: Record<string, string> = {};
    for (const [vid, assetId] of Object.entries(l.versions ?? {})) {
      const vname = kit.logoVersions?.find((v) => v.id === vid)?.name || vid;
      const f = await put(assetId, "logos", `${l.label || "logo"}-${vname}`);
      if (f) versionFiles[vid] = f;
    }
    logos.push({
      id: l.id, label: l.label, file,
      ...(darkFile ? { darkFile } : {}),
      ...(lightFile ? { lightFile } : {}),
      ...(l.clearSpaceRatio !== undefined ? { clearSpaceRatio: l.clearSpaceRatio } : {}),
      ...(l.minSizePx !== undefined ? { minSizePx: l.minSizePx } : {}),
      ...(Object.keys(versionFiles).length ? { versionFiles } : {}),
    });
  }

  const collections: KitFileCollection[] = [];
  for (const c of kit.collections) {
    const files: string[] = [];
    for (const id of c.assetIds) {
      const f = await put(id, c.kind, c.kind.replace(/s$/, ""));
      if (f) files.push(f);
    }
    collections.push({ id: c.id, kind: c.kind, ...(c.name ? { name: c.name } : {}), files });
  }

  // Every workspace face of a family the kit names; other families are
  // built-in or library fonts and need no file.
  const families = new Set(kit.fonts.map((f) => f.fontFamily));
  const fontFiles: KitFileFontFile[] = [];
  for (const face of src.fonts.filter((f) => families.has(f.family))) {
    try {
      const data = await src.fontBytes(face.id);
      const path = unique(`fonts/${slug(face.family, "font")}-${face.weight}${face.style === "italic" ? "-italic" : ""}.${slug(face.format, "font")}`);
      entries.push({ name: path, data });
      fontFiles.push({ family: face.family, weight: face.weight, style: face.style, file: path });
    } catch {
      missing.push(face.id);
    }
  }

  const manifest: KitFile = {
    format: KIT_FORMAT,
    formatVersion: KIT_FORMAT_VERSION,
    name: kit.name,
    exportedAt: now.toISOString(),
    palettes: kit.palettes.map((p) => ({
      id: p.id,
      name: p.name,
      colors: p.colors.map((c) => ({
        id: c.id, role: c.role, ...(c.name ? { name: c.name } : {}), hex: hexOfColor(c.value),
        ...(c.value.cmyk ? { cmyk: c.value.cmyk } : {}),
        ...(c.value.spot ? { spot: c.value.spot } : {}),
      })),
    })),
    fonts: kit.fonts.map((f) => ({ id: f.id, role: f.role, family: f.fontFamily, ...(f.defaultStyle ? { defaultStyle: f.defaultStyle } : {}) })),
    fontFiles,
    logos,
    ...(kit.logoVersions?.length ? { logoVersions: kit.logoVersions.map((v) => ({ id: v.id, name: v.name, ground: v.ground })) } : {}),
    collections,
    // The AI model profile exists only in the source workspace.
    voice: kit.voice ? { tone: kit.voice.tone, doSay: kit.voice.doSay, dontSay: kit.voice.dontSay, ...(kit.voice.sampleCopy ? { sampleCopy: kit.voice.sampleCopy } : {}) } : null,
    controls: { ...kit.controls },
    ...(Object.keys(fileNames).length ? { fileNames } : {}),
  };
  entries.unshift({ name: MANIFEST, data: new TextEncoder().encode(JSON.stringify(manifest, null, 2) + "\n") });
  return { blob: zipFiles(entries), fileName: `${slug(kit.name, "brand-kit")}.brandkit.zip`, missing };
}

// --- reading a file ---------------------------------------------------------

const bad = (detail: string): CodedError =>
  new CodedError("errors.brandkit_file_invalid", `This is not a valid brand kit file: ${detail}`, { detail });

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, where: string): string => {
  if (typeof v !== "string") throw bad(`${where} must be text`);
  return v;
};
const optStr = (v: unknown, where: string): string | undefined => (v === undefined || v === null ? undefined : str(v, where));
const optNum = (v: unknown, where: string): number | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) throw bad(`${where} must be a number`);
  return v;
};
const arr = (v: unknown, where: string): unknown[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw bad(`${where} must be a list`);
  return v;
};
const strList = (v: unknown, where: string): string[] => arr(v, where).map((x, i) => str(x, `${where}[${i}]`));

const cmykOf = (v: unknown, where: string): Cmyk => {
  if (!isObj(v)) throw bad(`${where} must be an object`);
  const ch = (k: "c" | "m" | "y" | "k") => {
    const n = optNum(v[k], `${where}.${k}`);
    if (n === undefined || n < 0 || n > 1) throw bad(`${where}.${k} must be a number from 0 to 1`);
    return n;
  };
  return { c: ch("c"), m: ch("m"), y: ch("y"), k: ch("k") };
};

/** Normalize a path inside the archive: forward slashes, no leading `./`. */
const norm = (p: string) => p.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/^\/+/, "");

/** A logo's version files: version id -> path, or undefined when absent. */
const versionFilesOf = (v: unknown, where: string): Record<string, string> | undefined => {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v)) throw bad(`${where} must be an object`);
  const out: Record<string, string> = {};
  for (const [k, f] of Object.entries(v)) out[k] = norm(str(f, `${where}["${k}"]`));
  return Object.keys(out).length ? out : undefined;
};

/** Check a manifest and bring it into the typed shape. Throws a CodedError
 *  naming the first problem. */
export function checkManifest(raw: unknown): KitFile {
  if (!isObj(raw) || raw.format !== KIT_FORMAT) throw new CodedError("errors.brandkit_not_a_kit_file", "This file is not a brand kit file.");
  const v = raw.formatVersion;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) throw bad("formatVersion must be a whole number");
  if (v > KIT_FORMAT_VERSION) {
    throw new CodedError("errors.brandkit_newer_format", `This brand kit file was made by a newer version (format ${v}); update to import it.`, { version: v });
  }
  const name = str(raw.name, "name").trim();
  if (!name) throw bad("name is empty");

  const palettes = arr(raw.palettes, "palettes").map((p, i) => {
    if (!isObj(p)) throw bad(`palettes[${i}] must be an object`);
    return {
      id: optStr(p.id, `palettes[${i}].id`),
      name: optStr(p.name, `palettes[${i}].name`) ?? "",
      colors: arr(p.colors, `palettes[${i}].colors`).map((c, j) => {
        const at = `palettes[${i}].colors[${j}]`;
        if (!isObj(c)) throw bad(`${at} must be an object`);
        const hex = str(c.hex, `${at}.hex`);
        if (!colorOfHex(hex)) throw bad(`${at}.hex "${hex}" is not a color`);
        const cmyk = c.cmyk === undefined || c.cmyk === null ? undefined : cmykOf(c.cmyk, `${at}.cmyk`);
        let spot: KitFileColor["spot"];
        if (c.spot !== undefined && c.spot !== null) {
          if (!isObj(c.spot)) throw bad(`${at}.spot must be an object`);
          spot = { name: str(c.spot.name, `${at}.spot.name`), book: optStr(c.spot.book, `${at}.spot.book`), fallback: cmykOf(c.spot.fallback, `${at}.spot.fallback`) };
          if (spot.book === undefined) delete spot.book;
        }
        return { id: optStr(c.id, `${at}.id`), role: optStr(c.role, `${at}.role`) ?? "accent", name: optStr(c.name, `${at}.name`), hex, ...(cmyk ? { cmyk } : {}), ...(spot ? { spot } : {}) };
      }),
    };
  });

  const fonts = arr(raw.fonts, "fonts").map((f, i) => {
    if (!isObj(f)) throw bad(`fonts[${i}] must be an object`);
    const ds = f.defaultStyle;
    if (ds !== undefined && ds !== null && !isObj(ds)) throw bad(`fonts[${i}].defaultStyle must be an object`);
    const defaultStyle = isObj(ds) ? {
      weight: optNum(ds.weight, `fonts[${i}].defaultStyle.weight`),
      size: optNum(ds.size, `fonts[${i}].defaultStyle.size`),
      tracking: optNum(ds.tracking, `fonts[${i}].defaultStyle.tracking`),
    } : undefined;
    return { id: optStr(f.id, `fonts[${i}].id`), role: optStr(f.role, `fonts[${i}].role`) ?? "body", family: str(f.family, `fonts[${i}].family`), defaultStyle };
  });

  const fontFiles = arr(raw.fontFiles, "fontFiles").map((f, i) => {
    if (!isObj(f)) throw bad(`fontFiles[${i}] must be an object`);
    const style = f.style ?? "normal";
    if (style !== "normal" && style !== "italic") throw bad(`fontFiles[${i}].style must be "normal" or "italic"`);
    return { family: str(f.family, `fontFiles[${i}].family`), weight: optNum(f.weight, `fontFiles[${i}].weight`) ?? 400, style, file: norm(str(f.file, `fontFiles[${i}].file`)) } as KitFileFontFile;
  });

  const logos = arr(raw.logos, "logos").map((l, i) => {
    if (!isObj(l)) throw bad(`logos[${i}] must be an object`);
    const darkFile = optStr(l.darkFile, `logos[${i}].darkFile`);
    const lightFile = optStr(l.lightFile, `logos[${i}].lightFile`);
    return {
      id: optStr(l.id, `logos[${i}].id`),
      label: optStr(l.label, `logos[${i}].label`) ?? "",
      file: norm(str(l.file, `logos[${i}].file`)),
      darkFile: darkFile ? norm(darkFile) : undefined,
      lightFile: lightFile ? norm(lightFile) : undefined,
      clearSpaceRatio: optNum(l.clearSpaceRatio, `logos[${i}].clearSpaceRatio`),
      minSizePx: optNum(l.minSizePx, `logos[${i}].minSizePx`),
      versionFiles: versionFilesOf(l.versionFiles, `logos[${i}].versionFiles`),
    };
  });

  const logoVersions = arr(raw.logoVersions, "logoVersions").map((v, i) => {
    if (!isObj(v)) throw bad(`logoVersions[${i}] must be an object`);
    if (v.ground !== "light" && v.ground !== "dark") throw bad(`logoVersions[${i}].ground must be "light" or "dark"`);
    return { id: str(v.id, `logoVersions[${i}].id`), name: optStr(v.name, `logoVersions[${i}].name`) ?? "", ground: v.ground } as KitFileLogoVersion;
  });
  for (const [i, l] of logos.entries()) {
    for (const vid of Object.keys(l.versionFiles ?? {})) {
      if (!logoVersions.some((v) => v.id === vid)) throw bad(`logos[${i}].versionFiles names "${vid}", which is not in logoVersions`);
    }
  }

  const collections = arr(raw.collections, "collections").map((c, i) => {
    if (!isObj(c)) throw bad(`collections[${i}] must be an object`);
    if (c.kind !== "photos" && c.kind !== "graphics" && c.kind !== "icons") throw bad(`collections[${i}].kind must be "photos", "graphics" or "icons"`);
    const cname = optStr(c.name, `collections[${i}].name`);
    return { id: optStr(c.id, `collections[${i}].id`), kind: c.kind, ...(cname ? { name: cname } : {}), files: strList(c.files, `collections[${i}].files`).map(norm) } as KitFileCollection;
  });

  let voice: KitFile["voice"] = null;
  if (raw.voice !== undefined && raw.voice !== null) {
    if (!isObj(raw.voice)) throw bad("voice must be an object");
    voice = {
      tone: strList(raw.voice.tone, "voice.tone"),
      doSay: strList(raw.voice.doSay, "voice.doSay"),
      dontSay: strList(raw.voice.dontSay, "voice.dontSay"),
      sampleCopy: optStr(raw.voice.sampleCopy, "voice.sampleCopy"),
    };
  }

  let controls: Partial<BrandControls> | undefined;
  if (raw.controls !== undefined && raw.controls !== null) {
    const c = raw.controls;
    if (!isObj(c)) throw bad("controls must be an object");
    controls = {};
    for (const k of ["lockColors", "lockFonts", "restrictTemplates"] as const) {
      if (c[k] === undefined) continue;
      if (typeof c[k] !== "boolean") throw bad(`controls.${k} must be true or false`);
      controls[k] = c[k];
    }
    if (c.lintPolicy !== undefined) {
      if (c.lintPolicy !== "off" && c.lintPolicy !== "warn" && c.lintPolicy !== "block") throw bad(`controls.lintPolicy must be "off", "warn" or "block"`);
      controls.lintPolicy = c.lintPolicy;
    }
  }

  let fileNames: Record<string, string> | undefined;
  if (raw.fileNames !== undefined && raw.fileNames !== null) {
    if (!isObj(raw.fileNames)) throw bad("fileNames must be an object");
    fileNames = {};
    for (const [k, v] of Object.entries(raw.fileNames)) {
      if (typeof v !== "string") throw bad(`fileNames["${k}"] must be text`);
      const base = v.split(/[\\/]/).pop()!.trim();
      if (base) fileNames[norm(k)] = base.slice(0, 200);
    }
  }

  return {
    format: KIT_FORMAT, formatVersion: v, name,
    exportedAt: optStr(raw.exportedAt, "exportedAt"),
    palettes, fonts, fontFiles, logos, collections, voice, controls,
    ...(logoVersions.length ? { logoVersions } : {}),
    ...(fileNames ? { fileNames } : {}),
  };
}

/** Every file path the manifest names. */
export function referencedFiles(m: KitFile): string[] {
  const out = new Set<string>();
  for (const f of m.fontFiles) out.add(f.file);
  for (const l of m.logos) {
    out.add(l.file);
    if (l.darkFile) out.add(l.darkFile);
    if (l.lightFile) out.add(l.lightFile);
    for (const f of Object.values(l.versionFiles ?? {})) out.add(f);
  }
  for (const c of m.collections) for (const f of c.files) out.add(f);
  return [...out];
}

/**
 * Read a kit file: a `.brandkit.zip` (any zip with `brandkit.json` at its root
 * or in a single top folder), or a bare `brandkit.json` for a kit without
 * files. Every file the manifest names must be in the archive.
 */
export async function readKitFile(bytes: Uint8Array): Promise<ParsedKitFile> {
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  let manifestBytes: Uint8Array | undefined;
  const files = new Map<string, Uint8Array>();
  if (isZip) {
    let entries: ZipEntry[];
    try {
      entries = await unzipFiles(bytes);
    } catch (e) {
      throw bad(e instanceof Error ? e.message : "unreadable archive");
    }
    // A zip packed from a folder holds everything under that folder's name.
    const top = entries.find((e) => norm(e.name) === MANIFEST) ? "" : (entries.map((e) => norm(e.name)).find((n) => /^[^/]+\/brandkit\.json$/.test(n))?.replace(/brandkit\.json$/, "") ?? "");
    for (const e of entries) {
      const n = norm(e.name);
      if (!n.startsWith(top)) continue;
      const rel = n.slice(top.length);
      if (rel === MANIFEST) manifestBytes = e.data;
      else files.set(rel, e.data);
    }
    if (!manifestBytes) throw new CodedError("errors.brandkit_not_a_kit_file", "This file is not a brand kit file.");
  } else {
    manifestBytes = bytes;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    throw new CodedError("errors.brandkit_not_a_kit_file", "This file is not a brand kit file.");
  }
  const manifest = checkManifest(raw);
  const absent = referencedFiles(manifest).filter((f) => !files.has(f));
  if (absent.length) {
    throw new CodedError("errors.brandkit_file_missing", `The brand kit file lacks ${absent[0]}.`, { file: absent[0], count: absent.length });
  }
  return { manifest, files };
}

// --- importing --------------------------------------------------------------

/** What a kit file holds, for the import dialog. */
export function kitFileSummary(m: KitFile) {
  return {
    colors: m.palettes.reduce((n, p) => n + p.colors.length, 0),
    fonts: m.fonts.length,
    logos: m.logos.length,
    assets: m.collections.reduce((n, c) => n + c.files.length, 0),
  };
}

/** The same counts for a kit already in the workspace. */
export function kitSummary(k: BrandKit) {
  return {
    colors: k.palettes.reduce((n, p) => n + p.colors.length, 0),
    fonts: k.fonts.length,
    logos: k.logos.length,
    assets: k.collections.reduce((n, c) => n + c.assetIds.length, 0),
  };
}

/** A free kit name based on `name`: "Name (2)", "Name (3)", ... */
export function freeKitName(name: string, taken: Iterable<string>): string {
  const set = new Set([...taken].map((t) => t.trim().toLowerCase()));
  if (!set.has(name.trim().toLowerCase())) return name.trim();
  const base = name.trim().replace(/\s*\(\d+\)$/, "");
  for (let i = 2; ; i++) {
    const n = `${base} (${i})`;
    if (!set.has(n.toLowerCase())) return n;
  }
}

/** The kit `name` already in use, matched as the user reads it (trimmed, any
 *  case), or undefined. */
export function kitNamed(kits: BrandKit[], name: string): BrandKit | undefined {
  const n = name.trim().toLowerCase();
  return kits.find((k) => k.name.trim().toLowerCase() === n);
}

const MIME_OF_EXT: Record<string, string> = { svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif" };

export interface ImportTarget {
  /** Upload one file as a workspace asset. */
  uploadAsset(file: Blob, filename: string): Promise<{ id: string; url?: string }>;
  /** Upload one font face; a face whose file is already there counts as done. */
  uploadFont(file: Blob, face: { family: string; weight: number; style: "normal" | "italic"; fileName: string }): Promise<void>;
  /** Asset ids by content hash that may be reused instead of uploading the
   *  same bytes again (the assets of the kit being replaced). */
  reuse?: Map<string, string>;
  /** Content hash of some bytes; without it nothing is reused. */
  hash?(data: Uint8Array): Promise<string | undefined>;
  onProgress?(done: number, total: number): void;
}

/** Upload what the file carries and return the kit content with the new ids
 *  (no name: the caller decides it). Ids from the file are kept, so a kit that
 *  goes out and comes back keeps its palette, font and logo ids. */
export async function uploadKitContent(parsed: ParsedKitFile, to: ImportTarget): Promise<Required<Omit<BrandKitPatch, "name" | "isDefault">>> {
  const m = parsed.manifest;
  const paths = [...m.logos.flatMap((l) => [l.file, l.darkFile, l.lightFile, ...Object.values(l.versionFiles ?? {})]), ...m.collections.flatMap((c) => c.files)].filter((p): p is string => !!p);
  const unique = [...new Set(paths)];
  const total = unique.length + m.fontFiles.length;
  let done = 0;
  const tick = () => to.onProgress?.(++done, total);

  for (const f of m.fontFiles) {
    const data = parsed.files.get(f.file)!;
    await to.uploadFont(new Blob([data as BlobPart], { type: "application/octet-stream" }), { family: f.family, weight: f.weight, style: f.style, fileName: f.file.split("/").pop() ?? f.file });
    tick();
  }

  const ids = new Map<string, string>();
  for (const p of unique) {
    const data = parsed.files.get(p)!;
    const h = to.reuse?.size && to.hash ? await to.hash(data) : undefined;
    const reused = h ? to.reuse!.get(h) : undefined;
    if (reused) {
      ids.set(p, reused);
    } else {
      const base = p.split("/").pop() ?? p;
      const ext = base.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
      // The original name when the file says it, else the path's.
      const name = m.fileNames?.[p] ?? base;
      const asset = await to.uploadAsset(new Blob([data as BlobPart], { type: MIME_OF_EXT[ext] ?? "application/octet-stream" }), name);
      ids.set(p, asset.id);
    }
    tick();
  }

  const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
  const palettes: BrandPalette[] = m.palettes.map((p) => ({
    id: p.id ?? newId("p"),
    name: p.name,
    colors: p.colors.map((c) => ({
      id: c.id ?? newId("s"), role: c.role, ...(c.name ? { name: c.name } : {}),
      value: { ...colorOfHex(c.hex)!, ...(c.cmyk ? { cmyk: c.cmyk } : {}), ...(c.spot ? { spot: c.spot } : {}) },
    })),
  }));
  const fonts: BrandFont[] = m.fonts.map((f) => {
    const ds = f.defaultStyle && Object.fromEntries(Object.entries(f.defaultStyle).filter(([, v]) => v !== undefined));
    return { id: f.id ?? newId("f"), role: f.role, fontFamily: f.family, ...(ds && Object.keys(ds).length ? { defaultStyle: ds } : {}) };
  });
  const logos: BrandLogo[] = m.logos.map((l) => {
    const variants: BrandLogo["variants"] = {};
    if (l.darkFile) variants.dark = ids.get(l.darkFile);
    if (l.lightFile) variants.light = ids.get(l.lightFile);
    return {
      id: l.id ?? newId("l"),
      label: l.label,
      assetId: ids.get(l.file)!,
      ...(Object.keys(variants).length ? { variants } : {}),
      ...(l.clearSpaceRatio !== undefined ? { clearSpaceRatio: l.clearSpaceRatio } : {}),
      ...(l.minSizePx !== undefined ? { minSizePx: l.minSizePx } : {}),
      ...(l.versionFiles ? { versions: Object.fromEntries(Object.entries(l.versionFiles).map(([vid, f]) => [vid, ids.get(f)!])) } : {}),
    };
  });
  const collections: BrandCollection[] = m.collections.map((c) => ({ id: c.id ?? newId("c"), kind: c.kind, ...(c.name ? { name: c.name } : {}), assetIds: c.files.map((f) => ids.get(f)!) }));
  const voice: BrandVoice | null = m.voice ? { tone: m.voice.tone, doSay: m.voice.doSay, dontSay: m.voice.dontSay, ...(m.voice.sampleCopy ? { sampleCopy: m.voice.sampleCopy } : {}) } : null;
  const logoVersions = (m.logoVersions ?? []).map((v) => ({ id: v.id, name: v.name, ground: v.ground }));
  return { palettes, fonts, logos, collections, voice, controls: m.controls ?? {}, logoVersions };
}

/** Hex SHA-256 of some bytes, or undefined where the browser offers none
 *  (plain http). */
export async function sha256(data: Uint8Array): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) return undefined;
  const d = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
