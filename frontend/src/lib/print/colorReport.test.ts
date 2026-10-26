// The colour list of a print export: which colours a design uses, what the
// print file carries for them, the brand colour and the nearest library entry.
import { describe, expect, it } from "vitest";
import type { DesignFile } from "@hc/schema";
import type { BrandKit } from "@hc/sdk";
import { collectDesignColors, colorListAse, colorListCsv, colorListPdf, colorListRows, hsbOf, hslOf, lchOf, type ColorListLabels, type ColorListRow } from "./colorReport";
import { parseAse } from "./colorLibrary";

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

const labels: ColorListLabels = {
  title: "Farbliste", meta: [["Design", "Zäpfchen"]],
  columns: { color: "Farbe", print: "Druck", lab: "Lab", screen: "Bildschirm", brand: "Marke", nearest: "Nächste", used: "Verwendet" },
  spot: "Sonderfarbe", exact: "Exakt", converted: "Umgerechnet",
  csv: { name: "Name", brand: "Marke", role: "Rolle", pantone: "Pantone", used: "Verwendet", pages: "Seiten", print: "Druck", spot: "Sonderfarbe" },
  uses: { fill: "Füllung", stroke: "Kontur", text: "Text", gradient: "Verlauf", background: "Hintergrund", effect: "Effekt" },
  page: "Seite", images: "1 Bild", note: "Hinweis", none: "keine",
};
const row = (over: Partial<ColorListRow> = {}): ColorListRow => ({
  hex: "#c07f69", rgb: [192, 127, 105], hsl: hslOf(192 / 255, 127 / 255, 105 / 255), hsb: hsbOf(192 / 255, 127 / 255, 105 / 255),
  print: "converted", cmyk: [0.2, 0.55, 0.55, 0.05], lab: [60.5, 22.25, 19], lch: lchOf([60.5, 22.25, 19]),
  matches: [], uses: ["fill"], pages: [1], ...over,
});

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
      libraries: [
        { name: "Book", entries: [{ name: "Book 485", lab: [47.5, 68, 48] }, { name: "Grey", lab: [50, 0, 0] }] },
        { name: "Atlas", entries: [{ name: "HLC 040 50 80", lab: [50, 61.3, 51.4] }] },
      ],
    });
    const red = rows[1];
    expect(red.print).toBe("converted");
    expect(red.cmyk).toEqual([0, 1, 1, 0]);
    expect(red.brand).toMatchObject({ name: "Rot", pantone: "PANTONE 485 C" });
    // The nearest entry of every library, in their order.
    expect(red.matches.map((m) => [m.library, m.name])).toEqual([["Book", "Book 485"], ["Atlas", "HLC 040 50 80"]]);
    expect(red.matches[0].deltaE).toBeLessThan(1);
    expect(red.rgb).toEqual([255, 0, 0]);
    // Exact CMYK is kept, and matches the brand swatch with the same values
    // even when the screen colour differs.
    expect(rows[3].print).toBe("exact");
    expect(rows[3].cmyk).toEqual([0.8, 0.4, 0, 0.1]);
    expect(rows[3].brand).toMatchObject({ name: "accent", deltaE: 0 });
    expect(rows[4]).toMatchObject({ print: "spot", spotName: "HKS 3", cmyk: [0, 0.1, 1, 0] });
    expect(rows[0].brand).toBeUndefined();
  });

  it("writes a PDF", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => row({ matches: [{ library: "Book", name: `PANTONE ${i} C`, deltaE: 0.4 }] }));
    const blob = await colorListPdf(rows, labels);
    const text = new TextDecoder("latin1").decode(new Uint8Array(await blob.arrayBuffer()));
    expect(text.startsWith("%PDF-")).toBe(true);
    // Lines inside a cell stay lines (not replaced like unprintable characters).
    expect(text).not.toContain("Umgerechnet?");
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });

  it("gives HSL, HSB and LCh as design tools show them", () => {
    expect(hslOf(1, 0, 0)).toEqual([0, 100, 50]);
    expect(hsbOf(1, 0, 0)).toEqual([0, 100, 100]);
    const [h, s, l] = hslOf(192 / 255, 127 / 255, 105 / 255);
    expect([Math.round(h), Math.round(s), Math.round(l)]).toEqual([15, 41, 58]); // hsl(15, 41%, 58%)
    const lch = lchOf([50, 0, 50]);
    expect(lch[1]).toBeCloseTo(50, 6);
    expect(lch[2]).toBeCloseTo(90, 6);
    expect(lchOf([50, -10, 0])[2]).toBeCloseTo(180, 6);
  });

  it("writes every code to the CSV, with the reader's decimal mark and one column pair per library", async () => {
    const rows = [
      row({ brand: { name: "Terracotta", role: "primary", pantone: "PANTONE 7522 C", deltaE: 0 }, matches: [{ library: "HLC", name: "HLC 040 60 30", deltaE: 0.42 }] }),
      row({ hex: "#e6cc00", print: "spot", spotName: "HKS 3; gelb", matches: [] }),
    ];
    const text = (await colorListCsv(rows, labels, ",").text()).replace(/^\uFEFF/, "");
    const [head, first, second] = text.trim().split("\r\n").map((l) => l.split(";"));
    expect(head.slice(0, 5)).toEqual(["Name", "Hex", "R", "G", "B"]);
    expect(head).toContain("HLC");
    expect(head).toContain("HLC dE00");
    expect(first[head.indexOf("Name")]).toBe("Terracotta");
    expect(first[head.indexOf("C")]).toBe("20,0");
    expect(first[head.indexOf("L*")]).toBe("60,50");
    expect(first[head.indexOf("Pantone")]).toBe("PANTONE 7522 C");
    expect(first[head.indexOf("HLC")]).toBe("HLC 040 60 30");
    expect(first[head.indexOf("HLC dE00")]).toBe("0,42");
    // A name with the separator is quoted, so the columns stay in place.
    expect(text).toContain("\"HKS 3; gelb\"");
    expect(second.length).toBeGreaterThan(head.length - 1);
  });

  it("writes swatches that Illustrator and danvas read back: process as CMYK, spot as spot", async () => {
    const rows = [
      row({ brand: { name: "Terracotta", role: "primary", deltaE: 0 } }),
      row({ hex: "#e6cc00", print: "spot", spotName: "HKS 3", cmyk: [0, 0.1, 1, 0] }),
      row(), // the same colour twice gets a unique name
      row(),
    ];
    const bytes = new Uint8Array(await colorListAse(rows, "Etikett").arrayBuffer());
    const read = parseAse(bytes);
    expect(read.map((e) => e.name)).toEqual(["Terracotta #C07F69", "HKS 3", "#C07F69 C20 M55 Y55 K5", "#C07F69 C20 M55 Y55 K5 2"]);
    read.forEach((e, i) => e.cmyk!.forEach((v, k) => expect(v).toBeCloseTo(rows[i].cmyk[k], 6)));
    // The swatch type (last two bytes of each colour block): 1 spot, 2 process.
    const v = new DataView(bytes.buffer);
    const types: number[] = [];
    for (let p = 12; p + 6 <= bytes.length; ) {
      const type = v.getUint16(p), len = v.getUint32(p + 2);
      if (type === 0x0001) types.push(v.getUint16(p + 6 + len - 2));
      p += 6 + len;
    }
    expect(types).toEqual([2, 1, 2, 2]);
    expect(v.getUint32(8)).toBe(6); // group start, four swatches, group end
  });
});
