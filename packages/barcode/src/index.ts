// @hc/barcode: barcodes as exact print geometry (F43). `encode` turns a value
// into its pattern or a reason it cannot be encoded; `layout` turns a pattern
// into outlines and text lines in design px. Framework-agnostic: the editor
// stores the result as an ordinary group of a path and text, so every
// renderer draws it without knowing about barcodes.

export { SYMBOLOGIES, RULES, isSymbology, type Symbology, type SymbologyRules } from "./symbologies";
export { encode, type Pattern, type LinearPattern, type MatrixPattern, type LinearBar, type RetailDigit, type EncodeError, type EncodeErrorCode, type EncodeOptions } from "./encode";
export { layout, traceMatrix, defaultTextSizeMm, type LayoutOptions, type BarcodeLayout, type Point, type TextItem } from "./layout";
