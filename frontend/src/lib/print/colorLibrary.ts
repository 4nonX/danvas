// Colour libraries a workspace brings itself (a Pantone book from its own
// licence, a house colour list), for the colour list that goes with a print
// export: each colour of a design gets the library's nearest entry and how
// far it is (CIEDE2000). danvas ships no library; the files are read here and
// only the entries are stored.
//
// Read: Adobe Swatch Exchange (.ase), Adobe Color Book (.acb) and CSV
// (name;L;a;b, name;C;M;Y;K in percent, or name;#rrggbb).

import { ciede2000 } from "@hc/color";

export interface ColorLibraryEntry {
  name: string;
  /** CIE L*a*b* (D50), when the file gives it or it could be worked out. */
  lab?: [number, number, number];
  /** CMYK 0..1, when the file gives it. */
  cmyk?: [number, number, number, number];
  /** sRGB 0..1, when the file gives it. */
  rgb?: [number, number, number];
}

export class ColorLibraryError extends Error {}

const MAX_ENTRIES = 20000;

// --- Adobe Swatch Exchange ----------------------------------------------------

/** Read an .ase file: every colour entry, groups flattened. */
export function parseAse(bytes: Uint8Array): ColorLibraryEntry[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(0, 4)) !== "ASEF") throw new ColorLibraryError("not an ASE file");
  const blocks = v.getUint32(8);
  const out: ColorLibraryEntry[] = [];
  let p = 12;
  for (let i = 0; i < blocks && p + 6 <= bytes.length; i++) {
    const type = v.getUint16(p), len = v.getUint32(p + 2);
    const start = p + 6, end = start + len;
    if (end > bytes.length) throw new ColorLibraryError("truncated ASE file");
    if (type === 0x0001) {
      let q = start;
      const nameLen = v.getUint16(q); q += 2;
      let name = "";
      for (let k = 0; k < nameLen; k++, q += 2) {
        const ch = v.getUint16(q);
        if (ch) name += String.fromCharCode(ch);
      }
      const model = String.fromCharCode(...bytes.subarray(q, q + 4)).trim(); q += 4;
      const f = (n: number) => Array.from({ length: n }, (_, k) => v.getFloat32(q + 4 * k));
      const e: ColorLibraryEntry = { name: name.trim() };
      if (model === "LAB") { const [l, a, b] = f(3); e.lab = [l * 100, a, b]; }
      else if (model === "CMYK") e.cmyk = f(4) as [number, number, number, number];
      else if (model === "RGB") e.rgb = f(3) as [number, number, number];
      else if (model === "Gray") { const [g] = f(1); e.rgb = [g, g, g]; }
      if (e.name && (e.lab || e.cmyk || e.rgb)) out.push(e);
    }
    p = end;
  }
  return out;
}

// --- Adobe Color Book ---------------------------------------------------------

/** Read an .acb file (Photoshop colour book, as Pantone's books come). */
export function parseAcb(bytes: Uint8Array): ColorLibraryEntry[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || String.fromCharCode(...bytes.subarray(0, 4)) !== "8BCB") throw new ColorLibraryError("not an ACB file");
  let p = 8; // signature, version, book id
  const ustr = () => {
    const n = v.getUint32(p); p += 4;
    let s = "";
    for (let k = 0; k < n; k++, p += 2) {
      const ch = v.getUint16(p);
      if (ch) s += String.fromCharCode(ch);
    }
    // "$$$/colorbook/PANTONE/Prefix=PANTONE " carries its text after "=".
    return s.startsWith("$$$") && s.includes("=") ? s.slice(s.indexOf("=") + 1) : s;
  };
  ustr(); // title
  const prefix = ustr(), postfix = ustr();
  ustr(); // description
  const count = v.getUint16(p); p += 2;
  p += 4; // page size, page selector offset
  const space = v.getUint16(p); p += 2;
  const out: ColorLibraryEntry[] = [];
  for (let i = 0; i < count && p < bytes.length; i++) {
    const name = ustr();
    p += 6; // catalogue code
    const e: ColorLibraryEntry = { name: `${prefix}${name}${postfix}`.replace(/\s+/g, " ").trim() };
    if (space === 0) { e.rgb = [bytes[p] / 255, bytes[p + 1] / 255, bytes[p + 2] / 255]; p += 3; }
    else if (space === 2) { e.cmyk = [0, 1, 2, 3].map((k) => (255 - bytes[p + k]) / 255) as [number, number, number, number]; p += 4; }
    else if (space === 7) { e.lab = [bytes[p] / 2.55, bytes[p + 1] - 128, bytes[p + 2] - 128]; p += 3; }
    else throw new ColorLibraryError("unsupported ACB colour space");
    if (name) out.push(e);
  }
  return out;
}

// --- CSV ------------------------------------------------------------------------

/** Read a CSV list: name;L;a;b, name;C;M;Y;K (percent) or name;#rrggbb, with
 *  ";", "," or tab between the fields and an optional header line. */
export function parseColorCsv(text: string): ColorLibraryEntry[] {
  const out: ColorLibraryEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sep = line.includes(";") ? ";" : line.includes("\t") ? "\t" : ",";
    const cells = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    const name = cells[0];
    const nums = cells.slice(1).map((c) => Number(c.replace(",", ".")));
    if (!name) continue;
    if (cells.length >= 2 && /^#?[0-9a-f]{6}$/i.test(cells[1])) {
      const h = cells[1].replace("#", "");
      out.push({ name, rgb: [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16) / 255) as [number, number, number] });
    } else if (cells.length >= 5 && nums.slice(0, 4).every(Number.isFinite)) {
      out.push({ name, cmyk: nums.slice(0, 4).map((n) => n / 100) as [number, number, number, number] });
    } else if (cells.length >= 4 && nums.slice(0, 3).every(Number.isFinite)) {
      out.push({ name, lab: nums.slice(0, 3) as [number, number, number] });
    }
    // anything else (a header line) is skipped
  }
  return out;
}

/** Read a library file by its extension. Throws ColorLibraryError when it is
 *  not one, has no colours, or too many. */
export function parseColorLibrary(fileName: string, bytes: Uint8Array): ColorLibraryEntry[] {
  const ext = fileName.toLowerCase().split(".").pop();
  const entries = ext === "ase" ? parseAse(bytes)
    : ext === "acb" ? parseAcb(bytes)
    : ext === "csv" || ext === "txt" ? parseColorCsv(new TextDecoder().decode(bytes))
    : (() => { throw new ColorLibraryError("unsupported file type"); })();
  if (!entries.length) throw new ColorLibraryError("no colours in the file");
  if (entries.length > MAX_ENTRIES) throw new ColorLibraryError("too many colours");
  return entries;
}

// --- matching -------------------------------------------------------------------

export interface LibraryMatch {
  entry: ColorLibraryEntry;
  /** CIEDE2000 to the colour asked about. */
  deltaE: number;
}

/** The entry nearest to a Lab colour (entries without Lab are skipped). */
export function nearestEntry(lab: [number, number, number], entries: readonly ColorLibraryEntry[]): LibraryMatch | null {
  let best: LibraryMatch | null = null;
  const x = { l: lab[0], a: lab[1], b: lab[2] };
  for (const entry of entries) {
    if (!entry.lab) continue;
    const d = ciede2000(x, { l: entry.lab[0], a: entry.lab[1], b: entry.lab[2] });
    if (!best || d < best.deltaE) best = { entry, deltaE: d };
  }
  return best;
}

/** Entries with Lab worked out where the file gave only RGB or CMYK (RGB as
 *  sRGB, CMYK through the given profile's conversion). Entries that already
 *  carry Lab keep it. */
export function completeLab(
  entries: readonly ColorLibraryEntry[],
  convert: { rgb: (r: number, g: number, b: number) => [number, number, number]; cmyk?: (c: number, m: number, y: number, k: number) => [number, number, number] },
): ColorLibraryEntry[] {
  const round = (v: [number, number, number]) => v.map((n) => Math.round(n * 100) / 100) as [number, number, number];
  return entries.map((e) => {
    if (e.lab) return e;
    if (e.cmyk && convert.cmyk) return { ...e, lab: round(convert.cmyk(...e.cmyk)) };
    if (e.rgb) return { ...e, lab: round(convert.rgb(...e.rgb)) };
    return e;
  });
}
