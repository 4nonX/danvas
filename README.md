# danvas

**danvas is an unofficial, modified version of [HyCanvas](https://github.com/hyscaler/HyCanvas), the open-source design platform made by HyScaler.** It is not affiliated with, endorsed by, or supported by HyScaler. Almost everything you see here, the editor, the rendering engine, the backend, the file format, presentations, video, whiteboards, docs and sheets, is HyScaler's work. danvas adds a set of changes on top, listed below, that grew out of using HyCanvas day to day for print and brand design work.

If you are looking for the original product, its documentation or its support, go to [hyscaler/HyCanvas](https://github.com/hyscaler/HyCanvas).

## Credit

- **HyCanvas** is a product of HyScaler, the trading name of NetTantra Technologies (India) Private Limited. HyScaler is a registered trademark of that company. See [NOTICE](NOTICE), [COMMERCIAL.md](COMMERCIAL.md) and [TRADEMARKS.md](TRADEMARKS.md), all unchanged from the original.
- danvas is based on the HyCanvas `development` branch, merged up to commit [`2d57eef`](https://github.com/hyscaler/HyCanvas/commit/2d57eef4) (2026-10-15) in danvas 0.5.0. The repository's history includes upstream's `development` branch, so upstream changes come in with a normal merge: `git remote add upstream https://github.com/hyscaler/HyCanvas.git`, then `git fetch upstream` and `git merge upstream/development`. The original project is at [hyscaler/HyCanvas](https://github.com/hyscaler/HyCanvas).
- Third-party components added by danvas, each with its license file next to it and listed in [NOTICE.danvas](NOTICE.danvas) (HyScaler's own [NOTICE](NOTICE) is kept word for word):
  - the Real-ESRGAN `realesr-animevideov3` model by Xintao Wang (BSD-3-Clause), converted to ONNX, run with onnxruntime-web (MIT);
  - Little CMS by Marti Maria Saguer (MIT), compiled to WebAssembly as lcms-wasm by Matt DesLauriers (MIT);
  - the PSO Uncoated ISO12647 color profile of the European Color Initiative (redistributable, shipped unaltered).
- The background remover uses [@imgly/background-removal](https://github.com/imgly/background-removal-js) by IMG.LY (AGPL-3.0), which already shipped with HyCanvas; danvas serves its model files from the instance itself.

## License

danvas is distributed under the same license as HyCanvas from v0.3.17 onwards, the [GNU Affero General Public License v3](LICENSE) (`AGPL-3.0-only`). danvas releases up to and including 0.4.8 were based on HyCanvas under the Elastic License 2.0 and remain available under those terms. In short, and without replacing the license text:

- You may use, copy, modify, self-host and redistribute it, for any purpose.
- If you distribute danvas, or let people use a modified version of it over a network, you must offer them the complete source of your version under the same license. danvas does this itself: its sign-in page links to this repository.
- The notices stay: HyScaler's `LICENSE`, `NOTICE`, `COMMERCIAL.md`, `TRADEMARKS.md`, `THIRD_PARTY.md` and `CLA.md` are unchanged, danvas's own notices are in `NOTICE.danvas`, and the image carries them in `/app`. The sign-in page still shows HyScaler's copyright line, preceded by a note that danvas is a modified version.
- The license grants no trademark rights ([TRADEMARKS.md](TRADEMARKS.md)). "HyCanvas" and "HyScaler" are used here only to say where the software comes from. danvas has its own name, logo, icons, artwork and colors, and turns HyCanvas's own brand kit (with HyScaler's logos) off by default.

**This repository contains modified versions of the HyCanvas software.** The modifications are listed in the next section.

## What is different from HyCanvas

The changes are summarized by area below; what changed in each release is in the [changelog](CHANGELOG.md).

### Identity and installation

- Own name, logo mark, favicon and app icons, sign-in and dashboard artwork, and a cobalt color theme. Internal identifiers keep their upstream names on purpose (the Go module `hycanvas/backend`, the `@hc/*` packages, the binary, the `.hyc` design file format), so designs stay compatible and upstream changes keep merging cleanly.
- Per-instance identity without rebuilding: `INSTANCE_NAME`, `INSTANCE_ACCENT` (a full color scale, the gradient, `theme-color` and the favicon are derived from one color) and `INSTANCE_LOCALE`, applied by the server to every page.
- The sign-in page links to the source code of the running version, as the AGPL-3.0 asks of a modified version served over a network; an operator of their own modified build points it at their code with `INSTANCE_SOURCE_URL`.
- The interface follows the browser's language unless the instance or the user sets one.
- An installation kit in [`deploy/`](deploy/README.md): a compose file that builds from source, a documented `.env` template, `install.sh`, `update.sh` (database backup, rebuild, version check) and a model mirror script.
- `STATIC_DATA_DIR` serves large client assets (the background-removal model) from the instance instead of a third-party CDN.
- `BUILTIN_TEMPLATES=off` hides the built-in starter templates; HyCanvas's starter brand kit is opt-in (`BRAND_STARTER_KIT=hycanvas`).

### Editor

- Reworked editor layout: a contextual toolbar above the canvas, a creation dock at the bottom, File and View menus in the header, reworked properties and selection panels, a Position panel, and entering groups by double-click.
- Crop for every element: edge and corner handles on images, and clipping crops for shapes, text, groups, scaled and rotated elements. The crop frame turns independently of the element (a handle above it, or its angle typed in), so a tilted graphic can be cut to a straight rectangle; the element stays in place. The middle handles of an image move its frame over the picture (the picture keeps its size and place); Shift scales picture and frame together.
- Replace object: swap an element for another one in place, sized by its visible content.
- Moving an image over a plain shape no longer swallows it into the shape's fill; only frames take a moved image.
- Vectorize: traces raster images into editable vector shapes, with accurate straight edges, kept thin lines and an optional learned 4x upscaling step (Real-ESRGAN, in the browser) before tracing.
- SVG images can be turned into editable shapes in place ("Make editable"), keeping their exact position, fit and crop.
- Background removal is a toolbar button with live progress, non-destructive (the original stays, a mask is stored) and restorable. The cut-out keeps the photo's full resolution, and its edge is fitted to the photo's own edges, so large photos stay sharp.
- Color picker: an eyedropper that works in every browser (falls back to sampling the canvas), opacity that applies to fills and group colors, centered popovers, and the same picker in every sidebar color field.
- Group color swatches: recolor every use of a color inside a group or selection at once.
- Copy and paste style works on groups and carries text colors.

### Templates

- Template protection: objects of a template can be protected ("content only" or "fully") for every copy made from it, also in other workspaces. Only people who may manage template protection in the workspace that set it can lift it, and the server checks every save and collaboration checkpoint against the stored design.
- Templates can be deleted by the person who created them and by owners and admins of their workspace.

### Workspaces and members

- A team workspace can take in everyone who signs in with single sign-on, at the member or viewer role, now and at every later sign-in. Higher roles are never lowered, and people removed are not added back unless invited.
- Pending invitations to people who are members by now offer to apply the invited role instead of sending the invitation again.

### Brand kits and fonts

- A workspace font library: upload font files once, use them in every font picker, embedded in vector exports.
- Brand kits with any number of named font roles, an icon collection, and colors and fonts that apply into groups.
- Brand kits export to and import from a `.brandkit.zip` that carries the logos, images and font files; a name that is already taken asks whether to replace the kit or import under another name. The format is documented in [docs/brand-kit-format.md](docs/brand-kit-format.md).

### Import and export

- PPTX import keeps exported designs editable: picture fills with crop and transparency, freeform paths, real groups, font weights encoded in font names.
- Bulk import of files and whole folder trees into dashboard folders.
- Designs and folders copy or move to another workspace, with the uploads and workspace fonts they use, from their menu or for a whole selection.
- Import from Canva through Canva's API: pick designs and whole folders in a Canva account and they arrive with their folder tree, editable through PowerPoint export where Canva allows it, as page images otherwise ([setup](docs/dashboard.md#import-from-canva)). The server runs the import: it carries on with the browser closed and after a restart, paces itself under Canva's limits, pauses at Canva's daily limit and continues by itself, and skips what is already there. Its owner follows it in the dashboard's sidebar and under Import from Canva, where the recent imports and their failed designs stay available.
- Print exports: vector PDF, image PDF, TIFF and EPS (PostScript Level 3) in CMYK through ICC color management (Little CMS) or RGB, with workspace print profiles uploaded by admins. PDFs carry the profile as output intent and can be marked PDF/X-4; vector PDF and EPS offer black in black ink only with black overprint, crop marks in registration colour, and a die line in a spot colour of its own. PNG and JPG state their resolution in the file.
- Bleed and crop marks per page, set in the page panel or the download menu and switched on or off separately: the bleed shows in the editor, and every image and print export (PNG, JPG, SVG, PDF, TIFF, EPS) can carry it, PDFs with TrimBox and BleedBox, plus crop marks in a chosen line type, color and weight.
- Export profiles and print presets: named download and print settings, personal or shared per workspace, with a default, a summary of what each does, and full management in the settings. Printing from the editor and, for one design or a selection, from the dashboard, at actual size or fitted to the paper, with bleed and crop marks.
- One rendering engine for exports: SVG, vector PDF, tagged (accessible) PDF and MP4 are drawn by the same engine as the editor, so they match it exactly. The tagged PDF adds a structure tree, alt text and a real-text layer; MP4 is encoded in the browser.
- Dashboard: folders (as a tree in the sidebar that opens and closes and lists each folder's designs), one Import menu for files, folders and Canva, previews that show the page as a sheet and redraw once images and fonts load, and download and share for one design or a whole selection (every page of every design into one zip; one person's access or view links for all selected designs at once).

### Tools

- [`tools/canva-export`](tools/canva-export): a read-only exporter that downloads a Canva account's designs as PPTX into a folder tree, for bulk migration (uses your own Canva Connect API integration).
- [`tools/esr-convert`](tools/esr-convert): the conversion of the Real-ESRGAN model to ONNX.

## Running danvas

The stack to deploy is in [`compose/`](compose/README.md): one compose file and an example `.env`. Paste them into Dockge, Arcane or Portainer, fill in three secrets, deploy. It uses the published image (`ghcr.io/4nonx/danvas`, amd64 and arm64).

Or, on any Docker host, in an empty folder:

```bash
curl -fsSL https://raw.githubusercontent.com/4nonX/danvas/main/deploy/install.sh -o install.sh
bash install.sh
```

This downloads the same stack, generates the secrets and starts danvas with its database. Settings, HTTPS, updates and building from source: [`deploy/README.md`](deploy/README.md).

For development:

```bash
cp .env.example .env          # set at least DATABASE_URL and JWT_SECRET
npm install
npm run build:packages
docker compose -f docker-compose.dev.yml up --build -d   # Postgres, backend (:8005), frontend (:3000)
```

The upstream documentation in [`docs/`](docs/README.md) describes the architecture, the file format and the features danvas inherits; it is HyScaler's text and speaks of HyCanvas. What danvas adds, and how to use it, is in [`docs/danvas.md`](docs/danvas.md). Repository conventions are in [CLAUDE.md](CLAUDE.md).

## Contributing, security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Changes that would help HyCanvas in general are best proposed upstream at [hyscaler/HyCanvas](https://github.com/hyscaler/HyCanvas).
