# danvas

**danvas is an unofficial, modified version of [HyCanvas](https://github.com/hyscaler/HyCanvas), the self-hostable design platform made by HyScaler.** It is not affiliated with, endorsed by, or supported by HyScaler. Almost everything you see here, the editor, the rendering engine, the backend, the file format, presentations, video, whiteboards, docs and sheets, is HyScaler's work. danvas adds a set of changes on top, listed below, that grew out of using HyCanvas day to day for print and brand design work.

If you are looking for the original product, its documentation or its support, go to [hyscaler/HyCanvas](https://github.com/hyscaler/HyCanvas).

## Credit

- **HyCanvas** is a product of HyScaler, the trading name of NetTantra Technologies (India) Private Limited. HyScaler is a registered trademark of that company. See [NOTICE](NOTICE) and [COMMERCIAL.md](COMMERCIAL.md), both unchanged from the original.
- danvas is based on the HyCanvas `development` branch as of commit [`437fe70`](https://github.com/hyscaler/HyCanvas/commit/437fe7096a21b9ab0846934842b89ef48289d41b) (2026-10-01). The upstream history is not included in this repository; the original project and its full history are at [hyscaler/HyCanvas](https://github.com/hyscaler/HyCanvas).
- Third-party components added by danvas, each with its license file next to it and listed in [NOTICE](NOTICE):
  - the Real-ESRGAN `realesr-animevideov3` model by Xintao Wang (BSD-3-Clause), converted to ONNX, run with onnxruntime-web (MIT);
  - Little CMS by Marti Maria Saguer (MIT), compiled to WebAssembly as lcms-wasm by Matt DesLauriers (MIT);
  - the PSO Uncoated ISO12647 color profile of the European Color Initiative (redistributable, shipped unaltered).
- The background remover uses [@imgly/background-removal](https://github.com/imgly/background-removal-js) by IMG.LY (AGPL-3.0), which already shipped with HyCanvas; danvas serves its model files from the instance itself.

## License

danvas is distributed under the same license as HyCanvas, the [Elastic License 2.0](LICENSE). In short, and without replacing the license text:

- You may use, copy, modify and redistribute it, including running it in production for yourself, your team or your organization.
- You may **not** provide it to third parties as a hosted or managed service. That right is reserved by HyScaler and requires a commercial license from them ([COMMERCIAL.md](COMMERCIAL.md)).
- You may not remove or alter the licensing, copyright or other notices of the licensor. danvas keeps them: the `LICENSE`, `NOTICE`, `COMMERCIAL.md`, `THIRD_PARTY.md` and `CLA.md` files are unchanged, and the sign-in page still shows HyScaler's copyright line, preceded by a note that danvas is a modified version.
- The license grants no trademark rights. "HyCanvas" and "HyScaler" are used here only to say where the software comes from. danvas has its own name, logo, icons, artwork and colors, and turns HyCanvas's own brand kit (with HyScaler's logos) off by default.

**This repository contains modified versions of the HyCanvas software.** The modifications are listed in the next section.

## What is different from HyCanvas

The changes are summarized by area below; what changed in each release is in the [changelog](CHANGELOG.md).

### Identity and installation

- Own name, logo mark, favicon and app icons, sign-in and dashboard artwork, and a cobalt color theme. Internal identifiers keep their upstream names on purpose (the Go module `hycanvas/backend`, the `@hc/*` packages, the binary, the `.hyc` design file format), so designs stay compatible and upstream changes keep merging cleanly.
- Per-instance identity without rebuilding: `INSTANCE_NAME`, `INSTANCE_ACCENT` (a full color scale, the gradient, `theme-color` and the favicon are derived from one color) and `INSTANCE_LOCALE`, applied by the server to every page.
- The interface follows the browser's language unless the instance or the user sets one.
- An installation kit in [`deploy/`](deploy/README.md): a compose file that builds from source, a documented `.env` template, `install.sh`, `update.sh` (database backup, rebuild, version check) and a model mirror script.
- `STATIC_DATA_DIR` serves large client assets (the background-removal model) from the instance instead of a third-party CDN.
- `BUILTIN_TEMPLATES=off` hides the built-in starter templates; HyCanvas's starter brand kit is opt-in (`BRAND_STARTER_KIT=hycanvas`).

### Editor

- Reworked editor layout: a contextual toolbar above the canvas, a creation dock at the bottom, File and View menus in the header, reworked properties and selection panels, a Position panel, and entering groups by double-click.
- Crop for every element: edge and corner handles on images, and clipping crops for shapes, text, groups, scaled and rotated elements.
- Moving an image over a plain shape no longer swallows it into the shape's fill; only frames take a moved image.
- Vectorize: traces raster images into editable vector shapes, with accurate straight edges, kept thin lines and an optional learned 4x upscaling step (Real-ESRGAN, in the browser) before tracing.
- SVG images can be turned into editable shapes in place ("Make editable"), keeping their exact position, fit and crop.
- Background removal is a toolbar button with live progress, non-destructive (the original stays, a mask is stored) and restorable.
- Color picker: an eyedropper that works in every browser (falls back to sampling the canvas), opacity that applies to fills and group colors, centered popovers, and the same picker in every sidebar color field.
- Group color swatches: recolor every use of a color inside a group or selection at once.
- Copy and paste style works on groups and carries text colors.

### Brand kits and fonts

- A workspace font library: upload font files once, use them in every font picker, embedded in vector exports.
- Brand kits with any number of named font roles, an icon collection, and colors and fonts that apply into groups.

### Import and export

- PPTX import keeps exported designs editable: picture fills with crop and transparency, freeform paths, real groups, font weights encoded in font names.
- Bulk import of files and whole folder trees into dashboard folders.
- Print exports: vector PDF, CMYK or RGB TIFF and EPS (PostScript Level 3) with ICC color management (Little CMS), black-only text, and workspace print profiles uploaded by admins.
- One rendering engine for exports: SVG, vector PDF, tagged (accessible) PDF and MP4 are drawn by the same engine as the editor, so they match it exactly. The tagged PDF adds a structure tree, alt text and a real-text layer; MP4 is encoded in the browser.
- Dashboard: folders, previews that show the page as a sheet and redraw once images and fonts load, and download and share for one design or a whole selection (every page of every design into one zip; one person's access or view links for all selected designs at once).

### Tools

- [`tools/canva-export`](tools/canva-export): a read-only exporter that downloads a Canva account's designs as PPTX into a folder tree, for bulk migration (uses your own Canva Connect API integration).
- [`tools/esr-convert`](tools/esr-convert): the conversion of the Real-ESRGAN model to ONNX.

## Running danvas

On any Docker host, in an empty folder:

```bash
curl -fsSL https://raw.githubusercontent.com/4nonX/danvas/main/deploy/install.sh -o install.sh
bash install.sh
```

This pulls the published image (`ghcr.io/4nonx/danvas`, amd64 and arm64), generates the secrets and starts danvas with its database. Settings, HTTPS, updates and building from source: [`deploy/README.md`](deploy/README.md).

For development:

```bash
cp .env.example .env          # set at least DATABASE_URL and JWT_SECRET
npm install
npm run build:packages
docker compose -f docker-compose.dev.yml up --build -d   # Postgres, backend (:8005), frontend (:3000)
```

The upstream documentation in [`docs/`](docs/README.md) describes the architecture, the file format and the features danvas inherits; it is HyScaler's text and speaks of HyCanvas. Repository conventions are in [CLAUDE.md](CLAUDE.md).

## Contributing, security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Changes that would help HyCanvas in general are best proposed upstream at [hyscaler/HyCanvas](https://github.com/hyscaler/HyCanvas).
