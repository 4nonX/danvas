// Encoding: a value in a symbology becomes its pattern (the bar and space
// widths of a linear code, the module matrix of a 2D code) or a reason why it
// cannot be encoded. bwip-js does the encoding and the validation (check
// digits, lengths, character sets, GS1 application identifiers and dates);
// only its pattern is used, the geometry is laid out in layout.ts.

// The default export: the ESM and CommonJS builds of bwip-js both have it.
import bwipjs from "bwip-js";
import { RULES, type Symbology } from "./symbologies";

/** Why a value cannot be encoded. `detail` is the encoder's English reason
 *  (for logs and as a fallback); the code is what the interface translates. */
export type EncodeErrorCode = "empty" | "check_digit" | "length" | "characters" | "gs1" | "too_long" | "invalid";

export interface EncodeError {
  ok: false;
  code: EncodeErrorCode;
  detail: string;
}

export interface LinearBar {
  /** Left edge and width, in modules from the first bar. */
  x: number;
  w: number;
  /** EAN and UPC guard bars (and UPC's outer digits), which extend below the others. */
  guard: boolean;
}

/** One character of the human-readable line of EAN and UPC, centred at `x` (in modules). */
export interface RetailDigit {
  ch: string;
  x: number;
  /** UPC-A's first and last digit, printed smaller beside the bars. */
  small: boolean;
}

export interface LinearPattern {
  ok: true;
  kind: "linear";
  symbology: Symbology;
  /** Width of the bars and spaces between the first and the last bar, in modules. */
  modules: number;
  bars: LinearBar[];
  /** The human-readable line (PZN as "PZN - 12345678", GS1 with brackets). */
  text: string;
  /** EAN and UPC only: each digit's place. */
  digits?: RetailDigit[];
  /** The value as encoded, check digit included (EAN, UPC, PZN). */
  encoded: string;
}

export interface MatrixPattern {
  ok: true;
  kind: "matrix";
  symbology: Symbology;
  cols: number;
  rows: number;
  /** Row-major, true = dark module. */
  cells: boolean[];
  text: string;
  encoded: string;
}

export type Pattern = LinearPattern | MatrixPattern;

export interface EncodeOptions {
  /** Data Matrix: the rectangular shapes instead of square ones. */
  rectangular?: boolean;
  /** QR code: error correction level (default M, about 15 % recoverable). */
  ecLevel?: "L" | "M" | "Q" | "H";
}

const fail = (code: EncodeErrorCode, detail: string): EncodeError => ({ ok: false, code, detail });

/** The encoder's reason, sorted into what the interface can explain. */
function classify(err: unknown): EncodeError {
  const msg = String((err as { message?: string } | null)?.message ?? err);
  const [id, ...rest] = msg.split(": ");
  const detail = rest.join(": ") || msg;
  if (/CheckDigit|Checksum|badCheck/i.test(id)) return fail("check_digit", detail);
  if (/^bwipp\.GS1/.test(id)) return fail("gs1", detail);
  if (/Length|TooShort|TooLong|badLength/i.test(id)) return fail("length", detail);
  if (/tooLong|NoValidSymbol|noValidSymbol|DataTooLarge|maxCapacity/i.test(id)) return fail("too_long", detail);
  if (/Character|Char|badCharacter|Ascii|Numeric|badDigits/i.test(id)) return fail("characters", detail);
  return fail("invalid", detail);
}

const digitsOnly = (s: string) => s.replace(/[\s-]/g, "");

/** Code 128 carries ISO 8859-1; danvas allows its printable characters. */
const latin1Printable = (s: string) => [...s].every((c) => {
  const n = c.codePointAt(0) ?? 0;
  return (n >= 0x20 && n <= 0x7e) || (n >= 0xa0 && n <= 0xff);
});

/** Module ranges of the guard bars (and UPC's outer digit bars) of the
 *  retail codes, by total width. */
const GUARDS: Partial<Record<Symbology, { total: number; ranges: [number, number][] }>> = {
  ean13: { total: 95, ranges: [[0, 3], [45, 50], [92, 95]] },
  ean8: { total: 67, ranges: [[0, 3], [31, 36], [64, 67]] },
  upca: { total: 95, ranges: [[0, 10], [45, 50], [85, 95]] },
};

/** Where each digit of a retail code sits, centred in its 7-module slot. */
function retailDigits(symbology: Symbology, digits: string): RetailDigit[] | undefined {
  const d = [...digits];
  const slot = (start: number, k: number) => start + 7 * k + 3.5;
  if (symbology === "ean13" && d.length === 13) {
    return [
      { ch: d[0], x: -5, small: false },
      ...d.slice(1, 7).map((ch, k) => ({ ch, x: slot(3, k), small: false })),
      ...d.slice(7).map((ch, k) => ({ ch, x: slot(50, k), small: false })),
    ];
  }
  if (symbology === "ean8" && d.length === 8) {
    return [
      ...d.slice(0, 4).map((ch, k) => ({ ch, x: slot(3, k), small: false })),
      ...d.slice(4).map((ch, k) => ({ ch, x: slot(36, k), small: false })),
    ];
  }
  if (symbology === "upca" && d.length === 12) {
    return [
      { ch: d[0], x: -5, small: true },
      ...d.slice(1, 6).map((ch, k) => ({ ch, x: slot(3, k + 1), small: false })),
      ...d.slice(6, 11).map((ch, k) => ({ ch, x: slot(50, k), small: false })),
      { ch: d[11], x: 100, small: true },
    ];
  }
  return undefined;
}

/** The value as bwip-js takes it for a symbology, or a reason to refuse it first. */
function prepare(symbology: Symbology, value: string, opts: EncodeOptions): { text: string; options: string } | EncodeError {
  switch (symbology) {
    case "ean13":
    case "ean8":
    case "upca": {
      const v = digitsOnly(value);
      if (!/^\d+$/.test(v)) return fail("characters", "digits only");
      return { text: v, options: "includetext" };
    }
    case "pzn": {
      // "PZN - 12345678", "-12345678" and "12345678" all mean the same number.
      const v = digitsOnly(value.replace(/^\s*PZN/i, ""));
      if (!/^\d+$/.test(v)) return fail("characters", "digits only");
      if (v.length !== 7 && v.length !== 8) return fail("length", "PZN has 7 digits and a check digit");
      // The check digit is always computed; a given one is compared in encode().
      return { text: v.slice(0, 7), options: "pzn8 includetext" };
    }
    case "code128":
      if (!latin1Printable(value)) return fail("characters", "Code 128 carries Latin-1 text only");
      return { text: value, options: "binarytext" };
    case "code39":
      return { text: value, options: "" };
    case "gs1-128":
      return { text: value.trim(), options: "includetext" };
    case "datamatrix": {
      const shape = opts.rectangular ? " format=rectangle" : "";
      if ([...value].every((c) => (c.codePointAt(0) ?? 0) <= 0xff)) return { text: value, options: "binarytext" + shape };
      // Beyond Latin-1: UTF-8 behind an ECI marker, so scanners know the encoding.
      // (parsefnc reads the marker; a literal caret is written twice.)
      return { text: "^ECI000026" + value.replace(/\^/g, "^^"), options: "parsefnc" + shape };
    }
    case "gs1datamatrix":
      return { text: value.trim(), options: opts.rectangular ? "format=rectangle" : "" };
    case "qrcode":
      // UTF-8, as phones and scanners expect it.
      return { text: value, options: `eclevel=${opts.ecLevel ?? "M"}` };
  }
}

/** Encodes `value` as `symbology`. Never throws. */
export function encode(symbology: Symbology, value: string, opts: EncodeOptions = {}): Pattern | EncodeError {
  if (!value.trim()) return fail("empty", "no value");
  const prep = prepare(symbology, value, opts);
  if ("ok" in prep) return prep;
  let out: ReturnType<typeof bwipjs.raw>;
  try {
    out = bwipjs.raw(symbology, prep.text, prep.options);
  } catch (e) {
    return classify(e);
  }
  const r = out[0];
  if (!r) return fail("invalid", "no symbol");
  if ("pixs" in r) {
    const shown = symbology === "gs1datamatrix" ? prep.text : value;
    return { ok: true, kind: "matrix", symbology, cols: r.pixx, rows: r.pixy, cells: r.pixs.map((p) => p === 1), text: shown, encoded: shown };
  }
  const bars: LinearBar[] = [];
  let x = 0;
  r.sbs.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w, guard: false });
    x += w;
  });
  const g = GUARDS[symbology];
  if (g && x === g.total) for (const b of bars) b.guard = g.ranges.some(([a, z]) => b.x >= a && b.x + b.w <= z);
  const txt = (r.txt ?? []).map((t) => t[0]);
  let text = value;
  let encoded = value;
  if (RULES[symbology].retail) {
    encoded = txt.join("");
    text = encoded;
  } else if (symbology === "pzn") {
    text = txt[0] ?? "";
    encoded = text.replace(/\D/g, "");
    const given = digitsOnly(value.replace(/^\s*PZN/i, ""));
    if (given.length === 8 && given !== encoded) return fail("check_digit", "Incorrect PZN check digit provided");
  } else if (symbology === "gs1-128") {
    text = txt[0] ?? value;
    encoded = text;
  }
  return { ok: true, kind: "linear", symbology, modules: x, bars, text, digits: RULES[symbology].retail ? retailDigits(symbology, encoded) : undefined, encoded };
}
