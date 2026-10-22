# F43 Barcodes

A native barcode element for print work: product and pharmacy labels, batch and expiry codes, packaging. The bars come out as exact vector geometry in one ink (by default 100 % black ink), so a print shop, an office printer and a thermal label printer all get sharp edges at the specified size, and every code can be checked before it is printed.

## Status

Shipped in 0.6.1, with these differences to the text below: the module width is entered in mm, and for EAN and UPC the magnification is shown beside it rather than entered (FR-3); re-encoding on the server for filling from data (FR-12) is not built yet and belongs to the serial print export; the bar width reduction applies to linear codes only (FR-5). Encoding is checked by decoding every symbology back (zxing) from the generated geometry and from the server's render.

## Where it stood before

- A QR code is its own node type (`QRNode`). The editor encodes the value (the `qrcode` library) and stores the module matrix on the node; the engine (`render2d.ts` `drawQr`) and the server (`render/raster.go`, `render/svg.go`) draw that matrix. Its colours may carry exact CMYK or a spot colour, which the vector print path writes as given.
- Each QR module is drawn as its own rectangle, half a design pixel larger than its cell to hide the hairline seams between neighbours on screen. In a vector print file that makes every dark module half a pixel too wide and too tall, so dark areas grow (at 96 dpi by about 0.13 mm per module edge).
- There is no linear barcode and no Data Matrix.

## Symbologies

| Name | Used for | Data |
| --- | --- | --- |
| EAN-13, EAN-8, UPC-A | retail products | digits; the check digit is computed when left out and verified when given |
| Code 128 | batch, serial, free text | ISO 8859-1 text |
| GS1-128 | logistics, batch and expiry with application identifiers | `(01)…(10)…(17)…` |
| Code 39 | legacy systems | `0-9 A-Z - . $ / + %` and space |
| PZN | German pharmacy product number (PZN-8, as Code 39 with leading `-`) | 7 digits plus the check digit (computed when left out) |
| Data Matrix (ECC 200) | small labels, square or rectangular | text or bytes |
| GS1 Data Matrix | pharmaceutical and medical packaging (GTIN, batch, expiry, serial) | `(01)…(17)…(10)…(21)…` |
| QR Code | links, any text | text (UTF-8), error correction L, M, Q or H |

The older QR node type stays for web links with a centre logo; this spec also fixes how it is drawn (FR-9). Encoding uses bwip-js (MIT, a port of Barcode Writer in Pure PostScript, which follows the ISO and GS1 specifications and validates check digits, lengths, application identifiers and dates). Only its encoder is used (`raw`: the bar and space widths of a linear code, the module matrix of a 2D code); danvas draws the geometry itself.

## Requirements

- **FR-1 Storage, compatible with every earlier version.** A barcode is a `GroupNode` whose `data.barcode` holds `{ symbology, value, options }` (the `data` record every node has for app metadata, as placeholders and autoflow use it). Its children are generated from it: one `PathNode` holding every bar or module as a rectangle contour of a compound path (even-odd), and, when shown, `TextNode`s for the human-readable line. No schema change and no version bump: an older danvas validates the file as before, draws, exports and prints the barcode exactly, because it only sees a group of a path and text, and it keeps `data` with the group. Deliberately not a new node type (an older client would draw a placeholder box) and not a new member of an existing enum (it would make the whole file invalid there). If an older client ever loses the `data` entry, the barcode stays a correct group of a path and text that can no longer be re-encoded, never a loss.
- **FR-2 Exact geometry.** Bars are placed at whole multiples of the module width X, in design px at the document's dpi, with no overlap and no padding. The quiet zones each symbology requires are part of the element's box (EAN-13: 11 X left, 7 X right; UPC-A: 9 X each side; EAN-8: 7 X each side; Code 128 and GS1-128: 10 X; Code 39 and PZN: 10 X; Data Matrix: 1 X on every side), so moving or aligning the element never eats them. The element's size follows from X, the bar height and the data; it is not freely stretched.
- **FR-3 Size.** The inspector sets X in the document's unit (or, for EAN and UPC, as the magnification of the nominal 0.33 mm, allowed 80 % to 200 %), the bar height, and the quiet zones (standard or none). Dragging the frame's handles changes X (width handles) or the bar height (height handles of linear codes) and regenerates, so the code is never distorted.
- **FR-4 Colour.** Bars default to exact `0 / 0 / 0 / 100` CMYK (black ink only). Any colour of the colour field may be chosen, exact CMYK and spot colours included. The background is transparent by default (the label or paper shows through); an optional background fill covers the element's box including the quiet zones.
- **FR-5 Print gain.** An optional bar width reduction (in mm or µm) narrows every bar by that amount, half on each side, while keeping every bar's centre, for presses that spread ink (flexo, some offset).
- **FR-6 Printer dots.** An optional printer resolution (for example 203, 300 or 600 dpi) rounds X to a whole number of printer dots, so a thermal or laser printer prints every bar the same width. The inspector shows the resulting X and the dots per module.
- **FR-7 Human-readable line.** Shown or hidden; font (any font the design can use, OCR-B when uploaded, a monospaced catalog font by default), size, and the standard placement of each symbology (EAN-13 and EAN-8 digits under the halves with the leading digit in the left quiet zone; UPC-A; PZN as `PZN - 12345678`; GS1 with the identifiers in brackets). Text nodes are generated, so a later font change regenerates them. For Data Matrix the line is optional below the symbol.
- **FR-8 Validation.** The value is checked while it is typed, with the encoder's reason in the user's language (wrong check digit, wrong length, character not allowed, invalid application identifier, impossible date). An invalid value never replaces the last valid geometry; the element shows an error badge. Check digits are computed when left out (EAN, UPC, PZN, GS1 GTINs) and shown in the inspector.
- **FR-9 QR drawn without overlap.** QR modules are drawn as runs merged into one even-odd path at their exact cells, in the engine and on the server, instead of one enlarged rectangle per module. The screen shows no seams (one path, no edges between neighbours) and print files get exact module sizes. Existing QR codes change only by losing the half-pixel growth.
- **FR-10 Output check.** The download menu and the print dialog list, for each barcode: an invalid or never-encoded value; X below the symbology's minimum (EAN-13 and UPC-A: 0.264 mm, the 80 % magnification; GS1 Data Matrix: 0.255 mm, the GS1 healthcare minimum; the other codes: 0.19 mm as a working minimum, adjustable per element); missing quiet zones; a bar colour of low contrast against white or not a single ink in a CMYK file; and for raster outputs (image PDF, TIFF, printing) a module narrower than two output pixels. Nothing is blocked.
- **FR-11 Editor.** **Insert > Barcode** opens a dialog: symbology, value with live validation and the computed check digit, a preview at the chosen size. The element behaves as one object (no entering the group, the generated parts are not edited one by one); its inspector section edits everything above. Duplicating and copying keep the `barcode` data.
- **FR-12 Ready for data.** The value is a field that can be bound like text, so bulk create and the serial print export (later spec) can fill it per row. Re-encoding runs in the browser; for server-side filling the same encoder bundle runs under the backend's embedded JavaScript engine, as the CRDT fold does, so the server produces byte-identical geometry.

## Out of scope here

- ITF-14 (outer cartons; it needs bearer bars and is not used on labels printed in-house), Aztec, PDF417 and the other symbologies the encoder knows: each can follow with its own placement rules.
- Serial printing (one PDF from a data file) and imposition: their own specs, which build on this one.
- securPharm or IFA PPN code layouts as templates (the GS1 Data Matrix carries the content; a ready layout can follow).
- Verification grades (ISO/IEC 15416 and 15415 need a measured print).

## Acceptance

- **AC-1** For every symbology above and several values, the generated geometry decodes to exactly the input (decoder round trip at X = 2, 3 and 4 output pixels), and the bar and space widths equal the encoder's pattern times X.
- **AC-2** A CMYK vector PDF of a design with barcodes contains the bars as filled paths in `0 0 0 1 k` (or the chosen exact colour or separation), no image, no stroke, and the bar edges at the computed coordinates.
- **AC-3** A design with barcodes opened, rendered and exported by the previous release looks identical to the new release's output (bars and text), and saving it there keeps the `barcode` data.
- **AC-4** An invalid value is refused with the reason, leaves the existing geometry untouched and shows in the output check.
- **AC-5** With a printer resolution set, every bar and space is a whole number of printer dots wide.
- **AC-6** Existing QR codes render and export unchanged except that dark modules are no longer enlarged.
