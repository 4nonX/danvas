import { describe, expect, it } from "vitest";
import { readBarcodes } from "zxing-wasm/reader";
import { encode, layout, traceMatrix, RULES, type BarcodeLayout, type Pattern, type Point, type Symbology } from "../index";

function ok(p: ReturnType<typeof encode>): Pattern {
  if (!p.ok) throw new Error(`${p.code}: ${p.detail}`);
  return p;
}

/** Paints the layout's outlines black on white under the even-odd rule,
 *  sampling each pixel at its centre (the tests choose a dpi that puts
 *  every edge on a whole pixel, so nothing is partly covered). */
function raster(l: BarcodeLayout, margin = 8) {
  const w = Math.ceil(l.width) + 2 * margin;
  const h = Math.ceil(l.height) + 2 * margin;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) {
    const sy = y + 0.5 - margin;
    // Crossings of the scanline with every vertical edge.
    const xs: number[] = [];
    for (const c of l.contours) {
      for (let i = 0; i < c.length; i++) {
        const a = c[i], b = c[(i + 1) % c.length];
        if ((a.y <= sy) !== (b.y <= sy)) xs.push(a.x + ((sy - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.ceil(xs[k] - 0.5 + margin); x < xs[k + 1] - 0.5 + margin; x++) {
        const i = (y * w + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
  }
  return { data, width: w, height: h, colorSpace: "srgb" as const };
}

/** Left, top, width and height of a contour. */
function box(c: Point[]) {
  const xs = c.map((p) => p.x), ys = c.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Area of the filled region: the traced outlines run with the dark side on
 *  one hand, so holes wind the other way and the signed areas add up. */
const area = (cs: Point[][]) => Math.abs(cs.reduce((sum, c) => sum + c.reduce((a, p, i) => { const q = c[(i + 1) % c.length]; return a + (p.x * q.y - q.x * p.y) / 2; }, 0), 0));

/** A dpi at which X is exactly `k` px. */
const dpiFor = (moduleMm: number, k: number) => (k * 25.4) / moduleMm;

async function decode(symbology: Symbology, value: string, k: number, rectangular = false) {
  const p = ok(encode(symbology, value, { rectangular }));
  const moduleMm = RULES[symbology].defaultModuleMm;
  const l = layout(p, { moduleMm, barHeightMm: 8, quietZones: true, text: false }, dpiFor(moduleMm, k));
  const found = await readBarcodes(raster(l), { tryHarder: true, formats: [] });
  return { p, l, found };
}

describe("round trip through a decoder", () => {
  const cases: [Symbology, string, string, string][] = [
    // symbology, input, decoded text, zxing format
    ["ean13", "400638133393", "4006381333931", "EAN13"],
    ["ean13", "4006381333931", "4006381333931", "EAN13"],
    ["ean8", "9638507", "96385074", "EAN8"],
    // A UPC-A is an EAN-13 with a leading zero; decoders may report it either way.
    ["upca", "03600029145", "0036000291452", "EAN13"],
    ["code128", "Charge A-1234", "Charge A-1234", "Code128"],
    ["code128", "Grüße 50 ml", "Grüße 50 ml", "Code128"],
    ["gs1-128", "(01)04012345123456(10)ABC123", "(01)04012345123456(10)ABC123", "Code128"],
    ["code39", "LOT-2026/42", "LOT-2026/42", "Code39"],
    ["pzn", "0471114", "-04711146", "PZN"],
    ["pzn", "PZN - 04711146", "-04711146", "PZN"],
    ["datamatrix", "Charge 123 / verw. bis 12.2027", "Charge 123 / verw. bis 12.2027", "DataMatrix"],
    ["datamatrix", "Grüße", "Grüße", "DataMatrix"],
    ["datamatrix", "Preis 3,50 € ^ Rabatt", "Preis 3,50 € ^ Rabatt", "DataMatrix"],
    ["gs1datamatrix", "(01)04150123456782(21)12345(10)ABC(17)271231", "(01)04150123456782(21)12345(10)ABC(17)271231", "DataMatrix"],
  ];
  for (const [symbology, input, text, format] of cases) {
    for (const k of [2, 3, 4]) {
      it(`${symbology} ${JSON.stringify(input)} at ${k} px per module`, async () => {
        const { found } = await decode(symbology, input, k);
        expect(found.map((f) => [f.format, f.text])).toEqual([[format, text]]);
        if (RULES[symbology].gs1) expect(found[0].symbologyIdentifier).toMatch(/^\](C1|d2)$/);
      });
    }
  }

  it("decodes rectangular Data Matrix", async () => {
    const { p, found } = await decode("datamatrix", "Charge 0815", 4, true);
    expect(p.kind === "matrix" && p.cols > p.rows).toBe(true);
    expect(found.map((f) => f.text)).toEqual(["Charge 0815"]);
  });
});

describe("geometry", () => {
  it("places every bar at whole modules inside the quiet zones", () => {
    const p = ok(encode("ean13", "400638133393"));
    if (p.kind !== "linear") throw new Error("linear expected");
    const X = 3;
    const l = layout(p, { moduleMm: 0.33, barHeightMm: 10, quietZones: true, text: false }, dpiFor(0.33, X));
    expect(p.modules).toBe(95);
    expect(l.width).toBeCloseTo((11 + 95 + 7) * X, 9);
    expect(l.contours.length).toBe(p.bars.length);
    for (const r of l.contours.map(box)) {
      expect(r.x / X - Math.round(r.x / X)).toBeCloseTo(0, 9);
      expect(r.w / X - Math.round(r.w / X)).toBeCloseTo(0, 9);
      expect(r.x).toBeGreaterThanOrEqual(11 * X - 1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual((11 + 95) * X + 1e-9);
    }
    // No two bars touch or overlap.
    const sorted = l.contours.map(box).sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].x).toBeGreaterThan(sorted[i - 1].x + sorted[i - 1].w - 1e-9);
  });

  it("leaves the quiet zones out on request", () => {
    const p = ok(encode("code128", "ABC"));
    const l = layout(p, { moduleMm: 0.25, barHeightMm: 10, quietZones: false, text: false }, dpiFor(0.25, 2));
    const bars = l.contours.map(box);
    expect(Math.min(...bars.map((r) => r.x))).toBe(0);
    expect(l.width).toBeCloseTo(Math.max(...bars.map((r) => r.x + r.w)), 9);
  });

  it("extends the EAN guard bars below the others when digits are shown", () => {
    const p = ok(encode("ean13", "400638133393"));
    const l = layout(p, { moduleMm: 0.33, barHeightMm: 10, quietZones: true, text: true }, 300);
    const bars = l.contours.map(box);
    const heights = new Set(bars.map((r) => Math.round(r.h * 1000)));
    expect(heights.size).toBe(2);
    expect(l.texts.map((t) => t.text).join("")).toBe("4006381333931");
    // Guards: 2 at the start, 2 in the middle, 2 at the end.
    const max = Math.max(...bars.map((r) => r.h));
    expect(bars.filter((r) => r.h === max).length).toBe(6);
  });

  it("shows PZN as the pharmacy line", () => {
    const p = ok(encode("pzn", "0471114"));
    const l = layout(p, { moduleMm: 0.25, barHeightMm: 8, quietZones: true, text: true }, 300);
    expect(l.texts.map((t) => t.text)).toEqual(["PZN - 04711146"]);
    expect(p.encoded).toBe("04711146");
  });

  it("rounds X to whole printer dots, bars and spaces included", () => {
    const p = ok(encode("code128", "Charge 4711"));
    // At the printer's own resolution one dot is one px.
    const l = layout(p, { moduleMm: 0.33, barHeightMm: 8, quietZones: true, text: false, printerDpi: 203, barWidthReductionMm: 0.06 }, 203);
    expect(l.dotsPerModule).toBe(3);
    expect(l.moduleMm).toBeCloseTo((3 * 25.4) / 203, 9);
    for (const r of l.contours.map(box)) {
      expect(r.x - Math.round(r.x)).toBeCloseTo(0, 6);
      expect(r.w - Math.round(r.w)).toBeCloseTo(0, 6);
    }
  });

  it("narrows bars for print gain around their centre", () => {
    const p = ok(encode("code39", "ABC"));
    const base = layout(p, { moduleMm: 0.3, barHeightMm: 8, quietZones: true, text: false }, 600);
    const red = layout(p, { moduleMm: 0.3, barHeightMm: 8, quietZones: true, text: false, barWidthReductionMm: 0.05 }, 600);
    const d = (0.05 / 25.4) * 600;
    const before = base.contours.map(box);
    red.contours.map(box).forEach((r, i) => {
      const b = before[i];
      expect(r.w).toBeCloseTo(b.w - d, 9);
      expect(r.x + r.w / 2).toBeCloseTo(b.x + b.w / 2, 9);
    });
    expect(red.width).toBeCloseTo(base.width, 9);
  });

  it("outlines a Data Matrix without shared edges", () => {
    const p = ok(encode("datamatrix", "Hello"));
    if (p.kind !== "matrix") throw new Error("matrix expected");
    const l = layout(p, { moduleMm: 0.5, barHeightMm: 0, quietZones: true, text: false }, dpiFor(0.5, 1));
    const dark = p.cells.filter(Boolean).length;
    expect(area(l.contours)).toBeCloseTo(dark, 9);
    expect(l.contours.length).toBeLessThan(dark);
    expect(l.width).toBeCloseTo(p.cols + 2, 9);
    // Every module edge appears at most once across all outlines.
    const seen = new Set<string>();
    for (const c of l.contours) {
      for (let i = 0; i < c.length; i++) {
        const a = c[i], b = c[(i + 1) % c.length];
        const steps = Math.round(Math.abs(b.x - a.x) + Math.abs(b.y - a.y));
        for (let s = 0; s < steps; s++) {
          const x0 = a.x + Math.sign(b.x - a.x) * s, y0 = a.y + Math.sign(b.y - a.y) * s;
          const x1 = x0 + Math.sign(b.x - a.x), y1 = y0 + Math.sign(b.y - a.y);
          const k = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)].map((v) => Math.round(v * 1e6)).join(",");
          expect(seen.has(k)).toBe(false);
          seen.add(k);
        }
      }
    }
  });

  it("traces holes and diagonal neighbours", () => {
    // A ring (hole in the middle) and two cells touching only at a corner.
    const ring = [true, true, true, true, false, true, true, true, true];
    const loops = traceMatrix(ring, 3, 3);
    expect(loops.length).toBe(2);
    expect(area(loops)).toBe(8);
    const diag = traceMatrix([true, false, false, true], 2, 2);
    expect(area(diag)).toBe(2);
  });
});

describe("validation", () => {
  const code = (s: Symbology, v: string) => {
    const r = encode(s, v);
    return r.ok ? "ok" : r.code;
  };
  it("names the reason", () => {
    expect(code("ean13", "4006381333932")).toBe("check_digit");
    expect(code("ean13", "40063813339")).toBe("length");
    expect(code("ean13", "40063813339A")).toBe("characters");
    expect(code("pzn", "04711145")).toBe("check_digit");
    expect(code("pzn", "123")).toBe("length");
    expect(code("gs1-128", "(17)271331")).toBe("gs1");
    expect(code("gs1-128", "(01)04012345123457")).toBe("check_digit");
    expect(code("code128", "Preis 3 €")).toBe("characters");
    expect(code("code39", "abc")).toBe("characters");
    expect(code("code128", "  ")).toBe("empty");
  });
  it("computes check digits when they are left out", () => {
    const e = encode("ean13", "400638133393");
    expect(e.ok && e.encoded).toBe("4006381333931");
    const z = encode("pzn", "PZN-0471114");
    expect(z.ok && z.encoded).toBe("04711146");
  });
});
