import { describe, expect, it } from "vitest";
import type { ExportProfile } from "@hc/sdk";
import { defaultExportSettings, defaultProfile, describeSettings, freeName, normalizeSettings, sameSettings } from "./exportProfiles";
import { describePrintSettings, normalizePrintSettings, samePrintSettings } from "./printPresets";
import { oversizedPages, paperFor, printHtml } from "./printDocument";

const profile = (p: Partial<ExportProfile>): ExportProfile => ({
  id: "x", kind: "export", scope: "personal", workspaceId: null, name: "x", description: "", settings: { v: 1 }, isDefault: false,
  updatedByName: "", createdAt: "", updatedAt: "", ...p,
});

describe("export profile settings", () => {
  it("fills in what an older profile lacks and drops what no version knows", () => {
    const s = normalizeSettings({ v: 1, format: "pdf", pdfMode: "vector", someFutureOption: true, print: { source: "fixed", override: { bleed: true, bleedMm: 1.5 } } });
    expect(s.format).toBe("pdf");
    expect(s.color).toBe("cmyk");
    expect(s.print).toEqual({ source: "fixed", override: expect.objectContaining({ bleed: true, bleedMm: 1.5, marks: false, style: "solid" }) });
    expect("someFutureOption" in s).toBe(false);
  });

  it("repairs invalid values instead of failing", () => {
    const s = normalizeSettings({ v: 1, format: "bmp", scale: -4, quality: 900, dieLine: { on: true, name: 42 } });
    expect(s.format).toBe("png");
    expect(s.scale).toBe(0.1);
    expect(s.quality).toBe(100);
    expect(s.dieLine.on).toBe(true);
    expect(typeof s.dieLine.name).toBe("string");
  });

  it("tells a changed menu from an unchanged one", () => {
    const a = defaultExportSettings();
    expect(sameSettings(a, normalizeSettings(JSON.parse(JSON.stringify(a))))).toBe(true);
    expect(sameSettings(a, { ...a, scale: 2 })).toBe(false);
  });

  it("describes a print-shop profile in one line", () => {
    const s = normalizeSettings({ v: 1, format: "pdf", pdfMode: "vector", color: "cmyk", iccProfileId: "p1", pdfx: true,
      print: { source: "fixed", override: { bleed: true, bleedMm: 1.5, marks: false } }, dieLine: { on: true, name: "Stanze", radiusMm: 2 } });
    const line = describeSettings(s, (id) => (id === "p1" ? "PSO Coated v3" : undefined));
    expect(line).toContain("PSO Coated v3");
    expect(line).toContain("PDF/X-4");
    expect(line).toContain("Stanze");
  });

  it("starts from the personal default, else the workspace's", () => {
    const ws = profile({ id: "w", scope: "workspace", isDefault: true });
    const mine = profile({ id: "m", isDefault: true });
    expect(defaultProfile([ws, mine])?.id).toBe("m");
    expect(defaultProfile([ws, profile({ id: "n" })])?.id).toBe("w");
    expect(defaultProfile([profile({ id: "n" })])).toBeNull();
  });

  it("finds a free name, ignoring case", () => {
    expect(freeName("Druckerei", ["druckerei", "Druckerei (2)"])).toBe("Druckerei (3)");
    expect(freeName(" Neu ", [])).toBe("Neu");
  });
});

describe("print presets", () => {
  it("normalizes and compares like export profiles", () => {
    const s = normalizePrintSettings({ v: 1, size: "fit", dpi: 999, pages: "current" });
    expect(s).toEqual(expect.objectContaining({ size: "fit", dpi: 200, pages: "current" }));
    expect(samePrintSettings(s, normalizePrintSettings(s))).toBe(true);
    expect(describePrintSettings(normalizePrintSettings({ v: 1, dpi: 300 }))).toContain("300 dpi");
  });

  it("hands the driver each page's own paper size, or a standard sheet turned to fit", () => {
    const pages = [{ url: "blob:a", widthMm: 93, heightMm: 43 }, { url: "blob:b", widthMm: 210, heightMm: 297 }, { url: "blob:c", widthMm: 93, heightMm: 43 }];
    const own = printHtml(pages, { size: "actual", paper: "design", title: "Etiketten <x>" });
    expect(own).toContain("@page s0 { size: 93.00mm 43.00mm; margin: 0; }");
    expect(own).toContain("@page s1 { size: 210.00mm 297.00mm; margin: 0; }");
    expect(own.match(/page: s0/g)).toHaveLength(2);
    expect(own).toContain("<title>Etiketten x</title>");
    // A4: the landscape label goes on landscape A4, the portrait page on portrait.
    expect(paperFor(pages[0], "a4")).toEqual({ widthMm: 297, heightMm: 210 });
    expect(paperFor(pages[1], "a4")).toEqual({ widthMm: 210, heightMm: 297 });
    const a4 = printHtml(pages, { size: "fit", paper: "a4", title: "x" });
    expect(a4).toContain("@page s0 { size: 297.00mm 210.00mm; margin: 0; }");
    expect(a4).toContain("object-fit: contain");
  });

  it("warns about pages larger than the paper at actual size only", () => {
    const pages = [{ widthMm: 93, heightMm: 43 }, { widthMm: 300, heightMm: 420 }];
    expect(oversizedPages(pages, "a4", "actual")).toBe(1);
    expect(oversizedPages(pages, "a3", "actual")).toBe(1);
    expect(oversizedPages(pages, "a4", "fit")).toBe(0);
    expect(oversizedPages(pages, "design", "actual")).toBe(0);
  });
});
