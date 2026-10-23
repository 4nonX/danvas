// Colour libraries: ASE, ACB and CSV files read into entries, and the nearest
// entry to a colour by CIEDE2000. The files are built here byte by byte after
// the published formats; no real colour book is involved.
import { describe, expect, it } from "vitest";
import { ColorLibraryError, completeLab, nearestEntry, parseAcb, parseAse, parseColorCsv, parseColorLibrary } from "./colorLibrary";

function be(...parts: (number | [number, "u16" | "u32" | "f32"] | string)[]): Uint8Array {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === "number") out.push(p);
    else if (typeof p === "string") for (const ch of p) out.push(ch.charCodeAt(0));
    else {
      const [n, t] = p;
      const b = new DataView(new ArrayBuffer(4));
      if (t === "u16") { b.setUint16(0, n); out.push(b.getUint8(0), b.getUint8(1)); }
      else if (t === "u32") { b.setUint32(0, n); for (let i = 0; i < 4; i++) out.push(b.getUint8(i)); }
      else { b.setFloat32(0, n); for (let i = 0; i < 4; i++) out.push(b.getUint8(i)); }
    }
  }
  return new Uint8Array(out);
}
const utf16 = (s: string) => [...s, "\0"].flatMap((ch) => [[ch.charCodeAt(0), "u16"] as [number, "u16"]]);

function aseColor(name: string, model: string, values: number[]): Uint8Array {
  const body = be([name.length + 1, "u16"], ...utf16(name), model.padEnd(4, " "), ...values.map((n) => [n, "f32"] as [number, "f32"]), [2, "u16"]);
  return be([1, "u16"], [body.length, "u32"], ...body);
}

describe("colour library files", () => {
  it("reads an ASE file with Lab, CMYK and RGB colours, groups flattened", () => {
    const group = be([0xc001, "u16"], [2 + 2 * 6, "u32"], [6, "u16"], ...utf16("House"));
    const colours = [aseColor("Grün 7", "LAB", [0.38, -32, 14]), aseColor("Blau", "CMYK", [0.6, 0.2, 0, 0]), aseColor("Rot", "RGB", [1, 0, 0])];
    const end = be([0xc002, "u16"], [0, "u32"]);
    const file = be("ASEF", [1, "u16"], [0, "u16"], [5, "u32"]);
    const all = new Uint8Array([...file, ...group, ...colours.flatMap((c) => [...c]), ...end]);
    const e = parseAse(all);
    expect(e.map((x) => x.name)).toEqual(["Grün 7", "Blau", "Rot"]);
    expect(e[0].lab![0]).toBeCloseTo(38, 3);
    expect(e[0].lab![1]).toBeCloseTo(-32, 3);
    expect(e[1].cmyk![0]).toBeCloseTo(0.6, 5);
    expect(e[2].rgb).toEqual([1, 0, 0]);
  });

  it("reads an ACB colour book in Lab, with its prefix and postfix", () => {
    const ustr = (s: string) => be([s.length, "u32"], ...[...s].map((ch) => [ch.charCodeAt(0), "u16"] as [number, "u16"]));
    const head = new Uint8Array([
      ...be("8BCB", [1, "u16"], [3000, "u16"]),
      ...ustr("$$$/colorbook/X/Title=Test Book"), ...ustr("$$$/colorbook/X/Prefix=TEST "), ...ustr(" C"), ...ustr("desc"),
      ...be([2, "u16"], [9, "u16"], [0, "u16"], [7, "u16"]),
    ]);
    const colour = (name: string, l: number, a: number, b: number) => new Uint8Array([...ustr(name), ...be("ABCDEF"), Math.round(l * 2.55), a + 128, b + 128]);
    const e = parseAcb(new Uint8Array([...head, ...colour("100", 50, 20, -30), ...colour("200", 90, 0, 0)]));
    expect(e.map((x) => x.name)).toEqual(["TEST 100 C", "TEST 200 C"]);
    expect(e[0].lab![0]).toBeCloseTo(50, 0);
    expect(e[0].lab!.slice(1)).toEqual([20, -30]);
  });

  it("reads CSV lists in Lab, CMYK percent or hex, skipping a header", () => {
    const e = parseColorCsv("Name;L;a;b\nHausgrün;38,5;-32;14\nBlau;60;20;0;0\nRot,#ff0000\n");
    expect(e).toEqual([
      { name: "Hausgrün", lab: [38.5, -32, 14] },
      { name: "Blau", cmyk: [0.6, 0.2, 0, 0] },
      { name: "Rot", rgb: [1, 0, 0] },
    ]);
  });

  it("says when a file is no library", () => {
    expect(() => parseColorLibrary("x.ase", new Uint8Array([1, 2, 3]))).toThrow(ColorLibraryError);
    expect(() => parseColorLibrary("x.pdf", new Uint8Array([1]))).toThrow(ColorLibraryError);
    expect(() => parseColorLibrary("x.csv", new TextEncoder().encode("only;a;header"))).toThrow(ColorLibraryError);
  });

  it("finds the nearest entry by CIEDE2000, skipping entries without Lab", () => {
    const entries = [{ name: "A", lab: [50, 0, 0] as [number, number, number] }, { name: "B", lab: [52, 3, 1] as [number, number, number] }, { name: "C", cmyk: [0, 0, 0, 1] as [number, number, number, number] }];
    const m = nearestEntry([52.5, 3, 1], entries)!;
    expect(m.entry.name).toBe("B");
    expect(m.deltaE).toBeLessThan(1);
    expect(nearestEntry([1, 1, 1], [{ name: "C", cmyk: [0, 0, 0, 1] }])).toBeNull();
  });
});

describe("completeLab", () => {
  it("fills Lab from RGB or CMYK and keeps given Lab", () => {
    const e = completeLab(
      [{ name: "A", lab: [1, 2, 3] }, { name: "B", rgb: [1, 0, 0] }, { name: "C", cmyk: [0, 0, 0, 1] }],
      { rgb: () => [54.291, 80.8, 69.9], cmyk: () => [20, 0, 0] },
    );
    expect(e.map((x) => x.lab)).toEqual([[1, 2, 3], [54.29, 80.8, 69.9], [20, 0, 0]]);
  });
});
