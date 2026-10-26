// Colour libraries a workspace brings itself (a Pantone book from its own
// licence, a house colour list, a colour atlas), for the colour list that goes
// with a print export: each colour of a design gets the library's nearest
// entry and how far it is (CIEDE2000). danvas ships no library; the files are
// read here and only the entries are stored.
//
// Read: Adobe Swatch Exchange (.ase), Adobe Color Book (.acb), CxF (.cxf,
// ISO 17972), CGATS (.txt, .cgats, .it8) and CSV (name;L;a;b,
// name;C;M;Y;K in percent, or name;#rrggbb). A file that cannot be read as
// one of them is refused with the reason, never guessed at: a list read
// wrongly would give believable but wrong matches.

import { ciede2000 } from "@hc/color";
import { spectrumToLab } from "./spectral";

export interface ColorLibraryEntry {
  name: string;
  /** CIE L*a*b* (D50), when the file gives it or it could be worked out. */
  lab?: [number, number, number];
  /** CMYK 0..1, when the file gives it. */
  cmyk?: [number, number, number, number];
  /** sRGB 0..1, when the file gives it. */
  rgb?: [number, number, number];
}

/** Why a file could not be read (a catalog key `dashboard.color_library_error_<reason>`). */
export type ColorLibraryReason =
  | "unsupported_type" | "not_ase" | "not_acb" | "acb_space" | "truncated" | "bad_line"
  | "no_colors" | "too_many" | "not_cxf" | "not_cgats" | "spectral_range";

export class ColorLibraryError extends Error {
  constructor(readonly reason: ColorLibraryReason, readonly params: Record<string, unknown> = {}) {
    super(`colour library: ${reason}${Object.keys(params).length ? ` ${JSON.stringify(params)}` : ""}`);
  }
}

/** What a read found, for the confirmation before anything is stored. */
export interface ColorLibraryRead {
  entries: ColorLibraryEntry[];
  /** Where the entries' colours come from: Lab as given, Lab from measured
   *  spectra, CMYK only, RGB only (the last two get Lab worked out). */
  counts: { lab: number; spectral: number; cmyk: number; rgb: number };
  /** Objects of the file with no colour that could be used (left out). */
  skipped: number;
}

const MAX_ENTRIES = 20000;
const num = (s: string) => Number(s.trim().replace(",", "."));
const inRange = (v: number, lo: number, hi: number) => Number.isFinite(v) && v >= lo && v <= hi;
const labOk = (l: number, a: number, b: number) => inRange(l, 0, 100) && inRange(a, -200, 200) && inRange(b, -200, 200);

// --- Adobe Swatch Exchange ----------------------------------------------------

/** Read an .ase file: every colour entry, groups flattened. */
export function parseAse(bytes: Uint8Array): ColorLibraryEntry[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(0, 4)) !== "ASEF") throw new ColorLibraryError("not_ase");
  const blocks = v.getUint32(8);
  const out: ColorLibraryEntry[] = [];
  let p = 12;
  for (let i = 0; i < blocks && p + 6 <= bytes.length; i++) {
    const type = v.getUint16(p), len = v.getUint32(p + 2);
    const start = p + 6, end = start + len;
    if (end > bytes.length) throw new ColorLibraryError("truncated");
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
  if (bytes.length < 8 || String.fromCharCode(...bytes.subarray(0, 4)) !== "8BCB") throw new ColorLibraryError("not_acb");
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
  try {
    ustr(); // title
    const prefix = ustr(), postfix = ustr();
    ustr(); // description
    const count = v.getUint16(p); p += 2;
    p += 4; // page size, page selector offset
    const space = v.getUint16(p); p += 2;
    if (space !== 0 && space !== 2 && space !== 7) throw new ColorLibraryError("acb_space");
    const out: ColorLibraryEntry[] = [];
    for (let i = 0; i < count && p < bytes.length; i++) {
      const name = ustr();
      p += 6; // catalogue code
      const e: ColorLibraryEntry = { name: `${prefix}${name}${postfix}`.replace(/\s+/g, " ").trim() };
      if (space === 0) { e.rgb = [bytes[p] / 255, bytes[p + 1] / 255, bytes[p + 2] / 255]; p += 3; }
      else if (space === 2) { e.cmyk = [0, 1, 2, 3].map((k) => (255 - bytes[p + k]) / 255) as [number, number, number, number]; p += 4; }
      else { e.lab = [bytes[p] / 2.55, bytes[p + 1] - 128, bytes[p + 2] - 128]; p += 3; }
      if (name) out.push(e);
    }
    return out;
  } catch (e) {
    if (e instanceof ColorLibraryError) throw e;
    throw new ColorLibraryError("truncated"); // read past the end
  }
}

// --- CSV ------------------------------------------------------------------------

/** Read a CSV list: name;L;a;b, name;C;M;Y;K (percent) or name;#rrggbb, with
 *  ";", "," or tab between the fields. The first line may be a header; every
 *  other line must be one of the three, or the file is refused naming the
 *  line (a line of another layout, say a measurement with 36 values, must not
 *  be read as something it is not). */
export function parseColorCsv(text: string): ColorLibraryEntry[] {
  const out: ColorLibraryEntry[] = [];
  let first = true;
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const sep = line.includes(";") ? ";" : line.includes("\t") ? "\t" : ",";
    const cells = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    while (cells.length > 1 && cells[cells.length - 1] === "") cells.pop();
    const [name, ...vals] = cells;
    const nums = vals.map(num);
    const isHeader = first && vals.some((c) => c && !Number.isFinite(num(c))) && !/^#?[0-9a-f]{6}$/i.test(vals[0] ?? "");
    first = false;
    if (isHeader) continue;
    if (name && vals.length === 1 && /^#?[0-9a-f]{6}$/i.test(vals[0])) {
      const h = vals[0].replace("#", "");
      out.push({ name, rgb: [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16) / 255) as [number, number, number] });
    } else if (name && vals.length === 3 && labOk(nums[0], nums[1], nums[2])) {
      out.push({ name, lab: nums as [number, number, number] });
    } else if (name && vals.length === 4 && nums.every((n) => inRange(n, 0, 100))) {
      out.push({ name, cmyk: nums.map((n) => n / 100) as [number, number, number, number] });
    } else {
      throw new ColorLibraryError("bad_line", { line: i + 1, text: line.length > 60 ? `${line.slice(0, 57)}...` : line });
    }
  }
  return out;
}

// --- CGATS ----------------------------------------------------------------------

/** Whether a text file is CGATS / IT8 (a measurement or colour data file). */
export function isCgats(text: string): boolean {
  return /^\s*(CGATS|IT8)/.test(text) || /\bBEGIN_DATA_FORMAT\b/.test(text.slice(0, 20000));
}

/** Read CGATS (CGATS.17, IT8.7): one entry per data row, its name from
 *  SAMPLE_NAME (else SAMPLE_ID), Lab from LAB_L/A/B or from SPECTRAL_* values,
 *  CMYK_* in percent, RGB_* in 0..255. */
export function parseCgats(text: string): ColorLibraryRead {
  const lines = text.split(/\r?\n/);
  const idx = (kw: string) => lines.findIndex((l) => l.trim().split(/\s+/)[0] === kw);
  const fs = idx("BEGIN_DATA_FORMAT"), fe = idx("END_DATA_FORMAT"), ds = idx("BEGIN_DATA"), de = idx("END_DATA");
  if (fs < 0 || fe < fs || ds < fe || de < ds) throw new ColorLibraryError("not_cgats");
  const tokens = (s: string) => (s.match(/"[^"]*"|\S+/g) ?? []).map((t) => t.replace(/^"|"$/g, ""));
  const fields = lines.slice(fs + 1, fe).flatMap(tokens);
  const col = (...names: string[]) => names.map((n) => fields.indexOf(n)).find((i) => i >= 0) ?? -1;
  const nameCol = col("SAMPLE_NAME", "SAMPLE_ID");
  const lab = [col("LAB_L"), col("LAB_A"), col("LAB_B")];
  const cmyk = [col("CMYK_C"), col("CMYK_M"), col("CMYK_Y"), col("CMYK_K")];
  const rgb = [col("RGB_R"), col("RGB_G"), col("RGB_B")];
  const spec = fields.map((f, i) => ({ i, nm: Number(f.match(/^SPECTRAL_(?:NM_?)?(\d+)$/)?.[1]) })).filter((s) => Number.isFinite(s.nm)).sort((a, b) => a.nm - b.nm);
  const step = spec.length > 1 ? spec[1].nm - spec[0].nm : 0;
  const hasLab = lab.every((i) => i >= 0), hasCmyk = cmyk.every((i) => i >= 0), hasRgb = rgb.every((i) => i >= 0), hasSpec = spec.length > 1;
  if (!hasLab && !hasCmyk && !hasRgb && !hasSpec) throw new ColorLibraryError("not_cgats");
  const read: ColorLibraryRead = { entries: [], counts: { lab: 0, spectral: 0, cmyk: 0, rgb: 0 }, skipped: 0 };
  for (let li = ds + 1; li < de; li++) {
    const t = tokens(lines[li]);
    if (!t.length) continue;
    const bad = () => new ColorLibraryError("bad_line", { line: li + 1, text: lines[li].trim().slice(0, 60) });
    if (t.length < fields.length) throw bad();
    const e: ColorLibraryEntry = { name: (nameCol >= 0 ? t[nameCol] : "") || `#${read.entries.length + 1}` };
    if (hasLab) {
      const [l, a, b] = lab.map((i) => num(t[i]));
      if (!labOk(l, a, b)) throw bad();
      e.lab = [l, a, b];
    } else if (hasSpec) {
      const r = spectrumToLab(spec[0].nm, step, spec.map((s) => num(t[s.i])));
      if (!r) throw new ColorLibraryError("spectral_range", { from: spec[0].nm, to: spec[spec.length - 1].nm, step });
      e.lab = r;
    }
    if (hasCmyk) {
      const v = cmyk.map((i) => num(t[i]));
      if (!v.every((n) => inRange(n, 0, 100))) throw bad();
      e.cmyk = v.map((n) => n / 100) as [number, number, number, number];
    }
    if (hasRgb) {
      const v = rgb.map((i) => num(t[i]));
      if (!v.every((n) => inRange(n, 0, 255))) throw bad();
      e.rgb = v.map((n) => n / 255) as [number, number, number];
    }
    read.counts[hasLab ? "lab" : hasSpec ? "spectral" : hasCmyk ? "cmyk" : "rgb"]++;
    read.entries.push(e);
  }
  return read;
}

// --- CxF ------------------------------------------------------------------------

// i18n-ignore: CxF element names (ISO 17972), part of the format, never text
const X = {
  root: "CxF",
  resources: "Resources",
  specCollection: "ColorSpecificationCollection",
  spec: "ColorSpecification",
  tristimulus: "TristimulusSpec",
  measurement: "MeasurementSpec",
  range: "WavelengthRange",
  illuminant: "Illuminant",
  observer: "Observer",
  objectCollection: "ObjectCollection",
  object: "Object",
  values: "ColorValues",
  lab: "ColorCIELab",
  spectrum: "ReflectanceSpectrum",
  cmyk: "ColorCMYK",
  srgb: "ColorSRGB",
  inks: ["Cyan", "Magenta", "Yellow", "Black"],
} as const;

/** An XML element as far as CxF needs it: local name (prefix dropped),
 *  attributes, child elements, text. */
interface XmlEl { name: string; attrs: Record<string, string>; children: XmlEl[]; text: string }

const entity = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e: string) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    : ({ lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" } as Record<string, string>)[e.toLowerCase()]);

/** A small XML reader (no DTDs, no external entities): enough for CxF, and as
 *  fast in every environment as a colour atlas of thousands of objects needs.
 *  Throws on unbalanced tags. */
function readXml(text: string): XmlEl {
  const root: XmlEl = { name: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let pos = 0;
  for (let m: RegExpExecArray | null; (m = re.exec(text)); ) {
    // Nothing may be skipped: a malformed tag must fail, not vanish.
    if (m.index !== pos) throw new Error("malformed");
    pos = re.lastIndex;
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) { top.text += m[1]; continue; }
    if (m[6] !== undefined) { top.text += entity(m[6]); continue; }
    if (!m[3]) {
      if (m[0][0] === "<" && !/^<(!|\?)/.test(m[0])) throw new Error("bad tag");
      continue; // comment, declaration, processing instruction
    }
    const name = m[3].includes(":") ? m[3].slice(m[3].indexOf(":") + 1) : m[3];
    if (m[2] === "/") {
      if (stack.length < 2 || top.name !== name) throw new Error("unbalanced");
      stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of (m[4] ?? "").matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const k = a[1].includes(":") ? a[1].slice(a[1].indexOf(":") + 1) : a[1];
      attrs[k] = entity(a[2] ?? a[3] ?? "");
    }
    const el: XmlEl = { name, attrs, children: [], text: "" };
    top.children.push(el);
    if (m[5] !== "/") stack.push(el);
  }
  if (pos !== text.length || stack.length !== 1) throw new Error("unclosed");
  return root;
}

const kid = (el: XmlEl, name: string) => el.children.find((c) => c.name === name);
const kids = (el: XmlEl, name: string) => el.children.filter((c) => c.name === name);

/** Read CxF3 (ISO 17972): every Object, Lab as given (when measured under D50,
 *  2°), else from its reflectance spectrum, else its CMYK or sRGB. */
export function parseCxf(text: string): ColorLibraryRead {
  let root: XmlEl;
  try {
    root = readXml(text);
  } catch {
    throw new ColorLibraryError("not_cxf");
  }
  const cxf = kid(root, X.root);
  if (!cxf) throw new ColorLibraryError("not_cxf");
  const resources = kid(cxf, X.resources);
  const val = (el: XmlEl, name: string) => num(kid(el, name)?.text ?? "");
  // Measurement conditions by id: illuminant/observer, spectral grid.
  const specs = new Map<string, { illuminant: string; observer: string; start?: number; step?: number }>();
  for (const coll of resources ? kids(resources, X.specCollection) : []) {
    for (const s of kids(coll, X.spec)) {
      const t = kid(s, X.tristimulus);
      const wr = kid(s, X.measurement) && kid(kid(s, X.measurement)!, X.range);
      specs.set(s.attrs.Id ?? "", {
        illuminant: (t && kid(t, X.illuminant)?.text.trim()) || "",
        observer: (t && kid(t, X.observer)?.text.trim()) || "",
        start: wr ? Number(wr.attrs.StartWL) : undefined,
        step: wr ? Number(wr.attrs.Increment) : undefined,
      });
    }
  }
  const isD50 = (id: string | undefined) => {
    const sp = specs.get(id ?? "");
    return !sp || ((!sp.illuminant || /^D50$/i.test(sp.illuminant)) && (!sp.observer || /^2/.test(sp.observer)));
  };
  const read: ColorLibraryRead = { entries: [], counts: { lab: 0, spectral: 0, cmyk: 0, rgb: 0 }, skipped: 0 };
  const objects = (resources ? kids(resources, X.objectCollection) : []).flatMap((c) => kids(c, X.object));
  for (const o of objects) {
    const name = (o.attrs.Name || o.attrs.Id || "").trim();
    const cv = kid(o, X.values);
    if (!name || !cv) { read.skipped++; continue; }
    const e: ColorLibraryEntry = { name };
    let source: keyof ColorLibraryRead["counts"] | null = null;
    const labEl = cv.children.find((c) => c.name === X.lab && isD50(c.attrs.ColorSpecification));
    if (labEl) {
      const l = val(labEl, "L"), a = val(labEl, "A"), b = val(labEl, "B");
      if (labOk(l, a, b)) { e.lab = [l, a, b]; source = "lab"; }
    }
    const specEl = kid(cv, X.spectrum);
    if (!e.lab && specEl) {
      const sp = specs.get(specEl.attrs.ColorSpecification ?? "");
      const start = Number(specEl.attrs.StartWL ?? sp?.start);
      const step = Number(specEl.attrs.Increment ?? sp?.step ?? 10);
      const r = spectrumToLab(start, step, specEl.text.trim().split(/\s+/).map(num));
      if (r) { e.lab = r; source = "spectral"; }
    }
    const cmykEl = kid(cv, X.cmyk);
    if (cmykEl) {
      const v = X.inks.map((n) => val(cmykEl, n));
      if (v.every((n) => inRange(n, 0, 100))) { e.cmyk = v.map((n) => n / 100) as [number, number, number, number]; source ??= "cmyk"; }
    }
    const rgbEl = kid(cv, X.srgb);
    if (rgbEl) {
      const max = Number(rgbEl.attrs.MaxRange ?? 255) || 255;
      const v = ["R", "G", "B"].map((n) => val(rgbEl, n) / max);
      if (v.every((n) => inRange(n, 0, 1))) { e.rgb = v as [number, number, number]; source ??= "rgb"; }
    }
    if (!source) { read.skipped++; continue; }
    read.counts[source]++;
    read.entries.push(e);
  }
  return read;
}

// --- any file ---------------------------------------------------------------------

const countOf = (entries: ColorLibraryEntry[]): ColorLibraryRead["counts"] => ({
  lab: entries.filter((e) => e.lab).length,
  spectral: 0,
  cmyk: entries.filter((e) => !e.lab && e.cmyk).length,
  rgb: entries.filter((e) => !e.lab && !e.cmyk && e.rgb).length,
});

/** Read a library file by its extension (and, for text, its content). Throws
 *  ColorLibraryError when it is none of the formats, holds no colours, or too
 *  many. */
export function readColorLibrary(fileName: string, bytes: Uint8Array): ColorLibraryRead {
  const ext = fileName.toLowerCase().split(".").pop();
  const text = () => new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
  let read: ColorLibraryRead;
  if (ext === "ase" || ext === "acb") {
    const entries = ext === "ase" ? parseAse(bytes) : parseAcb(bytes);
    read = { entries, counts: countOf(entries), skipped: 0 };
  } else if (ext === "cxf") {
    read = parseCxf(text());
  } else if (ext === "csv" || ext === "txt" || ext === "cgats" || ext === "it8" || ext === "cgt") {
    const t = text();
    if (isCgats(t)) read = parseCgats(t);
    else if (ext === "cgats" || ext === "it8" || ext === "cgt") throw new ColorLibraryError("not_cgats");
    else { const entries = parseColorCsv(t); read = { entries, counts: countOf(entries), skipped: 0 }; }
  } else {
    throw new ColorLibraryError("unsupported_type", { ext: ext ?? "" });
  }
  if (!read.entries.length) throw new ColorLibraryError("no_colors");
  if (read.entries.length > MAX_ENTRIES) throw new ColorLibraryError("too_many", { max: MAX_ENTRIES, found: read.entries.length });
  return read;
}

/** The entries of a library file (see readColorLibrary). */
export function parseColorLibrary(fileName: string, bytes: Uint8Array): ColorLibraryEntry[] {
  return readColorLibrary(fileName, bytes).entries;
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
