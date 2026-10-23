// The colour list of a print export: which colours a design uses, what the
// print file carries for them, the brand colour and the nearest library entry.
import { describe, expect, it } from "vitest";
import type { DesignFile } from "@hc/schema";
import type { BrandKit } from "@hc/sdk";
import { collectDesignColors, colorListPdf, colorListRows, type ColorListLabels } from "./colorReport";

const rgb = (r: number, g: number, b: number, a = 1) => ({ srgb: { r, g, b, a } });
const node = (id: string, extra: Record<string, unknown>) => ({ id, type: "shape", ...extra });

const doc = {
  pages: [
    {
      id: "p1", width: 100, height: 100,
      background: { type: "solid", color: rgb(1, 1, 1) },
      children: [
        node("a", { fill: { type: "solid", color: rgb(1, 0, 0) }, stroke: { fill: { type: "solid", color: rgb(0, 0, 0) }, width: 1 } }),
        node("b", { hidden: true, fill: { type: "solid", color: rgb(0, 1, 0) } }),
        node("c", { fill: { type: "solid", color: rgb(0, 0, 1, 0) } }),
        { id: "t", type: "text", paragraphs: [{ runs: [{ text: "x", style: { color: { ...rgb(0.2, 0.4, 0.6), cmyk: { c: 0.8, m: 0.4, y: 0, k: 0.1 } } } }] }] },
        { id: "i", type: "image", source: { assetId: "x" } },
      ],
    },
    {
      id: "p2", width: 100, height: 100,
      children: [
        node("d", { fill: { type: "linear", stops: [{ offset: 0, color: rgb(1, 0, 0) }, { offset: 1, color: { ...rgb(0.9, 0.8, 0), spot: { name: "HKS 3", fallback: { c: 0, m: 0.1, y: 1, k: 0 } } } }] } }),
      ],
    },
  ],
} as unknown as DesignFile;

describe("colour list", () => {
  it("collects each shown colour once, with its uses and pages", () => {
    const { colors, images } = collectDesignColors(doc);
    expect(images).toBe(1);
    expect(colors.map((c) => c.hex)).toEqual(["#ffffff", "#ff0000", "#000000", "#336699", "#e6cc00"]);
    const red = colors[1];
    expect(red.uses).toEqual(["fill", "gradient"]);
    expect(red.pages).toEqual([1, 2]);
    expect(colors[0].uses).toEqual(["background"]);
    expect(colors[2].uses).toEqual(["stroke"]);
    expect(colors[3].uses).toEqual(["text"]);
    expect(colors[3].key).toBe("cmyk:800,400,0,100");
    expect(colors[4].key).toBe("spot:HKS 3");
  });

  it("works out print values, the brand colour and the nearest library entry", () => {
    const { colors } = collectDesignColors(doc);
    const kit = { palettes: [{ id: "p", name: "Main", colors: [
      { id: "s1", role: "primary", name: "Rot", value: rgb(0.999, 0, 0), pantone: "PANTONE 485 C" },
      { id: "s2", role: "accent", value: { ...rgb(0.5, 0.5, 0.5), cmyk: { c: 0.8, m: 0.4, y: 0, k: 0.1 } } },
    ] }] } as unknown as BrandKit;
    const converter = {
      cmyk: (): [number, number, number, number] => [0, 1, 1, 0],
      lab: (c: number, m: number): [number, number, number] => (m > 0.9 ? [48, 68, 48] : [50, 0, 0]),
    };
    const rows = colorListRows(colors, {
      converter,
      srgbLab: (r, g, b) => [Math.round((r + g + b) * 33), r * 80 - g * 80, g * 60 - b * 60],
      kit,
      library: [{ name: "Book 485", lab: [47.5, 68, 48] }, { name: "Grey", lab: [50, 0, 0] }],
    });
    const red = rows[1];
    expect(red.print).toBe("converted");
    expect(red.cmyk).toEqual([0, 1, 1, 0]);
    expect(red.brand).toMatchObject({ name: "Rot", pantone: "PANTONE 485 C" });
    expect(red.nearest?.name).toBe("Book 485");
    expect(red.nearest!.deltaE).toBeLessThan(1);
    // Exact CMYK is kept, and matches the brand swatch with the same values
    // even when the screen colour differs.
    expect(rows[3].print).toBe("exact");
    expect(rows[3].cmyk).toEqual([0.8, 0.4, 0, 0.1]);
    expect(rows[3].brand).toMatchObject({ name: "accent", deltaE: 0 });
    expect(rows[4]).toMatchObject({ print: "spot", spotName: "HKS 3", cmyk: [0, 0.1, 1, 0] });
    expect(rows[0].brand).toBeUndefined();
  });

  it("writes a PDF", async () => {
    const labels: ColorListLabels = {
      title: "Farbliste", meta: [["Design", "Zäpfchen"]],
      columns: { color: "Farbe", print: "Druck", lab: "Lab", brand: "Marke", nearest: "Nächste", used: "Verwendet" },
      spot: "Sonderfarbe", exact: "Exakt", converted: "Umgerechnet",
      uses: { fill: "Füllung", stroke: "Kontur", text: "Text", gradient: "Verlauf", background: "Hintergrund", effect: "Effekt" },
      page: "Seite", images: "1 Bild", note: "Hinweis", none: "keine",
    };
    const rows = Array.from({ length: 40 }, (_, i) => ({
      hex: "#ff0000", print: "converted" as const, cmyk: [0, 1, 1, 0] as [number, number, number, number], lab: [48, 68, 48] as [number, number, number],
      nearest: { name: `PANTONE ${i} C`, deltaE: 0.4 }, uses: ["fill" as const], pages: [1],
    }));
    const blob = await colorListPdf(rows, labels);
    const text = new TextDecoder("latin1").decode(new Uint8Array(await blob.arrayBuffer()));
    expect(text.startsWith("%PDF-")).toBe(true);
    // Lines inside a cell stay lines (not replaced like unprintable characters).
    expect(text).not.toContain("Umgerechnet?");
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });
});
