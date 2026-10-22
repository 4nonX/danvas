// The symbologies danvas offers and their print rules: quiet zones, the
// smallest module width that still scans reliably, and the sizes a new code
// starts with. Lengths are in millimetres, quiet zones in modules.

export const SYMBOLOGIES = ["ean13", "ean8", "upca", "code128", "gs1-128", "code39", "pzn", "datamatrix", "gs1datamatrix", "qrcode"] as const;
export type Symbology = (typeof SYMBOLOGIES)[number];

export interface SymbologyRules {
  kind: "linear" | "matrix";
  /** Quiet zone left and right (linear) or on every side (matrix), in modules. */
  quiet: [number, number];
  /** Below this module width the output check warns. */
  minModuleMm: number;
  defaultModuleMm: number;
  /** Bar height of a new linear code (matrix codes are square or follow their shape). */
  defaultHeightMm: number;
  /** EAN and UPC: digits laid out under the halves, guard bars extended. */
  retail: boolean;
  /** Application identifiers in brackets, encoded with FNC1. */
  gs1: boolean;
}

export const RULES: Record<Symbology, SymbologyRules> = {
  // GS1 General Specifications: X at 100 % is 0.330 mm, allowed 80 % to 200 %;
  // nominal bar heights 22.85 mm (EAN-13, UPC-A) and 18.23 mm (EAN-8).
  ean13: { kind: "linear", quiet: [11, 7], minModuleMm: 0.264, defaultModuleMm: 0.33, defaultHeightMm: 22.85, retail: true, gs1: false },
  ean8: { kind: "linear", quiet: [7, 7], minModuleMm: 0.264, defaultModuleMm: 0.33, defaultHeightMm: 18.23, retail: true, gs1: false },
  upca: { kind: "linear", quiet: [9, 9], minModuleMm: 0.264, defaultModuleMm: 0.33, defaultHeightMm: 22.85, retail: true, gs1: false },
  code128: { kind: "linear", quiet: [10, 10], minModuleMm: 0.19, defaultModuleMm: 0.25, defaultHeightMm: 10, retail: false, gs1: false },
  "gs1-128": { kind: "linear", quiet: [10, 10], minModuleMm: 0.25, defaultModuleMm: 0.33, defaultHeightMm: 12, retail: false, gs1: true },
  code39: { kind: "linear", quiet: [10, 10], minModuleMm: 0.19, defaultModuleMm: 0.25, defaultHeightMm: 10, retail: false, gs1: false },
  pzn: { kind: "linear", quiet: [10, 10], minModuleMm: 0.19, defaultModuleMm: 0.25, defaultHeightMm: 10, retail: false, gs1: false },
  // GS1 healthcare: Data Matrix X from 0.255 mm.
  datamatrix: { kind: "matrix", quiet: [1, 1], minModuleMm: 0.19, defaultModuleMm: 0.5, defaultHeightMm: 0, retail: false, gs1: false },
  gs1datamatrix: { kind: "matrix", quiet: [1, 1], minModuleMm: 0.255, defaultModuleMm: 0.5, defaultHeightMm: 0, retail: false, gs1: true },
  // ISO/IEC 18004: a quiet zone of 4 modules. Phone cameras read modules
  // from about 0.33 mm reliably.
  qrcode: { kind: "matrix", quiet: [4, 4], minModuleMm: 0.33, defaultModuleMm: 0.5, defaultHeightMm: 0, retail: false, gs1: false },
};

export function isSymbology(s: unknown): s is Symbology {
  return typeof s === "string" && (SYMBOLOGIES as readonly string[]).includes(s);
}
