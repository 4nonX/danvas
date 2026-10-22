# F46 Serial print

A design (a name badge, a business card, a product or pharmacy label) filled from a table, one copy per row, as one document: downloaded as one print PDF (also several on a sheet, F45) or printed. Bulk create (one design per row, kept in the workspace) stays for designs that are edited further; serial print is for printing.

## Requirements

- **FR-1 Data.** A CSV or text file (comma, semicolon or tab, found by itself; UTF-8 or the Windows-1252 that Excel writes for "CSV" on German Windows), an Excel file (.xlsx, any worksheet), or cells pasted from a spreadsheet. The first row holds the column names unless switched off. Empty rows are left out.
- **FR-2 Excel as shown.** An Excel file is read on the server (`POST /data/sheet-rows`, nothing stored): dates come out in their own date format (Excel's short date in the reader's language), numbers formatted with leading zeros keep them (a PZN `00000000` format), shared and rich strings and both date systems are handled.
- **FR-3 What fills what.** `{{Column}}` anywhere in a text is replaced, each run keeping its style. A whole text, a barcode (F43) or a QR code can take a column; elements whose name is a column's name take it by themselves. Placeholders without a column are listed and stay as they are.
- **FR-4 Codes per row.** Every barcode and QR code is encoded again from its row. A row whose code cannot be encoded (a wrong check digit, a wrong length) is left out of the document and listed with its number, the element and the reason: no copy is printed with a wrong code or the template's.
- **FR-5 Rows.** All rows, or a range; at most 5000 rows per document. A preview shows the design filled from any row.
- **FR-6 Output.** The filled document (every page of the design per row, in row order) opens in the download menu or the print dialog with all their options: CMYK, bleed and marks, export profiles, and several on a sheet with **In order**.
- **FR-7 The design is not changed.** The copies exist only for the output.

## Acceptance

- **AC-1** A CSV from German Excel (semicolons, Windows-1252, umlauts) reads correctly; an .xlsx with a date column formatted `mm.yyyy` and a PZN column formatted `00000000` gives `12.2027` and `04711146`.
- **AC-2** Placeholders and assigned texts are filled per row with their styles; each copy's barcode decodes to its row's value.
- **AC-3** A row with a wrong PZN check digit is not in the document and is listed as such.
- **AC-4** 500 rows of a 90 x 50 mm label give one vector PDF of 500 labels, or, several on A4, 50 sheets in row order.
