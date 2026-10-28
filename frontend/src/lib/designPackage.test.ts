// danvas packages: a design exported with its uploads and fonts comes back on
// another instance pointing at the new uploads (by id and by URL), in its
// folders, without the source's brand kit; repeated imports skip what is
// there; broken or newer packages are refused with a clear code.
import { describe, expect, it } from "vitest";
import { createBlankDesign, createNode, type DesignFile, type Node } from "@hc/schema";
import type { WorkspaceFont } from "@hc/sdk";
import { CodedError } from "./errors";
import { zipFiles } from "./zip";
import {
  checkPackageManifest, exportPackage, familiesIn, importPackage, packageItems, readPackage, remapReferences, uuidsIn,
  PACKAGE_FORMAT, PACKAGE_MANIFEST, type PackageTarget,
} from "./designPackage";

const A1 = "11111111-1111-4111-8111-111111111111";
const A2 = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333"; // a uuid that is no upload

function design(title: string, assetIds: string[], font = "Brand Sans"): DesignFile {
  const d = createBlankDesign({ title, width: 800, height: 600 });
  d.pages[0].children.push(...assetIds.map((id, i) => createNode("image", {
    id: `n-${OTHER}-${i}`, size: { width: 10, height: 10 }, source: { assetId: id, naturalWidth: 10, naturalHeight: 10 }, fit: "cover",
  } as Partial<Node>)));
  const text = createNode("text", { id: "t1" } as Partial<Node>) as unknown as { content: { runs: unknown[] }[] };
  text.content[0].runs = [{ text: "x", style: { fontFamily: font, fontStyle: "Regular", fontSize: 24, fill: { type: "solid", color: { srgb: { r: 0, g: 0, b: 0, a: 1 } } } } }];
  d.pages[0].children.push(text as unknown as Node);
  (d as unknown as { assets: unknown[] }).assets = assetIds.map((id) => ({ id, kind: "image", url: `https://s3.old.example/ws/${id}.png`, mime: "image/png" }));
  (d as unknown as { meta: Record<string, unknown> }).meta = { ...(d.meta ?? {}), brandKitId: "kit-1", brandKitVersion: 3 };
  return d;
}

const files: Record<string, DesignFile> = { d1: design("Etikett", [A1, A2]), d2: design("Flyer", [A2], "Other Font") };
const fonts: WorkspaceFont[] = [
  { id: "f1", workspaceId: "ws", family: "Brand Sans", weight: 700, style: "normal", fileName: "bs.woff2", format: "woff2", sizeBytes: 4, createdAt: "" },
  { id: "f2", workspaceId: "ws", family: "Unused", weight: 400, style: "normal", fileName: "u.woff2", format: "woff2", sizeBytes: 4, createdAt: "" },
];
const sources = {
  designFile: async (id: string) => structuredClone(files[id]),
  assets: new Map([A1, A2].map((id) => [id, { id, filename: `${id.slice(0, 2)}.png`, mimeType: "image/png", url: `https://s3.old.example/ws/${id}.png` }])),
  assetBytes: async (id: string) => new TextEncoder().encode(`PNG:${id}`),
  fonts,
  fontBytes: async (id: string) => new TextEncoder().encode(`FONT:${id}`),
};

function target(over: Partial<PackageTarget> = {}) {
  const uploads: { name: string; body: string }[] = [];
  const created: { title: string; file: DesignFile; folderId: string | null }[] = [];
  const fontsAdded: string[] = [];
  const folders = new Map<string, string>();
  let n = 0;
  const t: PackageTarget = {
    uploadAsset: async (f, filename) => {
      uploads.push({ name: filename, body: await f.text() });
      const id = `aaaaaaaa-0000-4000-8000-00000000000${++n}`;
      return { id, url: `/api/v1/assets/${id}/content` };
    },
    uploadFont: async (f, face) => { fontsAdded.push(`${face.family}:${await f.text()}`); },
    hasFonts: new Set(),
    folderFor: async (path) => {
      if (!path.length) return "root";
      const k = path.join("/");
      if (!folders.has(k)) folders.set(k, `folder-${folders.size + 1}`);
      return folders.get(k)!;
    },
    exists: () => false,
    createDesign: async (title, file, folderId) => { created.push({ title, file, folderId }); },
    ...over,
  };
  return { t, uploads, created, fontsAdded, folders };
}

async function roundTrip() {
  const items = [{ id: "d1", title: "Etikett", path: [] }, { id: "d2", title: "Flyer", path: ["Kunden", "Filiale"] }];
  const res = await exportPackage(items, sources, new Date("2026-10-23T12:00:00Z"));
  return { res, parsed: await readPackage(new Uint8Array(await res.blob.arrayBuffer())) };
}

describe("danvas package", () => {
  it("finds the references: uuids (not in data URLs) and font families", () => {
    const d = design("x", [A1]);
    const ids = uuidsIn({ ...d, extra: `data:image/png;base64,${A2}` });
    expect(ids.has(A1)).toBe(true);
    expect(ids.has(A2)).toBe(false);
    expect([...familiesIn(d)]).toEqual(["Brand Sans"]);
  });

  it("exports the designs with their uploads and fonts, once each, without the brand kit", async () => {
    const { res, parsed } = await roundTrip();
    expect(res).toMatchObject({ designs: 2, assets: 2, fonts: 1, failedDesigns: [], missingAssets: 0 });
    expect(parsed.manifest.assets.map((a) => a.id).sort()).toEqual([A1, A2]);
    expect(parsed.manifest.fonts.map((f) => f.family)).toEqual(["Brand Sans"]);
    expect(parsed.designs.map((d) => [d.title, d.path])).toEqual([["Etikett", []], ["Flyer", ["Kunden", "Filiale"]]]);
    const meta = (parsed.designs[0].file as unknown as { meta: Record<string, unknown> }).meta;
    expect(meta.brandKitId).toBeUndefined();
    expect(meta.brandKitVersion).toBeUndefined();
  });

  it("imports pointing at the new uploads by id and by URL, into its folders", async () => {
    const { parsed } = await roundTrip();
    const { t, uploads, created, fontsAdded } = target();
    const out = await importPackage(parsed, t);
    expect(out).toMatchObject({ assets: 2, missingFonts: [] });
    expect(out.designs.map((d) => d.status)).toEqual(["imported", "imported"]);
    expect(uploads.map((u) => u.body).sort()).toEqual([`PNG:${A1}`, `PNG:${A2}`]);
    expect(fontsAdded).toEqual(["Brand Sans:FONT:f1"]);
    const text = JSON.stringify(created[0].file);
    expect(text).not.toContain(A1);
    expect(text).not.toContain("s3.old.example");
    expect(text).toContain("/api/v1/assets/aaaaaaaa-");
    // A uuid that is no upload (here inside a node id) is left as it is.
    expect(text).toContain(`n-${OTHER}-0`);
    expect(created.map((c) => c.folderId)).toEqual(["root", "folder-1"]);
    expect(created[1].title).toBe("Flyer");
  });

  it("skips designs already there and fonts the target has; reports fonts it may not add", async () => {
    const { parsed } = await roundTrip();
    const { t, created } = target({
      exists: (_f, title) => title === "Etikett",
      uploadFont: async () => { throw new Error("forbidden"); },
    });
    const out = await importPackage(parsed, t);
    expect(out.designs.map((d) => d.status)).toEqual(["skipped", "imported"]);
    expect(out.missingFonts).toEqual(["Brand Sans"]);
    expect(created).toHaveLength(1);
    const had = target({ hasFonts: new Set(["Brand Sans|700|normal"]), uploadFont: async () => { throw new Error("not called"); } });
    expect((await importPackage(parsed, had.t)).missingFonts).toEqual([]);
  });

  it("takes whole folders with their paths, a folder inside a selected one once", () => {
    const designs = [{ id: "a", title: "A", folderId: null }, { id: "b", title: "B", folderId: "f1" }, { id: "c", title: "C", folderId: "f2" }];
    const folders = [{ id: "f1", name: "Kunden", parentId: null }, { id: "f2", name: "Filiale", parentId: "f1" }];
    expect(packageItems(["a"], ["f1", "f2"], designs, folders)).toEqual([
      { id: "a", title: "A", path: [] },
      { id: "b", title: "B", path: ["Kunden"] },
      { id: "c", title: "C", path: ["Kunden", "Filiale"] },
    ]);
  });

  it("refuses what is not a package, a newer one and an incomplete one", async () => {
    const code = async (bytes: Uint8Array) => {
      try { await readPackage(bytes); return "read"; } catch (e) { return e instanceof CodedError ? e.code : String(e); }
    };
    expect(await code(new Uint8Array([1, 2, 3]))).toBe("errors.package_not_a_package");
    const zip = async (manifest: unknown, extra: { name: string; data: Uint8Array }[] = []) =>
      new Uint8Array(await zipFiles([{ name: PACKAGE_MANIFEST, data: new TextEncoder().encode(JSON.stringify(manifest)) }, ...extra]).arrayBuffer());
    const base = { format: PACKAGE_FORMAT, formatVersion: 1, exportedAt: "", designs: [{ file: "designs/1.hyc", title: "x", path: [] }], assets: [], fonts: [] };
    expect(await code(await zip({ ...base, formatVersion: 3 }))).toBe("errors.package_newer");
    expect(await code(await zip(base))).toBe("errors.package_file_missing");
    expect(() => checkPackageManifest({ ...base, designs: [{ file: "../etc/passwd", title: "x", path: [] }] })).toThrow(CodedError);
  });

  it("remaps references only where mapped and never inside data URLs", () => {
    const v = { a: `url(/x/${A1}.png)`, b: `data:,${A1}`, c: A2 };
    expect(remapReferences(v, new Map([[A1, "new"]]), new Map())).toEqual({ a: "url(/x/new.png)", b: `data:,${A1}`, c: A2 });
  });
});

describe("templates in a package", () => {
  const tplFiles: Record<string, DesignFile> = { t1: design("Label 50x30", [A1]) };
  const withTemplates = { ...sources, templateFile: async (id: string) => structuredClone(tplFiles[id]) };

  it("takes templates along with their uploads and fonts, as format version 2", async () => {
    const res = await exportPackage([], withTemplates, new Date("2026-10-28T00:00:00Z"), [{ id: "t1", title: "Label 50x30", categories: ["Labels"] }]);
    expect(res.designs).toBe(0);
    expect(res.templates).toBe(1);
    expect(res.assets).toBe(1);
    expect(res.fonts).toBe(1);
    const p = await readPackage(new Uint8Array(await res.blob.arrayBuffer()));
    expect(p.manifest.formatVersion).toBe(2);
    expect(p.templates).toHaveLength(1);
    expect(p.templates[0]).toMatchObject({ title: "Label 50x30", categories: ["Labels"] });
    expect((p.templates[0].file.meta as Record<string, unknown> | undefined)?.brandKitId).toBeUndefined();
  });

  it("still writes a design-only package as version 1", async () => {
    const res = await exportPackage([{ id: "d1", title: "Etikett", path: [] }], sources);
    const p = await readPackage(new Uint8Array(await res.blob.arrayBuffer()));
    expect(p.manifest.formatVersion).toBe(1);
    expect(p.manifest.templates).toBeUndefined();
    expect(p.templates).toEqual([]);
  });

  it("creates the templates pointing at the new uploads, skipping titles that exist", async () => {
    const res = await exportPackage([], withTemplates, new Date(), [
      { id: "t1", title: "Label 50x30", categories: ["Labels"] },
      { id: "t1", title: "Already there", categories: [] },
    ]);
    const p = await readPackage(new Uint8Array(await res.blob.arrayBuffer()));
    const made: { title: string; file: DesignFile; categories: string[] }[] = [];
    const { t } = target({
      createTemplate: async (title, file, categories) => { made.push({ title, file, categories }); },
      templateExists: (title) => title === "Already there",
    });
    const out = await importPackage(p, t);
    expect(out.templates.map((x) => x.status)).toEqual(["imported", "skipped"]);
    expect(made[0].title).toBe("Label 50x30");
    expect(made[0].categories).toEqual(["Labels"]);
    expect(JSON.stringify(made[0].file)).not.toContain(A1);
  });

  it("reports templates as not imported where the role may not publish them", async () => {
    const res = await exportPackage([], withTemplates, new Date(), [{ id: "t1", title: "Label 50x30", categories: [] }]);
    const p = await readPackage(new Uint8Array(await res.blob.arrayBuffer()));
    const out = await importPackage(p, target().t);
    expect(out.templates[0].status).toBe("failed");
    expect((out.templates[0].error as CodedError).code).toBe("errors.package_templates_not_allowed");
  });
});
