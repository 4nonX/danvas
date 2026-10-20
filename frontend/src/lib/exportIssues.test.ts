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
