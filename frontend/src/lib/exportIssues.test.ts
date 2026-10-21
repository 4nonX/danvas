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
        { kind: "image-resolution", subject: "Logo.png", ppi: 18, where: [{ page: 1, element: "Logo" }] },
      ]);
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
});
