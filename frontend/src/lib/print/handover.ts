// The print shop package: the print files of a download together with what
// a print shop needs to take them over without asking back. A soft proof of
// every page, the colour list, and a report of the settings, the check
// results and the approval, with the size and SHA-256 checksum of every
// file in the package so the files can be shown to be the ones approved.

import type { ZipEntry } from "@/lib/zip";

export interface HandoverSection {
  heading: string;
  /** One entry per line; a pair is "label: value". */
  lines: (string | [string, string])[];
}

export interface HandoverReport {
  title: string;
  /** Under the title (design, date). */
  subtitle: string;
  sections: HandoverSection[];
  /** The other files of the package (the report lists them, it cannot
   *  list its own checksum). */
  files: { name: string; data: Uint8Array }[];
  labels: { files: string; file: string; size: string; checksum: string; note: string };
}

/** Lowercase hex SHA-256 of the bytes. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** "1.2 MB", "340 kB", "512 B" (decimal units, as file managers show). */
export function sizeText(n: number, locale?: string): string {
  const f = (v: number) => v.toLocaleString(locale, { maximumFractionDigits: 1 });
  if (n >= 1e6) return `${f(n / 1e6)} MB`;
  if (n >= 1e3) return `${f(n / 1e3)} kB`;
  return `${n} B`;
}

// The built-in Helvetica (WinAnsi): other characters are replaced, as in the
// colour list; the caller passes English text for scripts it cannot show.
const latin = (s: string) =>
  s.replace(/[‘’]/g, "'").replace(/[“”„]/g, "\"").replace(/[–—]/g, "-").replace(/[^\n\x20-\x7e\xa0-\xff]/g, "?");

/** The report as an A4 PDF. */
export async function handoverReportPdf(r: HandoverReport, locale?: string): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const W = 210, H = 297, M = 16;
  let y = M + 4;
  const room = (h: number) => {
    if (y + h > H - M) { pdf.addPage(); y = M + 4; }
  };
  const text = (s: string, x: number, w: number, size = 9, bold = false): number => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(latin(s), w) as string[];
    const lh = size * 0.42;
    room(lines.length * lh);
    pdf.text(lines, x, y);
    y += lines.length * lh;
    return lines.length;
  };
  text(r.title, M, W - 2 * M, 16, true);
  y += 1;
  text(r.subtitle, M, W - 2 * M, 9);
  y += 4;
  const labelW = 52;
  for (const sec of r.sections) {
    room(14);
    text(sec.heading, M, W - 2 * M, 11, true);
    y += 1;
    for (const line of sec.lines) {
      if (typeof line === "string") { text(line, M, W - 2 * M, 9); y += 0.6; continue; }
      const [k, v] = line;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      const vs = pdf.splitTextToSize(latin(v), W - 2 * M - labelW) as string[];
      room(vs.length * 3.8);
      pdf.setTextColor(110);
      pdf.text(pdf.splitTextToSize(latin(k), labelW - 3) as string[], M, y);
      pdf.setTextColor(0);
      pdf.text(vs, M + labelW, y);
      y += Math.max(vs.length, 1) * 3.8 + 0.6;
    }
    y += 4;
  }
  room(16);
  text(r.labels.files, M, W - 2 * M, 11, true);
  y += 1;
  for (const f of r.files) {
    const sum = await sha256Hex(f.data);
    room(9);
    text(f.name, M, W - 2 * M, 8.5, true);
    pdf.setFont("courier", "normal");
    pdf.setFontSize(7.5);
    pdf.text(`${r.labels.size}: ${sizeText(f.data.length, locale)}   ${r.labels.checksum}: ${sum}`, M, y);
    y += 4.6;
  }
  y += 3;
  text(r.labels.note, M, W - 2 * M, 7.5);
  return pdf.output("blob");
}

/** A soft proof as a PNG (RGBA pixels, sRGB). */
export async function proofPng(rgba: Uint8ClampedArray, width: number, height: number): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
  if (!blob) throw new Error("could not encode the proof");
  return blob;
}

/** Names safe in a zip on every system, unique among `taken` (lower case). */
export function packageName(name: string, taken: Set<string>): string {
  const clean = name.replace(/[\\:*?"<>|]+/g, "-").trim() || "file";
  let out = clean;
  const dot = clean.lastIndexOf(".");
  for (let n = 2; taken.has(out.toLowerCase()); n++) out = dot > 0 ? `${clean.slice(0, dot)} (${n})${clean.slice(dot)}` : `${clean} (${n})`;
  taken.add(out.toLowerCase());
  return out;
}

export async function entriesOf(files: { name: string; blob: Blob }[]): Promise<ZipEntry[]> {
  return Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) })));
}
