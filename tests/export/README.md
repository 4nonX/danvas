# Export check

Runs designs through every format of the download menu in a real Chrome and checks the files the way print software reads them. It exists because export bugs are quiet: a word missing from a logo, artwork running into the crop-mark margin, a CMYK file with RGB left in it. Each of those passed every unit test and was found only by looking at the file.

```
npm run build:packages
npm run test:export                          # the fixtures, every format
node tests/export/run.mjs --only label       # one fixture
node tests/export/run.mjs --designs DIR      # every .hyc file in DIR
    --asset-base https://your.instance       #   images load from there
```

Needs Chrome or Chromium (found at the usual paths, or set `CHROME_PATH`), Poppler (`pdfinfo`, `pdftoppm`), Ghostscript (`gs`) and ImageMagick. Every file, its rendering, the references and `report.md` land in `tests/export/out`. The command exits with 1 when a check fails. It is not part of CI: run it when changing anything an export goes through (the engine, `lib/vectorPdf`, `lib/print`, `lib/exportFormats`, fonts or images).

## What it does

`harness.ts` runs in the browser. It loads a design's images and fonts the way the dashboard download does (`whenRenderable`), then exports it through the same functions the download menu calls (`frontend/src/lib/exportFormats.ts`, `lib/vectorPdf`, `lib/print/eps`): PNG, JPG, SVG, vector PDF, image PDF, EPS and TIFF. For the print fixture it adds the sheet with bleed and crop marks, bleed only, marks only, and CMYK files (PDF/X-4, registration marks, die line, black overprint). It also draws a reference of every sheet **without viewport culling**, so an element the engine wrongly skips while exporting shows up as a difference.

`run.mjs` checks each file:

| Check | How |
|---|---|
| Looks like the reference | Rendered at 192 dpi (Poppler for PDF, Ghostscript for EPS, Chrome for SVG) and compared in 16 px blocks. Anti-aliasing passes; a missing, shifted or wrongly clipped element fails. CMYK files are compared by where there is ink, since their colours are converted. |
| Required regions | Each fixture names regions that must show something; blank there fails. Independent of the reference. |
| Sheet | PDF MediaBox, TrimBox and BleedBox; EPS bounding box; pixel size. |
| Colour | No RGB operators or images in a CMYK file; output intent; PDF/X-4 in info and XMP with PDF 1.6, trapping flag and file id; the spot colours asked for. |
| Overprint | Ghostscript separations: black text sits on the black plate and the cyan under it stays. |
| Prepress | The prepress fixture (a 50 x 100 mm label set up in mm, exact CMYK and an HKS spot colour): its CMYK PDF and EPS state the finished size and the 1.5 mm bleed to 0.01 mm, Ghostscript's plates carry the CMYK values as set (within 1 %), and the spot colour has a plate of its own. The files are prepared as the download menu does: the page, made 0.04 mm short, goes out at whole millimetres, and a band that stops at the top edge fills the bleed above it. |
| Proof and output check | The download menu's own checks on the print files: its proof's ink per plate (`lib/print/proof`) is within 3 percentage points of the plates Ghostscript separates from the CMYK PDF, and its file check (`lib/print/fileCheck`) finds nothing wrong with the CMYK PDF and EPS. |
| Resolution | The dpi PNG, JPEG and TIFF state. |

Over real designs (`--designs`) one kind of difference is not an export fault: a small raster image scaled up many times (a 150 px logo across half a poster) is smoothed differently by Chrome and by a PDF viewer. Look at such a report before suspecting the export; the download menu flags those images for print anyway.

## Fixtures

`fixtures.ts` builds them in code. Each covers something that has gone wrong before or that print shops rely on: shapes, strokes, gradients and transparency; paths drawn outside their own size (a logo word vanished through culling); text in an embedded font (the repository's Liberation Sans); placed images with and without transparency; a rotated clipped group; a 50 x 100 mm label with 1.5 mm bleed whose artwork runs past the page; and the same label set up in mm for prepress, with exact CMYK colours and an HKS spot colour.

When a bug in an export is fixed, add a fixture or an expectation that would have caught it.
