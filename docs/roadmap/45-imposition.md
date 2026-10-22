# F45 Imposition (n-up on a sheet)

Many copies of a small design (business cards, labels, name badges) placed on one printer sheet with cut marks, so they can be printed on an office or label printer and cut by guillotine or plotter, or sent to a print shop as a ready sheet.

## Requirements

- **FR-1 Where.** An option of the vector PDF and the image PDF in the download menu, and of printing on a standard paper (A4, A3, Letter) in the print dialog: **Several on one sheet**. Export profiles and print presets store it.
- **FR-2 Sheet.** Download: A4, A3, SRA3 (320 x 450 mm), Letter, or a custom size in mm. Print: the paper chosen in the dialog. Portrait or landscape is chosen to fit the most, unless fixed.
- **FR-3 Layout.** A grid of equal slots, centred on the sheet, inside the margin the printer cannot print (default 5 mm) plus, when there are marks, the room for them (4 mm long, starting 2 mm from the cut or just past the bleed), with a gap between the items (default 0: neighbours share the cut). Each item may be turned a quarter when that fits more (optional). The dialog shows how many fit per sheet, how many sheets the export makes, and a small picture of the sheet.
- **FR-4 Bleed.** Every item keeps its bleed towards the outside of the grid. Between two items the bleed reaches half the gap, so neighbours never overlap; with no gap, items butt at the cut.
- **FR-5 Marks.** Crop marks at every cut line, outside the grid in the sheet margin (in registration colour in vector PDF). The items' own marks are left out on the sheet. A die line stays on each item.
- **FR-6 Order.** **Repeat each page** fills a sheet with copies of one page, sheet by sheet (business cards); **In order** fills the slots with the pages in turn (labels with different content, serial print).
- **FR-7 Sizes.** Pages of another size than the first are laid out on sheets of their own size grid. An item larger than the usable sheet is refused with a message.
- **FR-8 Exact.** In vector PDF each item is the same vector content as the single-page export, placed by a transformation; nothing is rasterized. MediaBox and TrimBox are the sheet.

## Acceptance

- **AC-1** 90 x 50 mm cards on A4 with the defaults (5 mm margin, marks, no gap, no bleed): 10 per sheet (2 x 5, portrait), the usual business card sheet; without marks 12 (A4 landscape, 3 x 4); the layout picks the best of portrait, landscape and turned items, preferring unturned items and portrait on a tie.
- **AC-2** The vector PDF of an imposed sheet contains each item's content once per slot, transformed to the slot, clipped to its bleed, and the cut marks at exactly the trim lines.
- **AC-3** With a gap of 0 the bleeds of neighbours do not overlap; with a gap of 2 x bleed every item has its full bleed.
- **AC-4** An older profile without the setting opens with imposition off.
