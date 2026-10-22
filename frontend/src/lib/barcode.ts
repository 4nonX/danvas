// Barcodes in the editor (F43). A barcode is an ordinary group: one path with
// every bar (or the outline of a matrix code) and, when shown, text nodes for
// the human-readable line. What it encodes and how it is sized lives in the
// group's `data.barcode`, so every renderer and every earlier danvas draws and
// prints it exactly, and this editor can encode it again after any change.
// The encoder (@hc/barcode, with bwip-js) is loaded only when a barcode is
// made or changed; drawing needs none of it.

import { createNode, type Color, type Node } from "@hc/schema";
import type { BarcodeLayout, EncodeError, Pattern, Symbology } from "@hc/barcode";
import { tr } from "@/lib/i18n";

export type { Symbology } from "@hc/barcode";

/** Everything a barcode is made from. Lengths in mm. */
export interface BarcodeSpec {
  symbology: Symbology;
  value: string;
  moduleMm: number;
  barHeightMm: number;
  quietZones: boolean;
  text: boolean;
  /** Absent: the size that goes with the module width. */
  textSizeMm?: number;
  fontFamily: string;
  barWidthReductionMm?: number;
  printerDpi?: number;
  /** Data Matrix: rectangular instead of square. */
  rectangular?: boolean;
  /** QR code: error correction level (default M). */
  ecLevel?: "L" | "M" | "Q" | "H";
  color: Color;
  /** Absent or null: transparent, the label shows through. */
  background?: Color | null;
}

/** 100 % black ink, and black on screen and in RGB files. */
export const BLACK_INK: Color = { srgb: { r: 0, g: 0, b: 0, a: 1 }, cmyk: { c: 0, m: 0, y: 0, k: 1 } };
export const DEFAULT_BARCODE_FONT = "Roboto Mono";

type BarcodeModule = typeof import("@hc/barcode");
let loading: Promise<BarcodeModule> | null = null;

/** The encoder, loaded on first use. */
export function loadBarcode(): Promise<BarcodeModule> {
  loading ??= import("@hc/barcode").catch((e) => { loading = null; throw e; });
  return loading;
}

/** What the encoder needs besides symbology and value. */
export const encodeOptionsOf = (spec: BarcodeSpec) => ({ rectangular: spec.rectangular, ecLevel: spec.ecLevel });

/** The barcode a node is, if it is one. */
export function barcodeOf(node: Node | null | undefined): BarcodeSpec | null {
  if (!node || node.type !== "group") return null;
  const b = (node.data as { barcode?: unknown } | undefined)?.barcode as Partial<BarcodeSpec> | undefined;
  return b && typeof b.symbology === "string" && typeof b.value === "string" ? (b as BarcodeSpec) : null;
}

/** A new barcode's settings for a symbology. */
export function defaultSpec(mod: BarcodeModule, symbology: Symbology, value: string): BarcodeSpec {
  const r = mod.RULES[symbology];
  return {
    symbology,
    value,
    moduleMm: r.defaultModuleMm,
    barHeightMm: r.defaultHeightMm,
    quietZones: true,
    text: r.kind === "linear",
    fontFamily: DEFAULT_BARCODE_FONT,
    color: BLACK_INK,
    background: null,
  };
}

export interface BuiltBarcode {
  ok: true;
  pattern: Pattern;
  layout: BarcodeLayout;
  children: Node[];
  width: number;
  height: number;
}

const solid = (color: Color) => ({ type: "solid" as const, color });

/** The group's children for a spec at the document's dpi, or why the value
 *  cannot be encoded. */
export function buildBarcode(mod: BarcodeModule, spec: BarcodeSpec, dpi: number): BuiltBarcode | EncodeError {
  const pattern = mod.encode(spec.symbology, spec.value, encodeOptionsOf(spec));
  if (!pattern.ok) return pattern;
  const l = mod.layout(pattern, {
    moduleMm: spec.moduleMm,
    barHeightMm: spec.barHeightMm,
    quietZones: spec.quietZones,
    barWidthReductionMm: spec.barWidthReductionMm,
    printerDpi: spec.printerDpi,
    text: spec.text,
    textSizeMm: spec.textSizeMm,
  }, dpi);
  const at0 = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
  const children: Node[] = [];
  if (spec.background) {
    children.push(createNode("path", {
      name: tr("editor.barcode_background"),
      transform: at0,
      size: { width: l.width, height: l.height },
      segments: [{ x: 0, y: 0 }, { x: l.width, y: 0 }, { x: l.width, y: l.height }, { x: 0, y: l.height }],
      closed: true,
      fills: [solid(spec.background)],
    } as Partial<Node>));
  }
  const [first, ...rest] = l.contours;
  if (first) {
    children.push(createNode("path", {
      name: tr("editor.barcode_bars"),
      transform: at0,
      size: { width: l.width, height: l.height },
      segments: first.map((p) => ({ x: p.x, y: p.y })),
      closed: true,
      contours: rest.map((c) => ({ segments: c.map((p) => ({ x: p.x, y: p.y })), closed: true })),
      fills: [solid(spec.color)],
    } as Partial<Node>));
  }
  for (const t of l.texts) {
    // Wide enough that the line never wraps; centred on its place.
    const width = Math.max(l.width, t.text.length * t.size);
    children.push(createNode("text", {
      name: t.text,
      transform: { ...at0, x: t.cx - width / 2, y: t.top },
      size: { width, height: t.size },
      box: { mode: "fixed", width, height: t.size, autoFit: { enabled: false, min: 1, max: 512 }, verticalAlign: "top" },
      content: [{ runs: [{ text: t.text, style: { fontFamily: spec.fontFamily, fontStyle: "Regular", fontSize: t.size, lineHeight: 1, fill: solid(spec.color) } }], style: { align: "center", direction: "ltr" } }],
    } as Partial<Node>));
  }
  return { ok: true, pattern, layout: l, children, width: l.width, height: l.height };
}

/** "Ungroup" for a group; for a barcode, what ungrouping really does: its
 *  parts become ordinary shapes and text that print the same but can no
 *  longer be encoded again. */
export function ungroupLabel(node: Node | null | undefined): string {
  return barcodeOf(node) ? tr("editor.barcode_to_shapes") : tr("editor.ungroup");
}

/** The reason a value cannot be encoded, in the user's language. */
export function barcodeErrorText(e: EncodeError): string {
  const m: Record<EncodeError["code"], string> = {
    empty: tr("editor.barcode_error_empty"),
    check_digit: tr("editor.barcode_error_check_digit"),
    length: tr("editor.barcode_error_length"),
    characters: tr("editor.barcode_error_characters"),
    gs1: tr("editor.barcode_error_gs1"),
    too_long: tr("editor.barcode_error_too_long"),
    invalid: tr("editor.barcode_error_invalid"),
  };
  return m[e.code];
}

// i18n-ignore: barcode type names are the same in every language (PZN is explained)
export const symbologyLabel = (): Record<Symbology, string> => ({
  ean13: "EAN-13",
  ean8: "EAN-8",
  upca: "UPC-A",
  code128: "Code 128",
  "gs1-128": "GS1-128",
  code39: "Code 39",
  pzn: tr("editor.barcode_pzn"),
  datamatrix: "Data Matrix",
  gs1datamatrix: "GS1 Data Matrix",
  qrcode: "QR Code",
});
