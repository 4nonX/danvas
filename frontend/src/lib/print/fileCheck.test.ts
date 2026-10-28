import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { checkPrintFile, pdfNameText, psStrings, type FileExpectation } from "./fileCheck";

const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const latin1Of = (b: Uint8Array) => String.fromCharCode(...b);

/** A minimal PDF: the content stream (Flate when `flate`), the page boxes
 *  and whatever the catalog and resources are given. */
function pdf(o: { content: string; flate?: boolean; version?: string; boxes?: boolean; intent?: boolean; pdfx?: boolean; colorSpace?: string; image?: string }): Uint8Array {
  const body = o.flate ? Buffer.from(deflateSync(Buffer.from(o.content, "latin1"))).toString("latin1") : o.content;
  const xmp = "<x:xmpmeta><pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion></x:xmpmeta>";
  const parts = [
    `%PDF-${o.version ?? "1.6"}`,
    `1 0 obj << /Type /Catalog /Pages 2 0 R${o.intent ? " /OutputIntents [<< /S /GTS_PDFX >>]" : ""}${o.pdfx ? " /Metadata 5 0 R" : ""} >> endobj`,
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    `3 0 obj << /Type /Page /MediaBox [0 0 100 100]${o.boxes ? " /TrimBox [8 8 92 92] /BleedBox [0 0 100 100]" : ""} /Resources << ${o.colorSpace ?? ""} >> /Contents 4 0 R >> endobj`,
    `4 0 obj << /Length ${body.length}${o.flate ? " /Filter /FlateDecode" : ""} >>\nstream\n${body}\nendstream endobj`,
    o.pdfx ? `5 0 obj << /Type /Metadata /Subtype /XML /Length ${xmp.length} >>\nstream\n${xmp}\nendstream endobj` : "",
    o.image ? `6 0 obj << /Subtype /Image /ColorSpace /${o.image} /Length 0 >>\nstream\n\nendstream endobj` : "",
    `trailer << /Root 1 0 R${o.pdfx ? " /Info << /GTS_PDFXVersion (PDF/X-4) >>" : ""} >>`,
    "%%EOF",
  ];
  return enc(parts.join("\n"));
}

const want = (e: Partial<FileExpectation>): FileExpectation => ({ kind: "pdf", cmyk: true, pdfx: true, bleed: true, spots: [], ...e });
const codes = (f: { level: string; code: string }[]) => f.map((x) => `${x.level}:${x.code}`);

describe("checkPrintFile (PDF)", () => {
  it("passes a CMYK PDF/X-4 with boxes, intent and its spot colour", async () => {
    const file = pdf({ content: "0 0 0 1 k 0 0 10 10 re f /CS0 cs 1 scn", flate: true, boxes: true, intent: true, pdfx: true, colorSpace: "/ColorSpace << /CS0 [/Separation /Pr#C3#A4gung#20#28Stanze#29 /DeviceCMYK 7 0 R] >>" });
    const f = await checkPrintFile(file, want({ spots: ["Prägung (Stanze)"] }));
    expect(codes(f)).toEqual(["ok:cmyk_only", "ok:output_intent", "ok:pdfx", "ok:boxes", "ok:spot"]);
  });

  it("finds RGB operators inside a compressed stream and RGB images", async () => {
    expect(codes(await checkPrintFile(pdf({ content: "0.2 0.4 0.6 rg 0 0 10 10 re f", flate: true, boxes: true, intent: true, pdfx: true }), want({})))).toContain("error:rgb_in_cmyk");
    expect(codes(await checkPrintFile(pdf({ content: "0 0 0 1 k", boxes: true, intent: true, pdfx: true, image: "DeviceRGB" }), want({})))).toContain("error:rgb_in_cmyk");
  });

  it("finds RGB colour spaces however they are written", async () => {
    const base = { content: "0 0 0 1 k", boxes: true, intent: true, pdfx: true };
    // Named in the page resources, indirectly as CalRGB.
    expect(codes(await checkPrintFile(pdf({ ...base, colorSpace: "/ColorSpace << /CS1 [/CalRGB << /WhitePoint [0.95 1 1.09] >>] >>" }), want({})))).toContain("error:rgb_in_cmyk");
    // Declared only inside a compressed object stream.
    const objStm = Buffer.from(deflateSync(Buffer.from("7 0 << /ColorSpace /DeviceRGB /Subtype /Image >>", "latin1"))).toString("latin1");
    const hidden = enc(latin1Of(pdf(base)).replace("trailer", `9 0 obj << /Type /ObjStm /N 1 /First 4 /Length ${objStm.length} /Filter /FlateDecode >>\nstream\n${objStm}\nendstream endobj\ntrailer`));
    expect(codes(await checkPrintFile(hidden, want({})))).toContain("error:rgb_in_cmyk");
    // A three-channel ICC profile (an RGB profile) used as a colour space.
    const icc = enc(latin1Of(pdf(base)).replace("trailer", "8 0 obj << /N 3 /Length 4 >>\nstream\nICC!\nendstream endobj\ntrailer"));
    expect(codes(await checkPrintFile(icc, want({})))).toContain("error:rgb_in_cmyk");
  });

  it("does not take a CMYK profile or an object stream's count for RGB", async () => {
    const base = { content: "0 0 0 1 k", boxes: true, intent: true, pdfx: true };
    const cmykIcc = enc(latin1Of(pdf(base)).replace("trailer", "8 0 obj << /N 4 /Length 4 >>\nstream\nICC!\nendstream endobj\ntrailer"));
    expect(codes(await checkPrintFile(cmykIcc, want({})))).toContain("ok:cmyk_only");
    const objStm = Buffer.from(deflateSync(Buffer.from("7 0 << /ColorSpace /DeviceCMYK >>", "latin1"))).toString("latin1");
    const counted = enc(latin1Of(pdf(base)).replace("trailer", `9 0 obj << /Type /ObjStm /N 3 /First 4 /Length ${objStm.length} /Filter /FlateDecode >>\nstream\n${objStm}\nendstream endobj\ntrailer`));
    expect(codes(await checkPrintFile(counted, want({})))).toContain("ok:cmyk_only");
  });

  it("reports what is missing", async () => {
    const f = await checkPrintFile(pdf({ content: "0 0 0 1 k", version: "1.4", colorSpace: "/ColorSpace << /CS0 [/Separation /Lack /DeviceCMYK 7 0 R] >>" }), want({ spots: ["Stanze"] }));
    expect(codes(f)).toEqual(["ok:cmyk_only", "warning:no_output_intent", "error:pdfx_missing", "error:boxes_missing", "error:spot_missing", "warning:spot_unexpected"]);
    expect(f.at(-1)?.params).toEqual({ names: "Lack" });
  });

  it("does not ask an RGB file for what only print files carry", async () => {
    expect(await checkPrintFile(pdf({ content: "0.2 0.4 0.6 rg" }), want({ cmyk: false, pdfx: false, bleed: false }))).toEqual([]);
  });
});

describe("checkPrintFile (EPS)", () => {
  const eps = (lines: string[]) => enc(["%!PS-Adobe-3.0 EPSF-3.0", ...lines, "%%EOF"].join("\n"));

  it("passes a CMYK EPS with its bounding box and custom colour", async () => {
    const file = eps(["%%BoundingBox: 0 0 100 100", "%%HiResBoundingBox: 0 0 100.5 100.5", "%%DocumentProcessColors: Cyan Magenta Yellow Black", "%%DocumentCustomColors: (Pr\\303\\244gung \\(Stanze\\))", "/rg { setrgbcolor } bind def", "0 0 0 1 setcmykcolor"]);
    expect(codes(await checkPrintFile(file, want({ kind: "eps", spots: ["Prägung (Stanze)"] })))).toEqual(["ok:eps_bbox", "ok:cmyk_only", "ok:spot"]);
  });

  it("finds RGB use and missing headers", async () => {
    expect(codes(await checkPrintFile(eps(["0.2 0.4 0.6 rg"]), want({ kind: "eps" })))).toEqual(["warning:eps_no_bbox", "error:rgb_in_cmyk"]);
    expect(codes(await checkPrintFile(eps(["%%HiResBoundingBox: 0 0 1 1"]), want({ kind: "eps" })))).toEqual(["ok:eps_bbox", "warning:eps_no_process"]);
  });
});

describe("name decoding", () => {
  it("reads PDF names and PostScript strings as UTF-8", () => {
    expect(pdfNameText("Pr#C3#A4gung#20#28Stanze#29")).toBe("Prägung (Stanze)");
    expect(psStrings("(Pr\\303\\244gung \\(Stanze\\)) (Lack)")).toEqual(["Prägung (Stanze)", "Lack"]);
  });
});
