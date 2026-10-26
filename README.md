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

The changes are summarized by area below. How to use each one is explained in the [danvas guide](docs/danvas.md); what changed in which release is in the [changelog](CHANGELOG.md).

### Identity and installation

- Own name, logo mark, favicon and app icons, sign-in and dashboard artwork, and a cobalt color theme. Internal identifiers keep their upstream names on purpose (the Go module `hycanvas/backend`, the `@hc/*` packages, the binary, the `.hyc` design file format), so designs stay compatible and upstream changes keep merging cleanly.
- Per-instance identity without rebuilding: `INSTANCE_NAME`, `INSTANCE_ACCENT` (a full color scale, the gradient, `theme-color` and the favicon are derived from one color) and `INSTANCE_LOCALE`, applied by the server to every page.
- The sign-in page links to the source code of the running version, as the AGPL-3.0 asks of a modified version served over a network; an operator of their own modified build points it at their code with `INSTANCE_SOURCE_URL`.
- The interface follows the browser's language unless the instance or the user sets one.
- An installation kit in [`deploy/`](deploy/README.md): a compose file that builds from source, a documented `.env` template, `install.sh`, `update.sh` (database backup, rebuild, version check) and a model mirror script.
- `STATIC_DATA_DIR` serves large client assets (the background-removal model) from the instance instead of a third-party CDN.
- `BUILTIN_TEMPLATES=off` hides the built-in starter templates.

### Editor

- Reworked editor layout: a contextual toolbar above the canvas, a creation dock at the bottom, File and View menus in the header, reworked properties and selection panels, a Position panel, and entering groups by double-click ([guide](docs/danvas.md#editor-layout)).
- Elements panel in rows: a search over everything, then one line per kind with your pinned and most used tiles, **See all** for the whole row, tiles and rows sorted by dragging, rows hidden at will. The tool rail takes your own order too. Both are kept with your account, the same in every browser ([guide](docs/danvas.md#editor-layout)).
- A tidier brand panel: colours by palette with adding per palette, fonts shown in themselves, one tile per logo with its versions, a line of each graphics category, rows in your own order, and the brand tools (apply, re-skin, check, version, locked regions) folded below ([guide](docs/danvas.md#brand-page)).
- Crop for every element: edge and corner handles on images, and clipping crops for shapes, text, groups, scaled and rotated elements. The crop frame turns independently of the element (a handle above it, or its angle typed in), so a tilted graphic can be cut to a straight rectangle; the element stays in place. The middle handles of an image move its frame over the picture (the picture keeps its size and place); Shift scales picture and frame together ([guide](docs/danvas.md#cropping)).
- Replace object: swap an element for another one in place, sized by its visible content ([guide](docs/danvas.md#replace-object)).
- Moving an image over a plain shape no longer swallows it into the shape's fill; only frames take a moved image.
- Vectorize: traces raster images into editable vector shapes, with accurate straight edges, kept thin lines and an optional learned 4x upscaling step (Real-ESRGAN, in the browser) before tracing. SVG images can be turned into editable shapes in place ("Make editable"), keeping their exact position, fit and crop ([guide](docs/danvas.md#vectorize-and-make-editable)).
- Background removal is a toolbar button with live progress, non-destructive (the original stays, a mask is stored) and restorable. The cut-out keeps the photo's full resolution, and its edge is fitted to the photo's own edges, so large photos stay sharp ([guide](docs/danvas.md#remove-background)).
- Color picker: an eyedropper that works in every browser (falls back to sampling the canvas), opacity that applies to fills and group colors, centered popovers, and the same picker in every sidebar color field. Group color swatches recolor every use of a color inside a group or selection at once; copy and paste style works on groups and carries text colors ([guide](docs/danvas.md#color)).
- Offline copies are checked against the server when a design opens: an outdated copy never replaces a newer design, and offline changes that never reached the server are kept as a version ([guide](docs/danvas.md#offline-copies)).

### Print and prepress

danvas is built for print work: labels, packaging, business cards, signage. How the pieces fit together, from the first page to the file for the print shop, is in [From design to print shop](docs/danvas.md#from-design-to-print-shop).

- **Exact sizes**: each design has a measurement unit (mm, cm, in, pt, px) and keeps sizes exactly, so a 50 x 100 mm label is 50 x 100 mm in every file ([guide](docs/danvas.md#units-and-exact-sizes)).
- **Exact print colors**: CMYK values and named spot colors (HKS, Pantone, white ink, varnish) that vector PDF and EPS carry as given ([guide](docs/danvas.md#exact-print-colors)).
- **Color management**: ICC profiles built in, per workspace (uploaded by admins) and personal, a color profile per design, conversion through Little CMS ([guide](docs/danvas.md#color-profiles)).
- **Barcodes**: EAN-13, EAN-8, UPC-A, Code 128, GS1-128, Code 39, PZN, Data Matrix, GS1 Data Matrix and QR Code, checked while typed (check digits, lengths, GS1 identifiers and dates), drawn as exact vector bars in 100 % black ink or any exact colour, sized in mm with their quiet zones, optionally rounded to a label printer's dots, and listed in the output check when they may not scan ([guide](docs/danvas.md#barcodes)).
- **Print files**: vector PDF, image PDF, TIFF and EPS (PostScript Level 3) in CMYK or RGB. PDFs carry the profile as output intent and can be marked PDF/X-4; vector PDF and EPS offer black in black ink only with black overprint, crop marks in registration colour, and a die line in a spot colour of its own. PNG and JPG state their resolution in the file ([guide](docs/danvas.md#files-for-print-shops)).
- **Bleed and crop marks** per page or for one export, in every image and print format; PDFs with TrimBox and BleedBox. Artwork at the edge is extended into the bleed, finished sizes can be rounded to whole millimetres ([guide](docs/danvas.md#bleed-and-crop-marks)).
- **Change format** gives any selection of designs a new size in one go, optionally with the content turned a quarter for sideways labels, saved as a version ([guide](docs/danvas.md#changing-the-format-of-designs)).
- **Proof and output check**: a soft proof with each plate, the ink coverage against the print shop's limit and the colours out of gamut, computed in the browser; and a check of the real file, its plates separated by Ghostscript on the server ([guide](docs/danvas.md#proof-and-output-check)).
- **Export profiles and print presets**: named download and print settings, personal or shared per workspace, with a default and a one-line summary of what each does. A profile can name its finished size, and the download menu then points out designs of another size or lying the wrong way ([guide](docs/danvas.md#export-profiles)).
- **Defaults per folder**: a dashboard folder names the export profile and print preset its designs open with, inherited by subfolders, so a folder of labels always downloads and prints with the label settings ([guide](docs/danvas.md#folders)).
- **Printing** from the editor and, for one design or a selection, from the dashboard: actual size or fitted to the paper, 150 to 1200 dpi (203 dpi for label and thermal printers), bleed and crop marks ([guide](docs/danvas.md#printing)).
- **Serial print**: a design filled from a CSV, Excel file or pasted cells, one copy per row, with `{{Column}}` placeholders and barcodes encoded per row, into one print PDF or print job; rows with a code that cannot be encoded are left out and listed ([guide](docs/danvas.md#serial-print)).
- **Several on one sheet** (imposition): business cards and labels on A4, A3, SRA3, Letter or any sheet, best fit with turning, gap and cut marks, in the vector PDF, the image PDF and printing ([guide](docs/danvas.md#several-on-one-sheet)).

### Approvals

- Request approval of a design from chosen people, approved by any one or by all of them; the approved design is locked against edits until it is reopened ([guide](docs/danvas.md#approvals)).
- The approval banner shows the print proof (soft proof, plates, ink coverage), so the approver sees what would print before approving.
- Print files only after approval: a workspace can hold back print PDFs, TIFF, EPS, printing and the API's print PDF until a design is approved; those who decide approvals are not held up ([guide](docs/danvas.md#print-files-only-after-approval)).

### Templates

- Template protection: objects of a template can be protected ("content only" or "fully") for every copy made from it, also in other workspaces. Only people who may manage template protection in the workspace that set it can lift it, and the server checks every save and collaboration checkpoint against the stored design ([guide](docs/danvas.md#template-protection)).
- Templates can be deleted by the person who created them and by owners and admins of their workspace.

### Workspaces and members

- Roles and permissions of your own per workspace: actions (what danvas checks) bundled into permissions, permissions into roles, all of them created, edited and deleted on one page. Nobody hands out more than they hold, the owner role is protected, every change is logged, and a command-line recovery restores a lost owner ([guide](docs/danvas.md#roles-and-permissions)).
- A team workspace can take in everyone who signs in with single sign-on, at any role but the owner's, now and at every later sign-in. Higher roles are never lowered, and people removed are not added back unless invited ([guide](docs/danvas.md#everyone-through-single-sign-on)).
- Pending invitations to people who are members by now offer to apply the invited role instead of sending the invitation again ([guide](docs/danvas.md#invitations)).

### Brand kits and fonts

- Brand graphics: a **Brand** page in the dashboard holds the workspace's own graphics in categories it names (silhouettes, drawings, icons), uploaded many at a time, renamed, moved, replaced and removed; everyone places them from the editor's brand panel, SVGs as editable vector shapes ([guide](docs/danvas.md#brand-graphics)).
- A workspace font library: upload font files once, use them in every font picker, embedded in vector exports.
- Brand kits with any number of named font roles, an icon collection, and colors and fonts that apply into groups.
- Brand kits copy into other workspaces, and into a new one as it is created: single brands or all, ticked in a list, with their uploads and fonts, behind their own right ([guide](docs/danvas.md#brand-page)).
- Brand kits export to and import from a `.brandkit.zip` that carries the logos, images and font files; a name that is already taken asks whether to replace the kit or import under another name. The format is documented in [docs/brand-kit-format.md](docs/brand-kit-format.md) ([guide](docs/danvas.md#brand-kits-and-fonts)).

### Dashboard, import and export

- Dashboard: folders (as a tree in the sidebar that opens and closes and lists each folder's designs), one Import menu for files, folders and Canva, previews that show the page as a sheet and redraw once images and fonts load, and download and share for one design or a whole selection (every page of every design into one zip; one person's access or view links for all selected designs at once) ([guide](docs/danvas.md#dashboard)).
- Designs and folders copy to another folder, or copy or move to another workspace with the uploads and workspace fonts they use, from their menu or for a whole selection ([guide](docs/danvas.md#copying-and-moving-to-folders-and-workspaces)).
- PPTX import keeps exported designs editable: picture fills with crop and transparency, freeform paths, real groups, font weights encoded in font names. Bulk import of files and whole folder trees into dashboard folders ([guide](docs/danvas.md#importing)).
- Import from Canva through Canva's API: pick designs and whole folders in a Canva account and they arrive with their folder tree, editable through PowerPoint export where Canva allows it, as page images otherwise ([setup](docs/dashboard.md#import-from-canva)). The server runs the import: it carries on with the browser closed and after a restart, paces itself under Canva's limits, pauses at Canva's daily limit and continues by itself, and skips what is already there. Its owner follows it in the dashboard's sidebar and under Import from Canva, where the recent imports and their failed designs stay available.
- One rendering engine for exports: SVG, vector PDF, tagged (accessible) PDF and MP4 are drawn by the same engine as the editor, so they match it exactly. The tagged PDF adds a structure tree, alt text and a real-text layer; MP4 is encoded in the browser ([guide](docs/danvas.md#export)).

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
