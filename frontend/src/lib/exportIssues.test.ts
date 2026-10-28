/**
 * @vitest-environment jsdom
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DesignFile } from "@hc/schema";

// Faces the vector export finds a file for: Titillium Web only.
vi.mock("@/lib/vectorPdf/fontSource", () => ({
  loadFace: async (req: { family: string }) => (req.family === "Titillium Web" ? { subsets: [] } : null),
}));

// The browser's font loading: every face of Titillium Web exists, except
// the italic, which the stylesheet does not have.
const loads: string[] = [];
beforeAll(() => {
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      ready: Promise.resolve(),
      load: (font: string) => {
        loads.push(font);
        return Promise.resolve(font.startsWith("italic") ? [] : [{}]);
      },
    },
  });
});

const { fonts } = await import("./fontProvider");
const { exportIssues } = await import("./exportIssues");
const { imageAssets } = await import("./assetProvider");
const { defaultRules } = await import("./exportProfiles");

const run = (text: string, fontFamily: string, fontStyle: string) => ({ text, style: { fontFamily, fontStyle, fontSize: 12 } });
const text = (id: string, runs: ReturnType<typeof run>[], extra: Record<string, unknown> = {}) => ({ id, type: "text", content: [{ runs }], ...extra });

function design(children: unknown[]): DesignFile {
  return { format: "hycanvas.design", schemaVersion: 28, id: "d", title: "D", unit: "px", dpi: 96, assets: [{ id: "gone", kind: "image", url: "/nowhere.png", name: "Logo.png" }], fonts: [], meta: {}, pages: [{ id: "p", width: 100, height: 100, children }] } as unknown as DesignFile;
}

/** Let the stylesheet "load" and the face promises settle. */
async function settle(family: string) {
  document.getElementById(`oc-font-${family.toLowerCase().replace(/\s+/g, "-")}`)?.dispatchEvent(new Event("load"));
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("font faces", () => {
  it("loads every weight and slant a design uses, and is settled only when they are in", async () => {
    const doc = design([text("t", [run("Plain", "Titillium Web", "Regular"), run("Strong", "Titillium Web", "Bold"), run("Slanted", "Titillium Web", "Italic")])]);
    fonts.ensureForDoc(doc);
    expect(fonts.isSettled("Titillium Web")).toBe(false);
    await settle("Titillium Web");
    expect(loads).toEqual(expect.arrayContaining(['700 16px "Titillium Web"', 'italic 400 16px "Titillium Web"']));
    expect(fonts.isSettled("Titillium Web")).toBe(true);
    expect(fonts.faceState("Titillium Web", { weight: 700, italic: false })).toBe("ready");
    expect(fonts.faceState("Titillium Web", { weight: 400, italic: true })).toBe("failed");
  });
});

describe("exportIssues", () => {
  it("names fallback fonts, outline-less fonts and missing images with page and element", async () => {
    const doc = design([
      text("a", [run("MARKT", "Trajan Pro", "Bold")], { name: "Logo word" }),
      text("b", [run("Hello", "Titillium Web", "Bold")]),
      { id: "img", type: "image", name: "Header", source: { assetId: "gone", naturalWidth: 1, naturalHeight: 1 } },
      text("h", [run("Hidden", "Nobody Sans", "Regular")], { hidden: true }),
    ]);
    imageAssets.registerAll([]);
    const raster = await exportIssues(doc, [0], { vector: false });
    expect(raster).toEqual(expect.arrayContaining([
      { kind: "font", subject: "Trajan Pro Bold", where: [{ page: 1, element: "Logo word" }] },
      { kind: "image", subject: "Logo.png", where: [{ page: 1, element: "Header" }] },
    ]));
    expect(raster.some((i) => i.subject.startsWith("Nobody Sans"))).toBe(false);
    expect(raster.some((i) => i.kind === "font-outline")).toBe(false);
  });

  it("flags images placed larger than their pixels carry, for print only", async () => {
    // A 155 x 63 px logo (its node records no pixel size, as imported images
    // often do not) placed 846 px wide at 96 dpi: about 18 dpi.
    const status = vi.spyOn(imageAssets, "status").mockReturnValue("ready");
    const image = vi.spyOn(imageAssets, "image").mockReturnValue({ naturalWidth: 155, naturalHeight: 63 });
    const doc = design([
      { id: "logo", type: "image", name: "Logo", transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, size: { width: 846, height: 343 }, source: { assetId: "gone", naturalWidth: 0, naturalHeight: 0 }, fit: "contain" },
    ]);
    try {
      expect(await exportIssues(doc, [0], { vector: false })).toEqual([]);
      expect(await exportIssues(doc, [0], { vector: false, print: true })).toEqual([
        { kind: "image-resolution", subject: "Logo.png", ppi: 18, limit: 150, where: [{ page: 1, element: "Logo" }] },
      ]);
      // A print shop asking for 300 dpi, as a reason to refuse the download.
      const rules = { ...defaultRules(), minPpi: { level: "block" as const, value: 300 } };
      expect(await exportIssues(doc, [0], { vector: false, print: true, printCheck: { rules } })).toEqual([
        { kind: "image-resolution", subject: "Logo.png", ppi: 18, limit: 300, blocking: true, where: [{ page: 1, element: "Logo" }] },
      ]);
      // Switched off, it is not checked at all.
      expect(await exportIssues(doc, [0], { vector: false, print: true, printCheck: { rules: { ...rules, minPpi: { level: "off", value: 300 } } } })).toEqual([]);
    } finally {
      status.mockRestore();
      image.mockRestore();
    }
  });

  it("adds the outline check for vector formats, only for fonts the canvas draws", async () => {
    const doc = design([text("b", [run("Hello", "Titillium Web", "Bold")]), text("c", [run("Body", "Arimo", "Regular")])]);
    fonts.ensureForDoc(doc);
    await settle("Arimo");
    // Arimo draws on the canvas, but the mocked vector export has no file for it.
    const vector = await exportIssues(doc, [0], { vector: true });
    expect(vector).toEqual([{ kind: "font-outline", subject: "Arimo Regular", where: [{ page: 1, element: "Body" }] }]);
  });
});

describe("print checks", () => {
  const T = (x: number, y: number, scale = 1) => ({ x, y, scaleX: scale, scaleY: scale, rotation: 0 });
  const col = (r: number, g: number, b: number) => ({ type: "solid", color: { srgb: { r, g, b, a: 1 } } });
  const rect = (id: string, x: number, y: number, w: number, h: number, extra: Record<string, unknown> = {}) => ({ id, name: id, type: "shape", shape: "rect", transform: T(x, y), size: { width: w, height: h }, opacity: 1, blendMode: "normal", fills: [col(0.2, 0.4, 0.8)], ...extra });
  const small = (id: string, fill: ReturnType<typeof col>, size: number) => ({
    id, name: id, type: "text", transform: T(20, 20), size: { width: 60, height: 20 }, opacity: 1, blendMode: "normal",
    box: { mode: "fixed", width: 60, height: 20, autoFit: { enabled: false, min: 8, max: 512 }, verticalAlign: "top" },
    content: [{ style: { align: "left", direction: "auto" }, runs: [{ text: "Note", style: { fontFamily: "Arimo", fontStyle: "Regular", fontSize: size, fill } }] }],
  });
  // A rough RGB to CMYK: what matters is how many inks a colour takes.
  const cmyk = (r: number, g: number, b: number): [number, number, number, number] => {
    const k = 1 - Math.max(r, g, b);
    if (k >= 1) return [0, 0, 0, 1];
    return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k];
  };
  const found = (issues: { kind: string; where: { element: string }[] }[]) => issues.flatMap((i) => i.where.map((w) => `${i.kind}:${w.element}`)).sort();

  it("flags hairlines at print size, through a group's scaling", async () => {
    const thin = { width: 0.2, fill: col(0, 0, 0), align: "center", cap: "butt", join: "miter" };
    const doc = design([
      rect("thin", 20, 20, 30, 30, { stroke: thin }),
      rect("fine", 20, 60, 30, 30, { stroke: { ...thin, width: 1 } }),
      { id: "g", name: "g", type: "group", transform: T(50, 20, 0.25), size: { width: 40, height: 40 }, opacity: 1, blendMode: "normal", children: [rect("shrunk", 0, 0, 40, 40, { stroke: { ...thin, width: 1 } })] },
    ]);
    expect(found(await exportIssues(doc, [0], { vector: false, print: true, printCheck: { bleed: true } }))).toEqual(["hairline:shrunk", "hairline:thin"]);
    expect(await exportIssues(doc, [0], { vector: false })).toEqual([]);
  });

  it("flags small text in several inks, not in black alone", async () => {
    const doc = design([small("blue", col(0.1, 0.3, 0.7), 8), small("black", col(0, 0, 0), 8), small("cyan", col(0, 1, 1), 8), small("big", col(0.1, 0.3, 0.7), 14)]);
    expect(found(await exportIssues(doc, [0], { vector: false, print: true, printCheck: { cmyk, blackOnly: true, bleed: true } }))).toEqual(["small-rich-text:blue"]);
    // An RGB file has no plates to misregister.
    expect(await exportIssues(doc, [0], { vector: false, print: true, printCheck: { cmyk: null, bleed: true } })).toEqual([]);
  });

  it("flags artwork and a coloured background at the edge when there is no bleed", async () => {
    const doc = design([rect("edge", 0, 40, 30, 20), rect("inside", 30, 30, 20, 20)]);
    (doc.pages[0] as { background?: unknown }).background = col(0.9, 0.2, 0.2);
    expect(found(await exportIssues(doc, [0], { vector: false, print: true, printCheck: { bleed: false }, backgroundLabel: "Background" }))).toEqual(["edge-no-bleed:Background", "edge-no-bleed:edge"]);
    expect(await exportIssues(doc, [0], { vector: false, print: true, printCheck: { bleed: true } })).toEqual([]);
  });

  it("flags barcodes that may not scan", async () => {
    const { buildBarcode, defaultSpec, loadBarcode } = await import("./barcode");
    const mod = await loadBarcode();
    const code = (name: string, patch: Record<string, unknown>) => {
      const spec = { ...defaultSpec(mod, "ean13", "400638133393"), text: false, ...patch } as Parameters<typeof buildBarcode>[1];
      const built = buildBarcode(mod, spec, 96);
      if (!built.ok) throw new Error(built.detail);
      return { id: name, name, type: "group", transform: T(0, 0, 1), size: { width: built.width, height: built.height }, opacity: 1, blendMode: "normal", children: built.children, data: { barcode: spec } };
    };
    const blue = { srgb: { r: 0.1, g: 0.3, b: 0.7, a: 1 } };
    const doc = design([code("fine", {}), code("tiny", { moduleMm: 0.2 }), code("tight", { quietZones: false }), code("pale", { color: { srgb: { r: 0.8, g: 0.8, b: 0.8, a: 1 } } }), code("blue", { color: blue })]);
    expect(found(await exportIssues(doc, [0], { vector: true, print: true, printCheck: { cmyk, blackOnly: true, bleed: true } }))).toEqual(["barcode-inks:blue", "barcode-light:pale", "barcode-quiet:tight", "barcode-small:tiny"]);
    // A raster file needs two pixels per module: 0.33 mm at 96 dpi is 1.25.
    expect(found(await exportIssues(design([code("fine", {})]), [0], { vector: false, rasterDpi: 96 }))).toEqual(["barcode-raster:fine"]);
    expect(await exportIssues(design([code("fine", {})]), [0], { vector: false, rasterDpi: 300 })).toEqual([]);
  });
});

describe("print shop rules", () => {
  const T = (x: number, y: number) => ({ x, y, scaleX: 1, scaleY: 1, rotation: 0 });
  const col = (r: number, g: number, b: number, extra: Record<string, unknown> = {}) => ({ type: "solid", color: { srgb: { r, g, b, a: 1 }, ...extra } });
  const shape = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, type: "shape", shape: "rect", transform: T(20, 20), size: { width: 30, height: 30 }, opacity: 1, blendMode: "normal", fills: [col(0.2, 0.4, 0.8)], ...extra });
  const note = (id: string, size: number) => ({
    id, name: id, type: "text", transform: T(20, 20), size: { width: 60, height: 20 }, opacity: 1, blendMode: "normal",
    box: { mode: "fixed", width: 60, height: 20, autoFit: { enabled: false, min: 8, max: 512 }, verticalAlign: "top" },
    content: [{ style: { align: "left", direction: "auto" }, runs: [{ text: "Note", style: { fontFamily: "Arimo", fontStyle: "Regular", fontSize: size, fill: col(0, 0, 0) } }] }],
  });
  const cmyk = (r: number, g: number, b: number): [number, number, number, number] => {
    const k = 1 - Math.max(r, g, b);
    if (k >= 1) return [0, 0, 0, 1];
    return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k];
  };
  const kinds = (issues: { kind: string; blocking?: boolean }[]) => issues.map((i) => `${i.kind}${i.blocking ? "!" : ""}`).sort();

  it("checks text below a minimum size, at its printed size", async () => {
    // 6 px at 96 dpi is 4.5 pt.
    const doc = design([note("tiny", 6), note("fine", 12)]);
    const rules = { ...defaultRules(), minTextPt: { level: "block" as const, value: 5 } };
    const issues = await exportIssues(doc, [0], { vector: false, print: true, printCheck: { bleed: true, rules } });
    expect(issues).toEqual([{ kind: "small-text", subject: "4.5 pt", limit: 5, blocking: true, where: [{ page: 1, element: "tiny" }] }]);
  });

  it("allows only the listed spot colours, ignoring case, and always the die line's", async () => {
    const doc = design([
      shape("hks", { fills: [col(0, 0.4, 0.7, { spot: { name: "HKS 43 K", fallback: { c: 1, m: 0.6, y: 0, k: 0 } } })] }),
      shape("gold", { fills: [col(0.8, 0.7, 0.3, { spot: { name: "Gold 871", fallback: { c: 0, m: 0.2, y: 0.6, k: 0.2 } } })] }),
      shape("cut", { fills: [col(1, 0, 1, { spot: { name: "Stanze", fallback: { c: 0, m: 1, y: 0, k: 0 } } })] }),
    ]);
    const rules = { ...defaultRules(), spots: { level: "warn" as const, allowed: ["hks 43 k"] } };
    const issues = await exportIssues(doc, [0], { vector: true, print: true, printCheck: { bleed: true, rules, vectorPrint: true, dieLine: { name: "Stanze" } } });
    expect(issues.map((i) => i.kind === "spot-not-allowed" && i.subject)).toEqual(["Gold 871"]);
    // None listed: no spot colour at all.
    const none = await exportIssues(doc, [0], { vector: true, print: true, printCheck: { bleed: true, rules: { ...rules, spots: { level: "block", allowed: [] } } } });
    expect(kinds(none)).toEqual(["spot-not-allowed!", "spot-not-allowed!", "spot-not-allowed!"]);
  });

  it("warns about overprinting white, and overprint an imposed image PDF loses", async () => {
    const white = shape("white", { fills: [col(1, 1, 1)], data: { print: { overprint: true } } });
    const blue = shape("blue", { data: { print: { overprint: true } } });
    const doc = design([white, blue]);
    const inFile = await exportIssues(doc, [0], { vector: true, print: true, printCheck: { cmyk, bleed: true, vectorPrint: true, overprint: "file" } });
    expect(inFile.map((i) => `${i.kind}:${i.where.map((w) => w.element).join(",")}`)).toEqual(["overprint-white:white"]);
    const lost = await exportIssues(doc, [0], { vector: false, print: true, printCheck: { cmyk, bleed: true, overprint: "lost" } });
    expect(kinds(lost)).toEqual(["overprint-flattened"]);
    // An RGB file has no plates: nothing to say.
    expect(await exportIssues(doc, [0], { vector: false, print: true, printCheck: { cmyk: null, bleed: true, overprint: "lost" } })).toEqual([]);
  });

  it("checks die line elements apart from the artwork, and says where they go", async () => {
    // A hairline die line: not a hairline issue, it is not printed.
    const cut = shape("cut", { fills: [], stroke: { width: 0.1, fill: col(1, 0, 1), align: "center", cap: "butt", join: "miter" }, data: { print: { dieLine: true } } });
    const doc = design([cut]);
    expect(kinds(await exportIssues(doc, [0], { vector: true, print: true, printCheck: { bleed: true, vectorPrint: true, dieLine: { name: "Stanze" } } }))).toEqual([]);
    expect(kinds(await exportIssues(doc, [0], { vector: true, print: true, printCheck: { bleed: true, vectorPrint: true, dieLine: null } }))).toEqual(["die-line-unused"]);
    expect(kinds(await exportIssues(doc, [0], { vector: false, print: true, printCheck: { bleed: true, vectorPrint: false } }))).toEqual(["die-line-flattened"]);
  });

  it("can switch the bleed check off or make it refuse the download", async () => {
    const edge = design([shape("edge", { transform: T(0, 0) })]);
    expect(kinds(await exportIssues(edge, [0], { vector: false, print: true, printCheck: { bleed: false } }))).toEqual(["edge-no-bleed"]);
    expect(kinds(await exportIssues(edge, [0], { vector: false, print: true, printCheck: { bleed: false, rules: { ...defaultRules(), bleed: { level: "block" } } } }))).toEqual(["edge-no-bleed!"]);
    expect(await exportIssues(edge, [0], { vector: false, print: true, printCheck: { bleed: false, rules: { ...defaultRules(), bleed: { level: "off" } } } })).toEqual([]);
  });
});
