// The structure of an exported print file, read back from its bytes: what a
// print shop's preflight looks at besides the inks. Output intent and
// PDF/X-4 marking, no RGB left in a CMYK file, trim and bleed boxes, the spot
// colours asked for; for EPS its bounding box, process and custom colours.
// The same checks the repository's export check (tests/export) runs, on the
// file that is about to go out.

export type FindingLevel = "ok" | "warning" | "error";

export interface FileFinding {
  level: FindingLevel;
  /** Message key suffix (editor.output_<code>). */
  code: string;
  params?: Record<string, string | number>;
}

export interface FileExpectation {
  kind: "pdf" | "eps";
  cmyk: boolean;
  pdfx: boolean;
  bleed: boolean;
  /** Spot colours the file should carry (die line). */
  spots: string[];
}

const latin1 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
};

async function inflate(data: Uint8Array): Promise<string | null> {
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
    return latin1(new Uint8Array(await new Response(stream).arrayBuffer()));
  } catch {
    return null;
  }
}

/** The decoded content of every Flate stream (and the raw text of the
 *  others), for operator checks. */
async function pdfStreams(bytes: Uint8Array, text: string): Promise<{ dict: string; body: string }[]> {
  const out: { dict: string; body: string }[] = [];
  const re = /<<((?:(?!>>\s*stream)[\s\S])*?)>>\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf("endstream", start);
    if (end < 0) break;
    const dict = m[1];
    // The end of line before "endstream" is not part of the data.
    let stop = end;
    if (bytes[stop - 1] === 0x0a) stop--;
    if (bytes[stop - 1] === 0x0d) stop--;
    const raw = bytes.subarray(start, stop);
    const body = /\/FlateDecode/.test(dict) ? await inflate(raw) : latin1(raw);
    out.push({ dict, body: body ?? "" });
    re.lastIndex = end;
  }
  return out;
}

/** A PDF name token's text: #xx escapes are bytes, the bytes UTF-8. */
export function pdfNameText(t: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "#" && /^[0-9a-fA-F]{2}$/.test(t.slice(i + 1, i + 3))) { bytes.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; } else bytes.push(t.charCodeAt(i));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** The PostScript string literals in a line (DSC text), decoded. */
export function psStrings(line: string): string[] {
  return [...line.matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map((x) => {
    const bytes: number[] = [];
    const s = x[1];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "\\") {
        const oct = /^[0-7]{1,3}/.exec(s.slice(i + 1));
        if (oct) { bytes.push(parseInt(oct[0], 8)); i += oct[0].length; } else { bytes.push(s.charCodeAt(i + 1)); i++; }
      } else bytes.push(s.charCodeAt(i));
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  });
}

const RGB_OP = /(^|\s)[\d.]+\s+[\d.]+\s+[\d.]+\s+(rg|RG)(\s|$)/;

export async function checkPrintFile(bytes: Uint8Array, e: FileExpectation): Promise<FileFinding[]> {
  const text = latin1(bytes);
  const out: FileFinding[] = [];
  const spotsFound = new Set<string>();
  if (e.kind === "pdf") {
    const streams = await pdfStreams(bytes, text);
    if (e.cmyk) {
      const rgbOps = streams.some((st) => !/\/Subtype\s*\/(Image|XML)/.test(st.dict) && RGB_OP.test(st.body));
      const rgbImages = /\/ColorSpace\s*\/DeviceRGB/.test(text);
      out.push(rgbOps || rgbImages ? { level: "error", code: "rgb_in_cmyk" } : { level: "ok", code: "cmyk_only" });
      out.push(/\/OutputIntents/.test(text) ? { level: "ok", code: "output_intent" } : { level: "warning", code: "no_output_intent" });
    }
    if (e.pdfx) {
      const marked = /GTS_PDFXVersion\s*\(PDF\/X-4\)/.test(text) && streams.some((st) => st.body.includes("pdfxid:GTS_PDFXVersion>PDF/X-4"));
      const v16 = text.startsWith("%PDF-1.6");
      out.push(marked && v16 ? { level: "ok", code: "pdfx" } : { level: "error", code: "pdfx_missing" });
    }
    const trim = /\/TrimBox\s*\[/.test(text), bleedBox = /\/BleedBox\s*\[/.test(text);
    if (e.bleed) out.push(trim && bleedBox ? { level: "ok", code: "boxes" } : { level: "error", code: "boxes_missing" });
    for (const m of text.matchAll(/\/Separation\s*\/([^\s/[\]<>()]+)/g)) spotsFound.add(pdfNameText(m[1]));
  } else {
    const hires = /%%HiResBoundingBox: [\d.]+ [\d.]+ [\d.]+ [\d.]+/.test(text);
    out.push(hires ? { level: "ok", code: "eps_bbox" } : { level: "warning", code: "eps_no_bbox" });
    if (e.cmyk) {
      const lines = text.split(/\r?\n/);
      const rgbUse = lines.some((l) => /(^|\s)(rg|RG)$/.test(l.trim()) && !l.includes("bind def"));
      const process = text.includes("%%DocumentProcessColors: Cyan Magenta Yellow Black");
      out.push(rgbUse ? { level: "error", code: "rgb_in_cmyk" } : process ? { level: "ok", code: "cmyk_only" } : { level: "warning", code: "eps_no_process" });
    }
    const custom = /%%DocumentCustomColors: (.*)/.exec(text)?.[1];
    if (custom) for (const name of psStrings(custom)) spotsFound.add(name);
  }
  for (const s of e.spots) {
    out.push(spotsFound.has(s) ? { level: "ok", code: "spot", params: { name: s } } : { level: "error", code: "spot_missing", params: { name: s } });
  }
  const others = [...spotsFound].filter((s) => !e.spots.includes(s) && s !== "All");
  if (others.length) out.push({ level: "warning", code: "spot_unexpected", params: { names: others.join(", ") } });
  return out;
}
