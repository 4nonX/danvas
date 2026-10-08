# Changelog

All notable changes to danvas are listed here, newest first. Versions follow the `VERSION` file. Self-hosters upgrade by swapping the binary; every release keeps existing designs openable (see the zero data loss rules in `CLAUDE.md`).

## Unreleased

### Added

- Published images: every release is built for amd64 and arm64 and published as `ghcr.io/4nonx/danvas` (tags `v0.1.6`, `0.1.6`, `0.1`, `latest`) by `.github/workflows/image.yml`. A release tag must match the `VERSION` file.
- One-step install on any Docker host: `install.sh` works in an empty folder, fetches the install kit for the latest release, generates the secrets, pins the release in `.env` and pulls the images. Git, Python and a 10 minute build are no longer needed.

### Changed

- The background-removal model ships inside the image (checked against the vendor's SHA-256 at build time) and is served by the instance, so a pulled image removes backgrounds without the vendor's CDN, like the install kit's mirror did. `data/static-data` is no longer used.
- `deploy/compose.yaml` pulls the published image; building from a clone is the `compose.build.yaml` override (`install.sh --build`), and `install.sh` falls back to it when the image cannot be pulled.
- `update.sh` moves to the latest release (or the one given), pulls its image and keeps running the previous release when the pull fails.
- The image build runs its build stages natively and cross-compiles Go, so arm64 images build without emulating the toolchain.
- The model download is a Node script (`scripts/fetch-bg-model.mjs`), used by both Dockerfiles.

## 0.1.5 (2026-10-08)

### Fixed

- Effects keep their size at every scale. Drop shadows, glows, blurs and text shadows were drawn at a fixed number of screen pixels, so they shrank with the render scale: nearly invisible in vector PDF, SVG and EPS (drawn at 600 dpi), a third of their size in a 300 dpi TIFF or a PNG at 3x, and too small in the editor when zoomed in or on high-density displays. They now scale with the page, in the editor and in every export.
- Uploaded SVG images placed as images are exported at print resolution. Uploads are served without a file extension, so vector exports did not recognize them as SVG and embedded them at their small intrinsic pixel size; the design's asset list now identifies them.
- Vectorizing no longer drops a curved shape with a single sharp corner (a teardrop, for example). Its outline collapsed to two identical points during simplification and the shape disappeared from the result.
- MP4 export of a deck with mixed page sizes centers each page in the frame instead of stretching it.
- CMYK EPS no longer sets a color in RGB in its initial graphics state.
- Untitled designs get a document title in PDF and EPS instead of an empty one.
- Video export in a browser that cannot encode video says so, instead of showing the unrelated message about images from another site.
- Downloads are no longer cancelled in browsers that read the file after the click returns.
- The raster PDF export no longer reports a download when no page was rendered.
- The crop tool no longer writes state during rendering.
- The color picker's Hex label is translated.

### Changed

- EPS and TIFF files name danvas as the creating software, like PDF since 0.1.4.
- Page titles in a tagged PDF of an untitled design are localized ("Page 1" in the interface language).
- The dashboard's floating selection bar is centered with the direction-neutral idiom, so it stays centered in right-to-left languages.
- Every build reports the release from the `VERSION` file (at boot and on `/healthz`). A Docker build without a `VERSION` build argument used to report `docker`, and the release binary a bare commit; both now report `v0.1.5`, the release binary with its commit as build metadata (`v0.1.5+<commit>`). The install kit already did this.

### Translations

- Folder error messages are translated in every language, and the accessible PDF description is now in all of them (it was German only).
- British English spells "colour" in the vectorize, background and export strings, and drops entries identical to the base catalog.
- Strings of features that no longer exist were removed from every catalog.

### Development

- The i18n scripts and the right-to-left source check work on Windows (file paths).
- Literal text that is not interface copy (PDF and PostScript operators, font names, file metadata) is marked `i18n-ignore`; type specimens use the catalog.
- Stale tests updated to the shipped behavior: the layer panel shows the node type as an icon, and PPTX import keeps groups as group layers.
- New tests: effect scaling in the engine, SVG detection in vector exports, the single-corner vectorizer case.

## 0.1.4 (2026-10-07)

### Added

- Tagged (accessible) PDF is the vector PDF plus a structure tree in reading order, alt text, artifacts and an invisible real-text layer.
- MP4 export renders the deck playthrough with the present-mode compositor and encodes it in the browser.

### Changed

- Tagged PDF and MP4 now match the editor exactly.
- The PDF producer reads danvas.

## 0.1.3 (2026-10-07)

### Changed

- SVG export renders through the same engine as the editor and the vector PDF (a format-neutral vector canvas with PDF and SVG backends), so wrapping, alignment, weights and effects match.

### Fixed

- A tagged PDF of a design whose pages are all hidden draws every page instead of failing.

## 0.1.2 (2026-10-07)

### Fixed

- Outlined text in placed SVGs looks the same on every machine. Design tools export outlined text as a filled rectangle clipped by the letter outlines; the conversion only swapped it for the letter shapes after the browser's own measurement confirmed the fit, so a browser that measured curves more loosely showed bars instead of words. The clipped single-shape group now always becomes the clip shapes in the shape's fill, with no dependence on browser measurement or styling.

## 0.1.1 (2026-10-07)

### Added

- SVG text import for any font. Text is taken from the browser's own layout of the SVG: every explicitly positioned character and every style change becomes a text node placed where the browser drew it, in an auto-width box that never wraps. Referenced fonts load before layout and are measured with the engine's font stack, font lists resolve to the first family the app can render, and whitespace handling, letter spacing and font stretch carry over.
- Brand kit logo management: two-column logo cards with the dark-background version as a strip beneath; managers can add logos (from uploads or a new upload), remove them, and add or change the dark version. Cards stay light in dark mode so both previews keep their meaning.

### Fixed

- Outlined text exported as a filled shape clipped by letter outlines imports as the letter shapes instead of a solid bar.

## 0.1.0 (2026-10-07)

First release of danvas, an unofficial, modified version of HyCanvas by HyScaler, based on the hyscaler/HyCanvas development branch at commit 437fe70 (2026-10-01). Distributed under the Elastic License 2.0, like HyCanvas; LICENSE, NOTICE, COMMERCIAL.md, THIRD_PARTY.md and CLA.md are unchanged, and HyScaler's copyright notice in the app is kept.

### Added

- Own name, logo, icons, artwork and theme.
- Per-instance identity: `INSTANCE_NAME`, `INSTANCE_ACCENT`, `INSTANCE_LOCALE`.
- An installation kit in `deploy/`.
- Editor rework, crop for every element, vectorizing with a learned upscaler, editable SVG images, background removal with a self-hosted model, color picker and style tools.
- Workspace fonts and extended brand kits.
- PPTX import and bulk import.
- Print exports: vector PDF, CMYK TIFF and EPS with ICC profiles.
- Dashboard folders, download and share.

The full list of modifications is in `README.md`.
