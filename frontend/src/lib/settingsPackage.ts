// Settings as one file, to keep or to take to another danvas instance. A
// workspace's: export profiles, print presets, colour profiles (ICC), colour
// libraries, roles and permissions, its rules, folder defaults and, when chosen,
// its members' e-mail addresses. A person's own: their profiles, colour profiles,
// interface preferences and shortcuts. A zip with a manifest, made and read in the browser like
// the design package (lib/designPackage); each part of an export comes from the
// server under a right of its own, and an import goes through the ordinary
// routes, under their rights. Keys and passwords are never part of it.
//
// A profile refers to a colour profile by id, which means nothing on another
// instance, so the file names it by the checksum of its bytes; an import looks
// for those bytes among the file's and the workspace's profiles.

import type { ColorLibraryEntry, ExportProfile, ExportProfileKind } from "@hc/sdk";
import { CodedError } from "./errors";
import { freeName } from "./exportProfiles";
import { BUILTIN_PROFILE_ID } from "./print/profiles";
import { sha256Hex } from "./print/handover";
import { unzipFiles, zipFiles, type ZipEntry } from "./zip";

export const SETTINGS_FORMAT = "danvas.settings-package";
export const SETTINGS_VERSION = 1;
const MANIFEST = "danvas-settings.json";

export type SettingsPart = "exportProfiles" | "printPresets" | "colorProfiles" | "colorLibraries" | "roles" | "workspaceRules" | "folderDefaults" | "memberEmails" | "uiPrefs" | "shortcuts";
/** What a workspace's file can hold, in the order the dialogs list it. */
export const SETTINGS_PARTS: SettingsPart[] = ["exportProfiles", "printPresets", "colorProfiles", "colorLibraries", "roles", "workspaceRules", "folderDefaults", "memberEmails"];
/** What a person's own file can hold (no rights: it is theirs). */
export const PERSONAL_PARTS: SettingsPart[] = ["exportProfiles", "printPresets", "colorProfiles", "uiPrefs", "shortcuts"];
/** Parts not ticked until someone asks for them: addresses of people, and on
 *  import an invitation mail to each. */
export const OPT_IN_PARTS: SettingsPart[] = ["memberEmails"];

/** The right each part of an export is under. */
export const PART_ACTION = {
  exportProfiles: "export.exportProfiles",
  printPresets: "export.printPresets",
  colorProfiles: "export.colorProfiles",
  colorLibraries: "export.colorLibraries",
  roles: "export.roles",
  workspaceRules: "export.workspaceRules",
  folderDefaults: "export.folderDefaults",
  memberEmails: "export.memberEmails",
} as const;

export interface ServerProfile { id: string; name: string; description: string; settings: Record<string, unknown> & { v: number }; isDefault: boolean }
export interface ServerColorProfile { name: string; description: string; isDefault: boolean; data: string }
export interface ServerLibrary { name: string; sourceFile: string; entries: ColorLibraryEntry[] }

export interface PackagedPermission { key: string; seedKey?: string; name: string; description: string; actions: Record<string, string> }
export interface PackagedRole { key: string; seedKey?: string; name: string; description: string; permissions: string[] }
export interface PackagedRules { requireApproval?: boolean; exportManagedBy?: string; printManagedBy?: string }
export interface PackagedFolderDefault { path: string[]; kind: ExportProfileKind; profile: string }
export interface PackagedMember { email: string; name: string; roleKey: string }

/** How a role or permission is recognised on another instance: a seeded one by
 *  its seed key, whatever it is called there; any other by its name. */
export const roleKey = (r: { seedKey?: string; name: string }) => (r.seedKey ? `seed:${r.seedKey}` : `name:${r.name.trim().toLowerCase()}`);

export interface PackagedProfile {
  name: string;
  description: string;
  settings: Record<string, unknown> & { v: number };
  /** The colour profile it uses, by the checksum of its bytes. */
  iccChecksum?: string;
}

interface Manifest {
  format: string;
  formatVersion: number;
  exportedAt: string;
  exportProfiles?: PackagedProfile[];
  printPresets?: PackagedProfile[];
  colorProfiles?: { file: string; name: string; description: string; checksum: string }[];
  colorLibraries?: { file: string; name: string; sourceFile: string }[];
  roles?: { permissions: PackagedPermission[]; roles: PackagedRole[] };
  workspaceRules?: PackagedRules;
  folderDefaults?: PackagedFolderDefault[];
  members?: PackagedMember[];
  uiPrefs?: Record<string, unknown>;
  shortcuts?: Record<string, string>;
}

export interface SettingsPackage {
  exportedAt: string;
  exportProfiles: PackagedProfile[];
  printPresets: PackagedProfile[];
  colorProfiles: { name: string; checksum: string; bytes: Uint8Array }[];
  colorLibraries: { name: string; sourceFile: string; entries: ColorLibraryEntry[] }[];
  permissions: PackagedPermission[];
  roles: PackagedRole[];
  workspaceRules: PackagedRules | null;
  folderDefaults: PackagedFolderDefault[];
  members: PackagedMember[];
  uiPrefs: Record<string, unknown> | null;
  shortcuts: Record<string, string> | null;
}

/** How many things of a part a file holds. */
export function partCount(pkg: SettingsPackage, part: SettingsPart): number {
  switch (part) {
    case "exportProfiles": return pkg.exportProfiles.length;
    case "printPresets": return pkg.printPresets.length;
    case "colorProfiles": return pkg.colorProfiles.length;
    case "colorLibraries": return pkg.colorLibraries.length;
    case "roles": return pkg.roles.length + pkg.permissions.length;
    case "workspaceRules": return pkg.workspaceRules ? 1 : 0;
    case "folderDefaults": return pkg.folderDefaults.length;
    case "memberEmails": return pkg.members.length;
    case "uiPrefs": return pkg.uiPrefs ? Object.keys(pkg.uiPrefs).length : 0;
    case "shortcuts": return pkg.shortcuts ? Object.keys(pkg.shortcuts).length : 0;
  }
}

export interface ExportSources {
  /** One part from the server (a workspace's: refused without its right). */
  part(part: SettingsPart): Promise<{
    profiles?: ServerProfile[] | ServerColorProfile[];
    libraries?: ServerLibrary[];
    permissions?: { id: string; seedKey?: string; name: string; description: string; actions: Record<string, string> }[];
    roles?: { id: string; seedKey?: string; name: string; description: string; protected?: boolean; permissionIds: string[] }[];
    rules?: PackagedRules;
    folders?: { id: string; parentId: string | null; name: string }[];
    defaults?: { folderId: string; kind: ExportProfileKind; profile: string }[];
    members?: PackagedMember[];
    prefs?: Record<string, unknown>;
    shortcuts?: Record<string, string>;
  }>;
  /** The workspace's own colour profile ids with their bytes, to name them. */
  iccBytes(): Promise<{ id: string; bytes: Uint8Array }[]>;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const slug = (s: string) => s.normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "item";
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** The chosen parts as one file. A part that is refused or fails is reported,
 *  the others still go in. */
export async function exportSettingsPackage(parts: readonly SettingsPart[], src: ExportSources, now = new Date()): Promise<{ blob: Blob; failed: SettingsPart[] }> {
  const manifest: Manifest = { format: SETTINGS_FORMAT, formatVersion: SETTINGS_VERSION, exportedAt: now.toISOString() };
  const entries: ZipEntry[] = [];
  const failed: SettingsPart[] = [];
  // Only profiles refer to colour profiles by id.
  const checksumOf = new Map<string, string>();
  if (parts.includes("exportProfiles") || parts.includes("printPresets")) {
    try {
      for (const p of await src.iccBytes()) checksumOf.set(p.id, await sha256Hex(p.bytes));
    } catch { /* the profiles then name none, and take the default */ }
  }
  const packaged = (list: ServerProfile[]): PackagedProfile[] => list.map((p) => {
    const id = p.settings.iccProfileId;
    const settings = { ...p.settings };
    let iccChecksum: string | undefined;
    if (typeof id === "string" && id !== BUILTIN_PROFILE_ID && !id.startsWith("builtin:")) {
      iccChecksum = checksumOf.get(id);
      settings.iccProfileId = null;
    }
    return { name: p.name, description: p.description, settings, ...(iccChecksum ? { iccChecksum } : {}) };
  });
  for (const part of parts) {
    try {
      const got = await src.part(part);
      if (part === "exportProfiles") manifest.exportProfiles = packaged((got.profiles ?? []) as ServerProfile[]);
      if (part === "printPresets") manifest.printPresets = packaged((got.profiles ?? []) as ServerProfile[]);
      if (part === "colorProfiles") {
        manifest.colorProfiles = [];
        for (const [i, p] of ((got.profiles ?? []) as ServerColorProfile[]).entries()) {
          const bytes = fromBase64(p.data);
          const file = `color-profiles/${String(i + 1).padStart(3, "0")}-${slug(p.name)}.icc`;
          entries.push({ name: file, data: bytes });
          manifest.colorProfiles.push({ file, name: p.name, description: p.description, checksum: await sha256Hex(bytes) });
        }
      }
      if (part === "colorLibraries") {
        manifest.colorLibraries = [];
        for (const [i, l] of (got.libraries ?? []).entries()) {
          const file = `color-libraries/${String(i + 1).padStart(3, "0")}-${slug(l.name)}.json`;
          entries.push({ name: file, data: enc.encode(JSON.stringify(l.entries)) });
          manifest.colorLibraries.push({ file, name: l.name, sourceFile: l.sourceFile });
        }
      }
      if (part === "roles") {
        const keyOfPermission = new Map((got.permissions ?? []).map((p) => [p.id, roleKey(p)]));
        manifest.roles = {
          permissions: (got.permissions ?? []).map((p) => ({ key: roleKey(p), ...(p.seedKey ? { seedKey: p.seedKey } : {}), name: p.name, description: p.description, actions: p.actions })),
          // The owner role cannot be changed anywhere: it travels as nothing.
          roles: (got.roles ?? []).filter((r) => !r.protected).map((r) => ({
            key: roleKey(r), ...(r.seedKey ? { seedKey: r.seedKey } : {}), name: r.name, description: r.description,
            permissions: r.permissionIds.flatMap((id) => { const k = keyOfPermission.get(id); return k ? [k] : []; }),
          })),
        };
      }
      if (part === "workspaceRules") manifest.workspaceRules = got.rules ?? {};
      if (part === "folderDefaults") {
        const byId = new Map((got.folders ?? []).map((f) => [f.id, f]));
        const pathOf = (id: string): string[] => {
          const out: string[] = [];
          const seen = new Set<string>();
          for (let f = byId.get(id); f && !seen.has(f.id); f = f.parentId ? byId.get(f.parentId) : undefined) {
            seen.add(f.id);
            out.unshift(f.name);
          }
          return out;
        };
        manifest.folderDefaults = (got.defaults ?? []).map((d) => ({ path: pathOf(d.folderId), kind: d.kind, profile: d.profile })).filter((d) => d.path.length > 0);
      }
      if (part === "memberEmails") manifest.members = got.members ?? [];
      if (part === "uiPrefs") manifest.uiPrefs = got.prefs ?? {};
      if (part === "shortcuts") manifest.shortcuts = got.shortcuts ?? {};
    } catch {
      failed.push(part);
    }
  }
  entries.unshift({ name: MANIFEST, data: enc.encode(JSON.stringify(manifest, null, 2)) });
  return { blob: zipFiles(entries), failed };
}

const invalid = () => new CodedError("errors.settings_package_invalid", "not a settings file");

/** Read a settings file; refuses anything else, and a newer format. */
export async function readSettingsPackage(bytes: Uint8Array): Promise<SettingsPackage> {
  let entries: ZipEntry[];
  try {
    entries = await unzipFiles(bytes);
  } catch {
    throw invalid();
  }
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  const raw = byName.get(MANIFEST);
  if (!raw) throw invalid();
  let m: Manifest;
  try {
    m = JSON.parse(dec.decode(raw)) as Manifest;
  } catch {
    throw invalid();
  }
  if (m?.format !== SETTINGS_FORMAT) throw invalid();
  if (!(m.formatVersion <= SETTINGS_VERSION)) throw new CodedError("errors.settings_package_newer", "made by a newer version");
  const valid = (p: PackagedProfile) => typeof p?.name === "string" && !!p.name.trim() && !!p.settings && typeof p.settings === "object";
  return {
    exportedAt: m.exportedAt ?? "",
    exportProfiles: (m.exportProfiles ?? []).filter(valid),
    printPresets: (m.printPresets ?? []).filter(valid),
    colorProfiles: (m.colorProfiles ?? []).flatMap((p) => {
      const data = byName.get(p.file);
      return data ? [{ name: p.name, checksum: p.checksum, bytes: data }] : [];
    }),
    colorLibraries: (m.colorLibraries ?? []).flatMap((l) => {
      const data = byName.get(l.file);
      if (!data) return [];
      try {
        return [{ name: l.name, sourceFile: l.sourceFile ?? "", entries: JSON.parse(dec.decode(data)) as ColorLibraryEntry[] }];
      } catch {
        return [];
      }
    }),
    permissions: (m.roles?.permissions ?? []).filter((p) => typeof p?.name === "string" && !!p.actions),
    roles: (m.roles?.roles ?? []).filter((r) => typeof r?.name === "string" && Array.isArray(r.permissions)),
    workspaceRules: m.workspaceRules ?? null,
    folderDefaults: (m.folderDefaults ?? []).filter((d) => Array.isArray(d?.path) && d.path.length > 0 && typeof d.profile === "string"),
    members: (m.members ?? []).filter((x) => typeof x?.email === "string" && x.email.includes("@")),
    uiPrefs: m.uiPrefs ?? null,
    shortcuts: m.shortcuts ?? null,
  };
}

/** What happens to something of the same name already there. */
export type SettingsConflict = "skip" | "keep" | "replace";

export interface ImportTarget {
  /** The workspace's colour profiles with their bytes. */
  iccBytes(): Promise<{ id: string; bytes: Uint8Array }[]>;
  uploadIcc(bytes: Uint8Array, name: string): Promise<{ id: string }>;
  profiles(kind: ExportProfileKind): Promise<Pick<ExportProfile, "id" | "name">[]>;
  createProfile(kind: ExportProfileKind, p: { name: string; description: string; settings: PackagedProfile["settings"] }): Promise<unknown>;
  updateProfile(id: string, p: { description: string; settings: PackagedProfile["settings"] }): Promise<unknown>;
  libraries(): Promise<{ id: string; name: string }[]>;
  createLibrary(l: { name: string; sourceFile: string; entries: ColorLibraryEntry[] }): Promise<unknown>;
  deleteLibrary(id: string): Promise<unknown>;
  // A workspace's only:
  rolesView?(): Promise<{ permissions: { id: string; seedKey?: string; name: string }[]; roles: { id: string; seedKey?: string; name: string; protected?: boolean }[] }>;
  createPermission?(p: { name: string; description: string; actions: Record<string, string> }): Promise<{ id: string }>;
  updatePermission?(id: string, p: { description: string; actions: Record<string, string> }): Promise<unknown>;
  createRole?(r: { name: string; description: string; permissionIds: string[] }): Promise<{ id: string }>;
  updateRole?(id: string, r: { description: string; permissionIds: string[] }): Promise<unknown>;
  setRules?(rules: PackagedRules): Promise<unknown>;
  folders?(): Promise<{ id: string; parentId: string | null; name: string }[]>;
  setFolderDefault?(folderId: string, kind: ExportProfileKind, profileId: string): Promise<unknown>;
  memberEmails?(): Promise<string[]>;
  invite?(email: string, roleId?: string): Promise<unknown>;
  // A person's only:
  setUiPref?(key: string, value: unknown): Promise<unknown>;
  setShortcuts?(overrides: Record<string, string>): void;
}

export interface SettingsImportResult {
  added: number;
  replaced: number;
  skipped: number;
  /** Items that failed (a missing right, a refused profile), by name. */
  failed: { part: SettingsPart; name: string; reason: unknown }[];
  /** Profiles whose colour profile is neither in the file nor here: they use
   *  the workspace's default until one is chosen. */
  withoutIcc: string[];
  /** Folder defaults whose folder or profile is not here ("a / b: Profile"). */
  unmatched: string[];
}

/** Import the chosen parts. Colour profiles come first, so the profiles can
 *  find theirs. Each item fails on its own; nothing is made a default. */
export async function importSettingsPackage(pkg: SettingsPackage, parts: readonly SettingsPart[], conflict: SettingsConflict, target: ImportTarget): Promise<SettingsImportResult> {
  const out: SettingsImportResult = { added: 0, replaced: 0, skipped: 0, failed: [], withoutIcc: [], unmatched: [] };
  const idOf = new Map<string, string>();
  const wantsIcc = parts.includes("colorProfiles") || parts.includes("exportProfiles") || parts.includes("printPresets");
  if (wantsIcc) {
    try {
      for (const p of await target.iccBytes()) idOf.set(await sha256Hex(p.bytes), p.id);
    } catch { /* the uploads below still say what they can */ }
  }
  if (parts.includes("colorProfiles")) {
    for (const p of pkg.colorProfiles) {
      // The same bytes are the same profile, whatever it is called.
      if (idOf.has(p.checksum)) { out.skipped++; continue; }
      try {
        const made = await target.uploadIcc(p.bytes, p.name);
        idOf.set(p.checksum, made.id);
        out.added++;
      } catch (reason) {
        out.failed.push({ part: "colorProfiles", name: p.name, reason });
      }
    }
  }
  // Roles before anything that names one (the members below).
  const roleIdOf = new Map<string, string>();
  if ((parts.includes("roles") || parts.includes("memberEmails")) && target.rolesView) {
    let view: Awaited<ReturnType<NonNullable<ImportTarget["rolesView"]>>> | null = null;
    try {
      view = await target.rolesView();
    } catch { /* creating says what is wrong */ }
    for (const r of view?.roles ?? []) roleIdOf.set(roleKey(r), r.id);
    if (parts.includes("roles") && view) {
      const permissionIdOf = new Map(view.permissions.map((p) => [roleKey(p), p.id]));
      const namesOfPermissions = view.permissions.map((p) => p.name);
      for (const p of pkg.permissions) {
        const same = view.permissions.find((e) => roleKey(e) === p.key);
        try {
          if (same && conflict === "skip") { out.skipped++; continue; }
          if (same && conflict === "replace") {
            await target.updatePermission!(same.id, { description: p.description, actions: p.actions });
            out.replaced++;
            continue;
          }
          const name = freeName(p.name || p.seedKey || "permission", namesOfPermissions);
          const made = await target.createPermission!({ name, description: p.description, actions: p.actions });
          namesOfPermissions.push(name);
          // Keep both: the file's role then uses its own copy.
          permissionIdOf.set(p.key, made.id);
          out.added++;
        } catch (reason) {
          out.failed.push({ part: "roles", name: p.name || p.seedKey || "", reason });
        }
      }
      const namesOfRoles = view.roles.map((r) => r.name);
      for (const r of pkg.roles) {
        const same = view.roles.find((e) => roleKey(e) === r.key);
        // The owner role cannot be changed.
        if (same?.protected) { out.skipped++; continue; }
        const permissionIds = r.permissions.flatMap((k) => { const id = permissionIdOf.get(k); return id ? [id] : []; });
        try {
          if (same && conflict === "skip") { out.skipped++; continue; }
          if (same && conflict === "replace") {
            await target.updateRole!(same.id, { description: r.description, permissionIds });
            out.replaced++;
            continue;
          }
          const name = freeName(r.name || r.seedKey || "role", namesOfRoles);
          const made = await target.createRole!({ name, description: r.description, permissionIds });
          namesOfRoles.push(name);
          roleIdOf.set(r.key, made.id);
          out.added++;
        } catch (reason) {
          out.failed.push({ part: "roles", name: r.name || r.seedKey || "", reason });
        }
      }
    }
  }
  if (parts.includes("workspaceRules") && pkg.workspaceRules && target.setRules) {
    try {
      await target.setRules(pkg.workspaceRules);
      out.replaced++;
    } catch (reason) {
      out.failed.push({ part: "workspaceRules", name: "", reason });
    }
  }
  const importProfiles = async (part: SettingsPart, kind: ExportProfileKind, list: PackagedProfile[]) => {
    let existing: Pick<ExportProfile, "id" | "name">[] = [];
    try {
      existing = await target.profiles(kind);
    } catch { /* creating says what is wrong */ }
    const taken = existing.map((e) => e.name);
    for (const p of list) {
      const settings = { ...p.settings };
      if (p.iccChecksum) {
        const id = idOf.get(p.iccChecksum);
        settings.iccProfileId = id ?? null;
        if (!id) out.withoutIcc.push(p.name);
      }
      const same = existing.find((e) => e.name.trim().toLowerCase() === p.name.trim().toLowerCase());
      try {
        if (same && conflict === "skip") { out.skipped++; continue; }
        if (same && conflict === "replace") {
          await target.updateProfile(same.id, { description: p.description, settings });
          out.replaced++;
          continue;
        }
        const name = freeName(p.name, taken);
        await target.createProfile(kind, { name, description: p.description, settings });
        taken.push(name);
        out.added++;
      } catch (reason) {
        out.failed.push({ part, name: p.name, reason });
      }
    }
  };
  if (parts.includes("exportProfiles")) await importProfiles("exportProfiles", "export", pkg.exportProfiles);
  if (parts.includes("printPresets")) await importProfiles("printPresets", "print", pkg.printPresets);
  if (parts.includes("colorLibraries")) {
    let existing: { id: string; name: string }[] = [];
    try {
      existing = await target.libraries();
    } catch { /* creating says what is wrong */ }
    const taken = existing.map((e) => e.name);
    for (const l of pkg.colorLibraries) {
      const same = existing.find((e) => e.name.trim().toLowerCase() === l.name.trim().toLowerCase());
      try {
        if (same && conflict === "skip") { out.skipped++; continue; }
        if (same && conflict === "replace") {
          // The new one first: a refused library leaves the old one in place.
          await target.createLibrary(l);
          await target.deleteLibrary(same.id);
          out.replaced++;
          continue;
        }
        const name = freeName(l.name, taken);
        await target.createLibrary({ ...l, name });
        taken.push(name);
        out.added++;
      } catch (reason) {
        out.failed.push({ part: "colorLibraries", name: l.name, reason });
      }
    }
  }
  // After the profiles, which they point at.
  if (parts.includes("folderDefaults") && target.folders && target.setFolderDefault) {
    let folders: { id: string; parentId: string | null; name: string }[] = [];
    try {
      folders = await target.folders();
    } catch { /* each is then reported as not found */ }
    const profiles: Partial<Record<ExportProfileKind, Pick<ExportProfile, "id" | "name">[]>> = {};
    for (const d of pkg.folderDefaults) {
      const label = `${d.path.join(" / ")}: ${d.profile}`;
      let parent: string | null = null;
      let found = true;
      for (const part of d.path) {
        const next = folders.find((f) => f.parentId === parent && f.name.trim().toLowerCase() === part.trim().toLowerCase());
        if (!next) { found = false; break; }
        parent = next.id;
      }
      try {
        profiles[d.kind] ??= await target.profiles(d.kind);
        const profile = profiles[d.kind]!.find((p) => p.name.trim().toLowerCase() === d.profile.trim().toLowerCase());
        if (!found || !parent || !profile) { out.unmatched.push(label); continue; }
        await target.setFolderDefault(parent, d.kind, profile.id);
        out.added++;
      } catch (reason) {
        out.failed.push({ part: "folderDefaults", name: label, reason });
      }
    }
  }
  // An invitation mail goes to each one who is not here yet.
  if (parts.includes("memberEmails") && target.invite) {
    let here = new Set<string>();
    try {
      here = new Set((await target.memberEmails?.() ?? []).map((e) => e.trim().toLowerCase()));
    } catch { /* inviting someone already here is refused for them alone */ }
    for (const m of pkg.members) {
      if (here.has(m.email.trim().toLowerCase())) { out.skipped++; continue; }
      try {
        await target.invite(m.email, roleIdOf.get(m.roleKey));
        out.added++;
      } catch (reason) {
        out.failed.push({ part: "memberEmails", name: m.email, reason });
      }
    }
  }
  if (parts.includes("uiPrefs") && pkg.uiPrefs && target.setUiPref) {
    for (const [k, v] of Object.entries(pkg.uiPrefs)) {
      try {
        await target.setUiPref(k, v);
        out.replaced++;
      } catch (reason) {
        out.failed.push({ part: "uiPrefs", name: k, reason });
      }
    }
  }
  if (parts.includes("shortcuts") && pkg.shortcuts && target.setShortcuts) {
    target.setShortcuts(pkg.shortcuts);
    out.replaced += Object.keys(pkg.shortcuts).length;
  }
  return out;
}
