// The image PDF writer (runs in Node, which has Blob streams).
import { describe, expect, it } from "vitest";
import { printSheet } from "./sheet";

describe("image PDF", () => {
  it("writes one picture per page with the sheet's boxes", async () => {
    const { exportImagePdf } = await import("../vectorPdf");
    const sheet = printSheet({ width: 100, height: 50, bleed: 5 }, 96, { bleed: true, marks: false });
    const rgba = new Uint8ClampedArray(4 * 110 * 60).fill(255);
    const blob = await exportImagePdf([{ rgba, width: 110, height: 60, sheet }], 96, { title: "t" });
    const text = new TextDecoder("latin1").decode(new Uint8Array(await blob.arrayBuffer()));
    expect(text.startsWith("%PDF-1.7")).toBe(true);
    expect(text).toContain("/ColorSpace /DeviceRGB");
    expect(text).toMatch(/\/TrimBox \[3\.75 3\.75 78\.75 41\.25\]/);
    // RGB without a profile: no output intent and no PDF/X marking.
    expect(text).not.toContain("/OutputIntents");
    expect(text).not.toContain("GTS_PDFXVersion");
  });
});
