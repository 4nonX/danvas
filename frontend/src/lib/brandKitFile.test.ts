import { describe, expect, it } from "vitest";
import type { BrandKit, WorkspaceFont } from "@hc/sdk";
import { CodedError } from "./errors";
import { zipFiles, unzipFiles } from "./zip";
import {
  checkManifest, colorOfHex, exportKit, freeKitName, hexOfColor, kitNamed, readKitFile, uploadKitContent,
  KIT_FORMAT, type ImportTarget,
} from "./brandKitFile";

const enc = new TextEncoder();
const bytes = (s: string) => enc.encode(s);

function kit(over: Partial<BrandKit> = {}): BrandKit {
  return {
    id: "kit-1", workspaceId: "ws-1", name: "Acme", version: 7, isDefault: true,
    palettes: [{ id: "p-1", name: "Main", colors: [
      { id: "s-1", role: "primary", name: "Red", value: { srgb: { r: 1, g: 0, b: 0, a: 1 } } },
      { id: "s-2", role: "accent", value: { srgb: { r: 0, g: 0.5019607843137255, b: 1, a: 0.5019607843137255 }, cmyk: { c: 1, m: 0.5, y: 0, k: 0 } } },
    ] }],
    fonts: [{ id: "f-1", role: "heading", fontFamily: "Brand Sans", defaultStyle: { weight: 700 } }, { id: "f-2", role: "body", fontFamily: "Inter" }],
    logos: [{ id: "l-1", label: "Wordmark", assetId: "a-logo", variants: { dark: "a-logo-dark" }, minSizePx: 24 }],
    voice: { tone: ["warm"], doSay: ["we"], dontSay: ["cheap"], sampleCopy: "Hello", modelProfileId: "mp-1" },
    collections: [{ id: "c-1", kind: "icons", assetIds: ["a-icon", "a-logo"] }],
    controls: { lockColors: true, lockFonts: false, restrictTemplates: false, lintPolicy: "block" },
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z",
    ...over,
  };
}

const assetData: Record<string, Uint8Array> = {
  "a-logo": bytes("<svg>logo</svg>"),
  "a-logo-dark": bytes("<svg>dark</svg>"),
  "a-icon": bytes("PNGDATA"),
};
const assets = new Map([
  ["a-logo", { id: "a-logo", filename: "Wordmark Ä.svg", mimeType: "image/svg+xml" }],
  ["a-logo-dark", { id: "a-logo-dark", filename: "wordmark-dark.svg", mimeType: "image/svg+xml" }],
  ["a-icon", { id: "a-icon", filename: null, mimeType: "image/png" }],
]);
const fonts: WorkspaceFont[] = [
  { id: "wf-1", workspaceId: "ws-1", family: "Brand Sans", weight: 700, style: "normal", fileName: "bs.woff2", format: "woff2", sizeBytes: 4, createdAt: "" },
  { id: "wf-2", workspaceId: "ws-1", family: "Other", weight: 400, style: "normal", fileName: "o.woff2", format: "woff2", sizeBytes: 4, createdAt: "" },
];
const sources = {
  assets,
  assetBytes: async (id: string) => { const d = assetData[id]; if (!d) throw new Error("gone"); return d; },
  fonts,
  fontBytes: async (id: string) => bytes(`FONT:${id}`),
};

function target(over: Partial<ImportTarget> = {}) {
  const uploaded: { name: string; data: string }[] = [];
  const faces: { family: string; data: string }[] = [];
  let n = 0;
  const t: ImportTarget = {
    uploadAsset: async (file, filename) => { uploaded.push({ name: filename, data: await file.text() }); return { id: `new-${++n}` }; },
    uploadFont: async (file, face) => { faces.push({ family: face.family, data: await file.text() }); },
    ...over,
  };
  return { t, uploaded, faces };
}

describe("brand kit colors", () => {
  it("writes and reads hex, with alpha when not opaque", () => {
    expect(hexOfColor({ srgb: { r: 1, g: 0, b: 0, a: 1 } })).toBe("#ff0000");
    expect(hexOfColor({ srgb: { r: 0, g: 0.5019607843137255, b: 1, a: 0.5019607843137255 } })).toBe("#0080ff80");
    expect(colorOfHex("#0080FF80")?.srgb.a).toBeCloseTo(128 / 255);
    expect(colorOfHex("#abc")?.srgb.r).toBeCloseTo(0xaa / 255);
    expect(colorOfHex("red")).toBeNull();
  });
});

describe("brand kit export and import", () => {
  it("round-trips a kit through the file with new asset ids and the same kit ids", async () => {
    const res = await exportKit(kit(), sources, new Date("2026-10-16T12:00:00Z"));
    expect(res.fileName).toBe("acme.brandkit.zip");
    expect(res.missing).toEqual([]);
    const parsed = await readKitFile(new Uint8Array(await res.blob.arrayBuffer()));
    const m = parsed.manifest;
    expect(m.format).toBe(KIT_FORMAT);
    expect(m.exportedAt).toBe("2026-10-16T12:00:00.000Z");
    // Only the workspace face of a family the kit uses travels.
    expect(m.fontFiles).toEqual([{ family: "Brand Sans", weight: 700, style: "normal", file: "fonts/brand-sans-700.woff2" }]);
    // The logo used again in a collection is stored once.
    expect(m.collections[0].files).toEqual(["icons/icon.png", m.logos[0].file]);
    expect(m.logos[0].file).toBe("logos/wordmark-a.svg");
    expect((m.voice as Record<string, unknown>).modelProfileId).toBeUndefined();

    const { t, uploaded, faces } = target();
    const content = await uploadKitContent(parsed, t);
    expect(faces).toEqual([{ family: "Brand Sans", data: "FONT:wf-1" }]);
    expect(uploaded.map((u) => u.data).sort()).toEqual(["<svg>dark</svg>", "<svg>logo</svg>", "PNGDATA"]);
    expect(content.palettes[0].id).toBe("p-1");
    expect(content.palettes[0].colors.map((c) => c.id)).toEqual(["s-1", "s-2"]);
    expect(content.palettes[0].colors[1].value.cmyk).toEqual({ c: 1, m: 0.5, y: 0, k: 0 });
    expect(content.palettes[0].colors[1].value.srgb.a).toBeCloseTo(128 / 255);
    expect(content.fonts).toEqual([
      { id: "f-1", role: "heading", fontFamily: "Brand Sans", defaultStyle: { weight: 700 } },
      { id: "f-2", role: "body", fontFamily: "Inter" },
    ]);
    const logo = content.logos[0];
    expect(logo.id).toBe("l-1");
    expect(logo.minSizePx).toBe(24);
    expect(logo.assetId).toMatch(/^new-/);
    expect(logo.variants?.dark).toMatch(/^new-/);
    expect(content.collections[0].assetIds[1]).toBe(logo.assetId);
    expect(content.controls).toEqual({ lockColors: true, lockFonts: false, restrictTemplates: false, lintPolicy: "block" });
    expect(content.voice).toEqual({ tone: ["warm"], doSay: ["we"], dontSay: ["cheap"], sampleCopy: "Hello" });
  });

  it("leaves out what cannot be read and says so", async () => {
    const res = await exportKit(kit({ collections: [{ id: "c-1", kind: "photos", assetIds: ["a-gone"] }] }), sources);
    expect(res.missing).toEqual(["a-gone"]);
    const parsed = await readKitFile(new Uint8Array(await res.blob.arrayBuffer()));
    expect(parsed.manifest.collections[0].files).toEqual([]);
  });

  it("reuses an asset whose bytes are already there", async () => {
    const res = await exportKit(kit(), sources);
    const parsed = await readKitFile(new Uint8Array(await res.blob.arrayBuffer()));
    const { t, uploaded } = target({ reuse: new Map([["h:<svg>logo</svg>", "a-logo"]]), hash: async (d) => `h:${new TextDecoder().decode(d)}` });
    const content = await uploadKitContent(parsed, t);
    expect(content.logos[0].assetId).toBe("a-logo");
    expect(uploaded.map((u) => u.data)).not.toContain("<svg>logo</svg>");
  });

  it("reads a zip packed from a folder and a bare manifest", async () => {
    const manifest = { format: KIT_FORMAT, formatVersion: 1, name: "Hand made", logos: [{ label: "Mark", file: "./logos/mark.svg" }], palettes: [{ name: "P", colors: [{ role: "primary", hex: "#112233" }] }] };
    const zip = zipFiles([
      { name: "my-kit/", data: new Uint8Array() },
      { name: "my-kit/brandkit.json", data: bytes(JSON.stringify(manifest)) },
      { name: "my-kit/logos/mark.svg", data: bytes("<svg/>") },
    ]);
    const parsed = await readKitFile(new Uint8Array(await zip.arrayBuffer()));
    expect(parsed.manifest.logos[0].file).toBe("logos/mark.svg");
    expect(parsed.files.get("logos/mark.svg")).toBeDefined();
    const { t } = target();
    const content = await uploadKitContent(parsed, t);
    expect(content.palettes[0].id).toMatch(/^p-/);
    expect(content.palettes[0].colors[0].value.srgb.b).toBeCloseTo(0x33 / 255);

    const bare = await readKitFile(bytes(JSON.stringify({ format: KIT_FORMAT, formatVersion: 1, name: "Colors only", palettes: [] })));
    expect(bare.manifest.name).toBe("Colors only");
  });
});

describe("brand kit file checks", () => {
  const code = async (p: Promise<unknown>) => {
    try { await p; } catch (e) { return e instanceof CodedError ? e.code : String(e); }
    return "ok";
  };
  it("names the problem", async () => {
    expect(await code(readKitFile(bytes("{}")))).toBe("errors.brandkit_not_a_kit_file");
    expect(await code(readKitFile(bytes("not json")))).toBe("errors.brandkit_not_a_kit_file");
    expect(await code(readKitFile(bytes(JSON.stringify({ format: KIT_FORMAT, formatVersion: 2, name: "x" }))))).toBe("errors.brandkit_newer_format");
    expect(await code(readKitFile(bytes(JSON.stringify({ format: KIT_FORMAT, formatVersion: 1, name: "x", logos: [{ label: "a", file: "logos/a.svg" }] }))))).toBe("errors.brandkit_file_missing");
    expect(() => checkManifest({ format: KIT_FORMAT, formatVersion: 1, name: "x", palettes: [{ name: "p", colors: [{ hex: "nope" }] }] })).toThrow(/is not a color/);
    expect(() => checkManifest({ format: KIT_FORMAT, formatVersion: 1, name: "x", controls: { lintPolicy: "loud" } })).toThrow(/lintPolicy/);
    expect(() => checkManifest({ format: KIT_FORMAT, formatVersion: 1, name: "  " })).toThrow(/name is empty/);
  });
});

describe("kit names", () => {
  it("finds a free name and a taken one, in any case", () => {
    expect(freeKitName("Acme", ["Acme", "acme (2)"])).toBe("Acme (3)");
    expect(freeKitName("Acme (2)", ["Acme (2)"])).toBe("Acme (3)");
    expect(freeKitName("New", ["Acme"])).toBe("New");
    expect(kitNamed([kit()], " acme ")?.id).toBe("kit-1");
  });
});

describe("zip reader", () => {
  it("reads deflated entries written by other tools", async () => {
    const text = "hello hello hello hello brand kit";
    const raw = new Uint8Array(await new Response(new Blob([bytes(text)]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    // A stored archive, then the entry switched to deflate with its sizes.
    const zip = new Uint8Array(await zipFiles([{ name: "a.txt", data: raw }]).arrayBuffer());
    const v = new DataView(zip.buffer);
    v.setUint16(8, 8, true); // local: method
    v.setUint32(22, text.length, true); // local: uncompressed size
    const cd = 30 + 5 + raw.length;
    v.setUint16(cd + 10, 8, true); // central: method
    v.setUint32(cd + 24, text.length, true); // central: uncompressed size
    const out = await unzipFiles(zip);
    expect(new TextDecoder().decode(out[0].data)).toBe(text);
  });
});
