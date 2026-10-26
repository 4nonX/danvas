// Colour library formats beyond ASE and ACB: CSV is read strictly (a
// measurement file must not pass as CMYK), CGATS and CxF are read by their
// columns and elements, with Lab from spectra where that is what they give.
import { describe, expect, it } from "vitest";
import { ColorLibraryError, parseColorCsv, readColorLibrary } from "./colorLibrary";
import { spectrumToLab } from "./spectral";

const enc = (s: string) => new TextEncoder().encode(s);
const reason = (f: () => unknown) => {
  try { f(); return "read"; } catch (e) { return e instanceof ColorLibraryError ? `${e.reason}${e.params.line ? `@${e.params.line}` : ""}` : String(e); }
};
const grey = Array(36).fill(0.5);
const greyLab = spectrumToLab(380, 10, grey)!;

describe("CSV", () => {
  it("refuses a line of another layout with its number, instead of reading it as CMYK", () => {
    const spectral = `SAMPLE_NAME\tSPECTRAL_NM_380\nH000_L005_C000\t${Array(36).fill("0.0057").join("\t")}`;
    expect(reason(() => parseColorCsv(spectral))).toBe("bad_line@2");
    expect(reason(() => parseColorCsv("Name;L;a;b\nA;50;0;0\nB;150;0;0"))).toBe("bad_line@3"); // L out of range
    expect(reason(() => parseColorCsv("A;50;0;0\nName;L;a;b"))).toBe("bad_line@2"); // a header only on top
    expect(parseColorCsv("Name;L;a;b\nA;50;0;0;\n")).toEqual([{ name: "A", lab: [50, 0, 0] }]); // trailing separator
  });
});

describe("CGATS", () => {
  const cgats = (format: string, rows: string[]) => `CGATS.17\nORIGINATOR\t"test"\nNUMBER_OF_FIELDS ${format.split(/\s+/).length}\nBEGIN_DATA_FORMAT\n${format}\nEND_DATA_FORMAT\nNUMBER_OF_SETS ${rows.length}\nBEGIN_DATA\n${rows.join("\n")}\nEND_DATA\n`;

  it("reads spectra to Lab, as in a colour atlas's measurement file", () => {
    const fields = ["SAMPLE_NAME", ...Array.from({ length: 36 }, (_, i) => `SPECTRAL_NM_${380 + i * 10}`)].join("\t");
    const read = readColorLibrary("atlas.txt", enc(cgats(fields, [`G50\t${grey.join("\t")}`])));
    expect(read.counts).toEqual({ lab: 0, spectral: 1, cmyk: 0, rgb: 0 });
    expect(read.entries[0].name).toBe("G50");
    read.entries[0].lab!.forEach((v, k) => expect(v).toBeCloseTo(greyLab[k], 6));
  });

  it("reads Lab and CMYK columns, quoted names, and refuses what it cannot use", () => {
    const read = readColorLibrary("book.cgats", enc(cgats("SAMPLE_ID SAMPLE_NAME CMYK_C CMYK_M CMYK_Y CMYK_K LAB_L LAB_A LAB_B", ['1 "Haus Grün" 80 10 95 15 46.2 -38.4 30.1'])));
    expect(read.entries).toEqual([{ name: "Haus Grün", lab: [46.2, -38.4, 30.1], cmyk: [0.8, 0.1, 0.95, 0.15] }]);
    expect(reason(() => readColorLibrary("x.txt", enc(cgats("SAMPLE_ID DENSITY", ["1 0.5"]))))).toBe("not_cgats");
    const short = ["SAMPLE_NAME", ...Array.from({ length: 31 }, (_, i) => `SPECTRAL_NM_${400 + i * 10}`)].join(" ");
    expect(reason(() => readColorLibrary("x.txt", enc(cgats(short, [`A ${Array(31).fill(0.5).join(" ")}`]))))).toBe("spectral_range");
  });
});

describe("CxF", () => {
  const cxf = (objects: string) => `<?xml version="1.0" encoding="UTF-8"?>
<cc:CxF xmlns:cc="http://colorexchangeformat.com/CxF3-core">
  <cc:Resources>
    <cc:ObjectCollection>${objects}</cc:ObjectCollection>
    <cc:ColorSpecificationCollection>
      <cc:ColorSpecification Id="M0"><cc:TristimulusSpec><cc:Illuminant>D50</cc:Illuminant><cc:Observer>2_Degree</cc:Observer></cc:TristimulusSpec>
        <cc:MeasurementSpec><cc:WavelengthRange StartWL="380" Increment="10"/></cc:MeasurementSpec></cc:ColorSpecification>
      <cc:ColorSpecification Id="D65"><cc:TristimulusSpec><cc:Illuminant>D65</cc:Illuminant><cc:Observer>10_Degree</cc:Observer></cc:TristimulusSpec></cc:ColorSpecification>
    </cc:ColorSpecificationCollection>
  </cc:Resources>
</cc:CxF>`;

  it("reads spectra (also an Object tag broken over lines), Lab under D50, CMYK and sRGB, and counts what it leaves out", () => {
    const read = readColorLibrary("atlas.cxf", enc(cxf(`
      <cc:Object ObjectType="Standard" Name="Spectral" Id="s1"><cc:ColorValues>
        <cc:ReflectanceSpectrum ColorSpecification="M0">${grey.join(" ")}</cc:ReflectanceSpectrum></cc:ColorValues></cc:Object>
      <cc:Object
        ObjectType="Standard" Name="Split tag" Id="s2"><cc:ColorValues>
        <cc:ReflectanceSpectrum StartWL="380" ColorSpecification="M0">${grey.join(" ")}</cc:ReflectanceSpectrum></cc:ColorValues></cc:Object>
      <cc:Object Name="Given Lab" Id="l1"><cc:ColorValues><cc:ColorCIELab ColorSpecification="M0"><cc:L>40</cc:L><cc:A>20</cc:A><cc:B>-10</cc:B></cc:ColorCIELab></cc:ColorValues></cc:Object>
      <cc:Object Name="Ink" Id="c1"><cc:ColorValues><cc:ColorCMYK><cc:Cyan>100</cc:Cyan><cc:Magenta>0</cc:Magenta><cc:Yellow>0</cc:Yellow><cc:Black>0</cc:Black></cc:ColorCMYK></cc:ColorValues></cc:Object>
      <cc:Object Name="Screen" Id="r1"><cc:ColorValues><cc:ColorSRGB MaxRange="255"><cc:R>255</cc:R><cc:G>0</cc:G><cc:B>0</cc:B></cc:ColorSRGB></cc:ColorValues></cc:Object>
      <cc:Object Name="Lab under D65" Id="x1"><cc:ColorValues><cc:ColorCIELab ColorSpecification="D65"><cc:L>40</cc:L><cc:A>20</cc:A><cc:B>-10</cc:B></cc:ColorCIELab></cc:ColorValues></cc:Object>
    `)));
    expect(read.entries.map((e) => e.name)).toEqual(["Spectral", "Split tag", "Given Lab", "Ink", "Screen"]);
    expect(read.counts).toEqual({ lab: 1, spectral: 2, cmyk: 1, rgb: 1 });
    expect(read.skipped).toBe(1); // Lab under another illuminant, and no spectrum to work it out from
    read.entries[1].lab!.forEach((v, k) => expect(v).toBeCloseTo(greyLab[k], 6));
    expect(read.entries[2].lab).toEqual([40, 20, -10]);
    expect(read.entries[3].cmyk).toEqual([1, 0, 0, 0]);
    expect(read.entries[4].rgb).toEqual([1, 0, 0]);
  });

  it("refuses what is not CxF", () => {
    expect(reason(() => readColorLibrary("x.cxf", enc("<html><body/></html>")))).toBe("not_cxf");
    expect(reason(() => readColorLibrary("x.cxf", enc("not xml <")))).toBe("not_cxf");
    expect(reason(() => readColorLibrary("x.cxf", enc(cxf("<cc:Object Name=unquoted></cc:Object>"))))).toBe("not_cxf");
    expect(reason(() => readColorLibrary("x.cxf", enc(cxf("<cc:Object Name=\"open\">"))))).toBe("not_cxf");
  });
});
