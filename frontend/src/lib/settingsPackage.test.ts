// The settings file: what goes in, how profiles find their colour profile on
// another instance, and what happens to names already there.
import { describe, expect, it } from "vitest";
import { exportSettingsPackage, importSettingsPackage, partCount, readSettingsPackage, type ImportTarget, type SettingsPart } from "./settingsPackage";
import { sha256Hex } from "./print/handover";
import { zipFiles } from "./zip";

const icc = new Uint8Array([1, 2, 3, 4, 5]);
const other = new Uint8Array([9, 9, 9]);
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const profile = (name: string, iccProfileId: string | null) => ({ id: `id-${name}`, name, description: `about ${name}`, isDefault: true, settings: { v: 1, format: "pdf", iccProfileId } });
const entry = { name: "Blue", lab: [40, 10, -40] as [number, number, number] };

const source = (refuse: SettingsPart[] = []) => ({
  iccBytes: async () => [{ id: "icc-1", bytes: icc }],
  part: async (part: SettingsPart) => {
    if (refuse.includes(part)) throw new Error("forbidden");
    if (part === "exportProfiles") return { profiles: [profile("Shop", "icc-1"), profile("Builtin", "builtin:pso-uncoated-fogra47"), profile("Personal", "someone-elses")] };
    if (part === "printPresets") return { profiles: [profile("Office", null)] };
    if (part === "colorProfiles") return { profiles: [{ name: "PSO", description: "d", isDefault: true, data: b64(icc) }] };
    return { libraries: [{ name: "HKS", sourceFile: "hks.ase", entries: [entry] }] };
  },
});

const ALL: SettingsPart[] = ["exportProfiles", "printPresets", "colorProfiles", "colorLibraries"];
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

function target(start: { icc?: { id: string; bytes: Uint8Array }[]; profiles?: { id: string; name: string }[]; libraries?: { id: string; name: string }[] } = {}) {
  const log: unknown[][] = [];
  const t: ImportTarget = {
    iccBytes: async () => start.icc ?? [],
    uploadIcc: async (bytes, name) => { log.push(["uploadIcc", name, bytes.length]); return { id: "new-icc" }; },
    profiles: async () => (start.profiles ?? []) as never,
    createProfile: async (kind, p) => { log.push(["createProfile", kind, p.name, p.settings.iccProfileId]); },
    updateProfile: async (id, p) => { log.push(["updateProfile", id, p.settings.iccProfileId]); },
    libraries: async () => start.libraries ?? [],
    createLibrary: async (l) => { log.push(["createLibrary", l.name, l.entries.length]); },
    deleteLibrary: async (id) => { log.push(["deleteLibrary", id]); },
  };
  return { t, log };
}

describe("exporting settings", () => {
  it("writes the chosen parts and reads them back", async () => {
    const { blob, failed } = await exportSettingsPackage(ALL, source());
    expect(failed).toEqual([]);
    const pkg = await readSettingsPackage(await bytesOf(blob));
    expect(pkg.exportProfiles.map((p) => p.name)).toEqual(["Shop", "Builtin", "Personal"]);
    expect(pkg.printPresets.map((p) => p.name)).toEqual(["Office"]);
    expect(pkg.colorProfiles[0].bytes).toEqual(icc);
    expect(pkg.colorProfiles[0].checksum).toBe(await sha256Hex(icc));
    expect(pkg.colorLibraries[0].entries).toEqual([entry]);
  });

  it("names a colour profile by its bytes, never by an id of this instance", async () => {
    const { blob } = await exportSettingsPackage(["exportProfiles"], source());
    const [shop, builtin, personal] = (await readSettingsPackage(await bytesOf(blob))).exportProfiles;
    expect(shop.iccChecksum).toBe(await sha256Hex(icc));
    expect(shop.settings.iccProfileId).toBeNull();
    // A built-in profile is the same everywhere.
    expect(builtin.settings.iccProfileId).toBe("builtin:pso-uncoated-fogra47");
    expect(builtin.iccChecksum).toBeUndefined();
    // Not one of the workspace's: no id leaves.
    expect(personal.settings.iccProfileId).toBeNull();
    expect(personal.iccChecksum).toBeUndefined();
  });

  it("leaves out what was not chosen or is refused, and says so", async () => {
    const { blob, failed } = await exportSettingsPackage(["exportProfiles", "colorLibraries"], source(["colorLibraries"]));
    expect(failed).toEqual(["colorLibraries"]);
    const pkg = await readSettingsPackage(await bytesOf(blob));
    expect(pkg.exportProfiles).toHaveLength(3);
    expect(pkg.printPresets).toEqual([]);
    expect(pkg.colorProfiles).toEqual([]);
    expect(pkg.colorLibraries).toEqual([]);
  });
});

describe("reading a settings file", () => {
  const code = (p: Promise<unknown>) => p.then(() => "read", (e: { code?: string }) => e.code);
  const file = async (json: unknown) => bytesOf(zipFiles([{ name: "danvas-settings.json", data: new TextEncoder().encode(JSON.stringify(json)) }]));

  it("refuses anything else, and a newer format", async () => {
    expect(await code(readSettingsPackage(new Uint8Array([1, 2, 3])))).toBe("errors.settings_package_invalid");
    expect(await code(readSettingsPackage(await bytesOf(zipFiles([{ name: "x.txt", data: new Uint8Array(1) }]))))).toBe("errors.settings_package_invalid");
    expect(await code(readSettingsPackage(await file({ format: "danvas.design-package", formatVersion: 1 })))).toBe("errors.settings_package_invalid");
    expect(await code(readSettingsPackage(await file({ format: "danvas.settings-package", formatVersion: 2 })))).toBe("errors.settings_package_newer");
  });

  it("drops entries without a name or settings, and files that are missing", async () => {
    const pkg = await readSettingsPackage(await file({
      format: "danvas.settings-package", formatVersion: 1,
      exportProfiles: [{ name: " ", settings: { v: 1 } }, { name: "x" }, { name: "Good", description: "", settings: { v: 1 } }],
      colorProfiles: [{ file: "gone.icc", name: "Gone", checksum: "c" }],
    }));
    expect(pkg.exportProfiles.map((p) => p.name)).toEqual(["Good"]);
    expect(pkg.colorProfiles).toEqual([]);
  });
});

describe("importing settings", () => {
  const pkgOf = async () => readSettingsPackage(await bytesOf((await exportSettingsPackage(ALL, source())).blob));

  it("uploads colour profiles first, so profiles find theirs under the new id", async () => {
    const { t, log } = target();
    const res = await importSettingsPackage(await pkgOf(), ALL, "skip", t);
    expect(log[0]).toEqual(["uploadIcc", "PSO", 5]);
    expect(log).toContainEqual(["createProfile", "export", "Shop", "new-icc"]);
    expect(log).toContainEqual(["createProfile", "export", "Builtin", "builtin:pso-uncoated-fogra47"]);
    expect(log).toContainEqual(["createProfile", "print", "Office", null]);
    expect(log).toContainEqual(["createLibrary", "HKS", 1]);
    expect(res).toMatchObject({ added: 6, replaced: 0, skipped: 0, failed: [], withoutIcc: [], unmatched: [] });
  });

  it("does not upload bytes the workspace already has, and uses that profile", async () => {
    const { t, log } = target({ icc: [{ id: "here", bytes: icc }] });
    const res = await importSettingsPackage(await pkgOf(), ["colorProfiles", "exportProfiles"], "skip", t);
    expect(log.some((l) => l[0] === "uploadIcc")).toBe(false);
    expect(log).toContainEqual(["createProfile", "export", "Shop", "here"]);
    expect(res.skipped).toBe(1);
  });

  it("says which profiles have no colour profile here, and leaves them on the default", async () => {
    const { t, log } = target({ icc: [{ id: "else", bytes: other }] });
    const res = await importSettingsPackage(await pkgOf(), ["exportProfiles"], "skip", t);
    expect(res.withoutIcc).toEqual(["Shop"]);
    expect(log).toContainEqual(["createProfile", "export", "Shop", null]);
  });

  it("treats names already there as chosen, ignoring case", async () => {
    const start = { profiles: [{ id: "p1", name: "shop" }], libraries: [{ id: "l1", name: "hks" }] };
    const parts: SettingsPart[] = ["exportProfiles", "colorLibraries"];

    const skip = target(start);
    const skipped = await importSettingsPackage(await pkgOf(), parts, "skip", skip.t);
    expect(skipped.skipped).toBe(2);
    expect(skip.log.some((l) => l[2] === "Shop" || l[1] === "HKS")).toBe(false);

    const keep = target(start);
    await importSettingsPackage(await pkgOf(), parts, "keep", keep.t);
    expect(keep.log).toContainEqual(["createProfile", "export", "Shop (2)", null]);
    expect(keep.log).toContainEqual(["createLibrary", "HKS (2)", 1]);

    const replace = target(start);
    const replaced = await importSettingsPackage(await pkgOf(), parts, "replace", replace.t);
    expect(replaced.replaced).toBe(2);
    expect(replace.log).toContainEqual(["updateProfile", "p1", null]);
    // The new library first: if it is refused, the old one is still there.
    const order = replace.log.map((l) => l[0]).filter((k) => k === "createLibrary" || k === "deleteLibrary");
    expect(order).toEqual(["createLibrary", "deleteLibrary"]);
  });

  it("lets each item fail alone, and keeps the old library when the new one is refused", async () => {
    const { t, log } = target({ libraries: [{ id: "l1", name: "HKS" }] });
    t.createProfile = async (_k, p) => {
      if (p.name === "Shop") throw new Error("no right");
      log.push(["createProfile", p.name]);
    };
    t.createLibrary = async () => { throw new Error("no right"); };
    const res = await importSettingsPackage(await pkgOf(), ["exportProfiles", "colorLibraries"], "replace", t);
    expect(res.failed.map((f) => f.name)).toEqual(["Shop", "HKS"]);
    expect(log).toContainEqual(["createProfile", "Builtin"]);
    expect(log.some((l) => l[0] === "deleteLibrary")).toBe(false);
  });
});

describe("roles, rules, folder defaults, members and personal settings", () => {
  const src = {
    iccBytes: async () => [],
    part: async (part: SettingsPart) => {
      if (part === "roles") return {
        permissions: [
          { id: "p1", seedKey: "share", name: "", description: "d", actions: { "share.team": "all" } },
          { id: "p2", name: "Print shop", description: "", actions: { "print.exportProfiles": "all" } },
        ],
        roles: [
          { id: "r0", seedKey: "owner", name: "", description: "", protected: true, permissionIds: ["p1"] },
          { id: "r1", seedKey: "member", name: "", description: "m", permissionIds: ["p1"] },
          { id: "r2", name: "Prepress", description: "", permissionIds: ["p1", "p2", "gone"] },
        ],
      };
      if (part === "workspaceRules") return { rules: { requireApproval: true, exportManagedBy: "admins", printManagedBy: "members" } };
      if (part === "folderDefaults") return {
        folders: [{ id: "f1", parentId: null, name: "Labels" }, { id: "f2", parentId: "f1", name: "Big" }],
        defaults: [{ folderId: "f2", kind: "export" as const, profile: "Shop" }, { folderId: "gone", kind: "print" as const, profile: "Office" }],
      };
      if (part === "memberEmails") return { members: [{ email: "a@x.example", name: "A", roleKey: "name:prepress" }, { email: "B@x.example", name: "B", roleKey: "seed:member" }] };
      if (part === "uiPrefs") return { prefs: { theme: "dark" } };
      if (part === "shortcuts") return { shortcuts: { "commandMenu.open": "mod+p" } };
      return {};
    },
  };
  const all: SettingsPart[] = ["roles", "workspaceRules", "folderDefaults", "memberEmails", "uiPrefs", "shortcuts"];
  const pkgOf = async () => readSettingsPackage(await bytesOf((await exportSettingsPackage(all, src)).blob));
  const wide = (log: unknown[][]) => {
    let n = 0;
    return {
      rolesView: async () => ({
        permissions: [{ id: "here-share", seedKey: "share", name: "Sharing" }],
        roles: [{ id: "here-owner", seedKey: "owner", name: "Owner", protected: true }, { id: "here-member", seedKey: "member", name: "Member" }],
      }),
      createPermission: async (p: { name: string }) => { log.push(["createPermission", p.name]); return { id: `perm-${++n}` }; },
      updatePermission: async (id: string) => { log.push(["updatePermission", id]); },
      createRole: async (r: { name: string; permissionIds: string[] }) => { log.push(["createRole", r.name, r.permissionIds]); return { id: "new-role" }; },
      updateRole: async (id: string, r: { permissionIds: string[] }) => { log.push(["updateRole", id, r.permissionIds]); },
      setRules: async (r: unknown) => { log.push(["setRules", r]); },
      folders: async () => [{ id: "t1", parentId: null, name: "labels" }, { id: "t2", parentId: "t1", name: "BIG" }],
      setFolderDefault: async (f: string, k: string, p: string) => { log.push(["setFolderDefault", f, k, p]); },
      memberEmails: async () => ["b@x.example"],
      invite: async (e: string, r?: string) => { log.push(["invite", e, r]); },
      setUiPref: async (k: string, v: unknown) => { log.push(["setUiPref", k, v]); },
      setShortcuts: (s: Record<string, string>) => { log.push(["setShortcuts", s]); },
    };
  };

  it("leaves the owner role out and names permissions by key, not by id", async () => {
    const pkg = await pkgOf();
    expect(pkg.roles.map((r) => r.key)).toEqual(["seed:member", "name:prepress"]);
    expect(pkg.roles[1].permissions).toEqual(["seed:share", "name:print shop"]);
    expect(JSON.stringify(pkg.roles)).not.toContain("p1");
  });

  it("keeps folder paths and drops defaults whose folder is gone", async () => {
    expect((await pkgOf()).folderDefaults).toEqual([{ path: ["Labels", "Big"], kind: "export", profile: "Shop" }]);
  });

  it("matches seeded roles by key, whatever they are called here, and new ones use the right permissions", async () => {
    const { t: base, log } = target();
    const res = await importSettingsPackage(await pkgOf(), ["roles"], "skip", { ...base, ...wide(log) });
    // "share" and the member role are here: skipped. The others are new.
    expect(log).toContainEqual(["createPermission", "Print shop"]);
    expect(log).toContainEqual(["createRole", "Prepress", ["here-share", "perm-1"]]);
    expect(log.some((l) => l[0] === "updateRole")).toBe(false);
    expect(res.skipped).toBe(2);
  });

  it("replaces seeded roles and permissions when asked, and never touches the owner role", async () => {
    const { t: base, log } = target();
    await importSettingsPackage(await pkgOf(), ["roles"], "replace", { ...base, ...wide(log) });
    expect(log).toContainEqual(["updatePermission", "here-share"]);
    expect(log).toContainEqual(["updateRole", "here-member", ["here-share"]]);
    expect(JSON.stringify(log)).not.toContain("here-owner");
  });

  it("sets the rules, and finds folders by path ignoring case", async () => {
    const { t: base, log } = target({ profiles: [{ id: "prof", name: "shop" }] });
    const res = await importSettingsPackage(await pkgOf(), ["workspaceRules", "folderDefaults"], "skip", { ...base, ...wide(log) });
    expect(log).toContainEqual(["setRules", { requireApproval: true, exportManagedBy: "admins", printManagedBy: "members" }]);
    expect(log).toContainEqual(["setFolderDefault", "t2", "export", "prof"]);
    expect(res.unmatched).toEqual([]);
  });

  it("says which folder defaults found no folder or profile", async () => {
    const { t: base, log } = target();
    const res = await importSettingsPackage(await pkgOf(), ["folderDefaults"], "skip", { ...base, ...wide(log) });
    expect(res.unmatched).toEqual(["Labels / Big: Shop"]);
    expect(log.some((l) => l[0] === "setFolderDefault")).toBe(false);
  });

  it("invites only who is not here yet, with the role from the file if it arrived", async () => {
    const { t: base, log } = target();
    const res = await importSettingsPackage(await pkgOf(), ["roles", "memberEmails"], "skip", { ...base, ...wide(log) });
    expect(log.filter((l) => l[0] === "invite")).toEqual([["invite", "a@x.example", "new-role"]]);
    expect(res.skipped).toBeGreaterThan(0);
  });

  it("invites nobody unless members are chosen", async () => {
    const { t: base, log } = target();
    await importSettingsPackage(await pkgOf(), ["roles", "workspaceRules", "folderDefaults", "uiPrefs", "shortcuts"], "keep", { ...base, ...wide(log) });
    expect(log.some((l) => l[0] === "invite")).toBe(false);
  });

  it("takes interface preferences and shortcuts in a person's own file", async () => {
    const { t: base, log } = target();
    await importSettingsPackage(await pkgOf(), ["uiPrefs", "shortcuts"], "skip", { ...base, ...wide(log) });
    expect(log).toContainEqual(["setUiPref", "theme", "dark"]);
    expect(log).toContainEqual(["setShortcuts", { "commandMenu.open": "mod+p" }]);
  });

  it("counts what a file holds", async () => {
    const pkg = await pkgOf();
    expect(partCount(pkg, "roles")).toBe(4);
    expect(partCount(pkg, "workspaceRules")).toBe(1);
    expect(partCount(pkg, "memberEmails")).toBe(2);
    expect(partCount(pkg, "colorLibraries")).toBe(0);
  });
});
