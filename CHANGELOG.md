# Changelog

All notable changes to danvas are listed here, newest first. Versions follow the `VERSION` file. After 0.1.10 no part of a version goes past 9: the next release is 0.2.0. Self-hosters upgrade by swapping the binary; every release keeps existing designs openable (see the zero data loss rules in `CLAUDE.md`).

## 0.7.0 (2026-10-22)

### Added

- **Barcodes**: Elements > Barcode inserts EAN-13, EAN-8, UPC-A, Code 128, GS1-128, Code 39, PZN (pharmacy product number), Data Matrix, GS1 Data Matrix and QR Code (with its error correction level). The content is checked while typed, with the reason when it cannot be encoded, and check digits are computed when left out. Bars are exact vector rectangles at whole multiples of the module width, in 100 % black ink by default or any colour (exact CMYK and spot colours included), with the quiet zones inside the element and an optional text line in any font. Sizes are set in mm; dragging the handles changes the module width and bar height instead of stretching the code, in one undo step. A barcode is one layer in the layers panel; Convert to shapes replaces Ungroup for it. Optional: a printer resolution that rounds the module width to whole printer dots (thermal and label printers) and a bar width reduction for presses that spread ink.
- The download menu and the print dialog list barcodes that may not scan: modules below the minimum, no quiet zones, light bars, bars in several inks, too few pixels per module in raster files and prints.
- **Serial print** (File > Serial print): the design filled from a CSV, text or Excel file or pasted cells, one copy per row, into one document for the download menu or printing. `{{Column}}` placeholders keep their text style; whole texts, barcodes and QR codes take a column; codes are encoded per row, and rows whose code cannot be encoded are left out and listed. CSV from German Excel (semicolons, Windows-1252) reads correctly; from Excel files, dates and leading zeros arrive as the spreadsheet shows them.
- **Several on one sheet** (imposition): business cards, labels and badges laid out on A4, A3, SRA3, Letter or a custom sheet, in the vector PDF, the image PDF and printing. The best fit of portrait, landscape and turned items, a printer margin, a gap (0: shared cuts), cut marks at every cut line outside the grid, each item keeping its bleed towards the outside; one sheet per page or the pages in order. The dialogs show how many fit and a picture of the sheet; profiles and presets keep the setting.
- **Print and export defaults per folder**: a folder's menu names the workspace export profile and print preset its designs (and those of its subfolders) open the download menu and the print dialog with, before anyone's own default. Set by roles with the right Set folder defaults.
- **Print files only after approval**: a workspace setting that holds back print PDFs, TIFF, EPS, printing and the API's `render.pdf` until a design's approval is granted; approvers are exempt, a reopened approval holds them back again. The approval banner has **Print proof** (soft proof, plates, ink coverage against the TAC limit) so the approver checks what would print. The approval banner's texts are now translated.
- Printing at **203 dpi** (the dot grid of most label and thermal printers) and **1200 dpi**. The resolution is now a list in the print dialog and in print presets, with what each is for; when barcodes on the pages are set up for a printer resolution, the dialog starts at it.

### Fixed

- QR codes in print files: each dark module was drawn slightly larger than its cell (to hide seams on screen), so dark areas grew. Modules are now drawn at their exact size as one shape, in the editor, in every export and on the server. Nothing changes on screen.

### Upgrading

- One new table for the folder defaults (additive; a rollback ignores it). No change to the file format: a barcode is a group of a path and text with its settings in the group's data, so earlier versions open and print it exactly.

## 0.6.0 (2026-10-22)

### Added

- **Roles and permissions** on the dashboard of every team workspace. Actions (the single things danvas checks, such as renaming a design, deleting it for good, uploading, publishing templates, managing colour profiles or setting up AI) are bundled into permissions, and permissions into roles; actions can apply to one's own items only or to everything. Roles and permissions are created, edited, duplicated and deleted on that page, and a role still in use is deleted by naming the role its members move to. Every member, invitation and the SSO sign-in get one of these roles: the selects on the Members page now list the workspace's roles, the ones added there too. A log lists every change.
- Rules the server enforces: nobody hands out a right their own role lacks, nobody changes their own role, the Owner role always has every right (it can be renamed, not changed or deleted, and only owners give it), and the last owner stays. A refused request names the missing right.
- `hycanvas workspace grant-owner <workspace> <email>` restores an owner from the server's command line when a workspace has none left.

### Changed

- Every workspace gets the roles Owner, Admin, Member and Viewer, which allow exactly what the fixed roles allowed before; existing members, invitations and SSO settings keep their role. New workspaces, the first on a fresh instance too, are created with them and their creator as owner.
- The switch for who may change the workspace's export profiles and print presets now sets that right on the Member role.
- **Custom roles** on the Members page are now called **Roles for single designs**, to set them apart from the workspace roles. They work as before.

### Upgrading

- The migration adds tables and nullable columns only. The first start seeds the roles of every workspace from its members' current roles. A rollback to 0.5.9 keeps working: it ignores the new tables and reads each member's role as before (a member of a role added in 0.6.0 is read at that role's nearest fixed level).

## 0.5.9 (2026-10-21)

### Fixed

- The dashboard no longer shifts up with a blank band below it after working in a dialog on the Members page. The cause, which 0.5.8 did not reach: a label for screen readers in the AI settings is positioned absolutely, and the dashboard's scrolling area was not a positioned box, so the label was placed against the page instead, far below the window. That made the page taller than the window, and the browser scrolled the whole page when it brought a focused field into view. The scrolling area now holds such content itself, on every dashboard page. No database change.

## 0.5.8 (2026-10-21)

### Fixed

- After editing a profile on the Members page (for example switching on crop marks, which makes the dialog taller), the whole dashboard could stay shifted up with a blank band below it. The browser scrolled the dashboard's outer frame to show a field of the dialog; that frame can no longer be scrolled, and the profile dialog now opens above the page instead of inside it. No database change.

## 0.5.7 (2026-10-21)

### Added

- **Edit** in the lists of export profiles and print presets (your own in Settings, the workspace's on its Members page): every setting of a profile in one dialog, with the fields the chosen format can carry, without going through the download menu or print dialog. Creating, renaming, the default, duplicating and deleting stay where they were.

### Changed

- Profiles are easier to find. On the dashboard's **Members** page the workspace's colour profiles, export profiles and print presets are now one section, **Print and export**, with a link to your own. Beside every profile picker (download menu, print dialog, page panel) **Manage: Mine · Workspace** leads to your own list in Settings or to the workspace's, straight to the right section; before, Manage only led to your own.
- The workspace's ICC profiles are called **Color profiles** everywhere, as in Settings (they were "Print profiles" on the Members page and in some messages). Each list now says where the other kind is kept.
- Documentation: a new section, Where profiles are kept, sets out your own against the workspace's (where, who sees them, who may change them, defaults). No database change.

## 0.5.6 (2026-10-21)

### Added

- **Change format…** for a design or a whole selection on the dashboard: a new exact size in any unit, the content scaled and spread (one factor for everything so text keeps its line breaks, the extra room shared out, colour areas along an edge stretched), laid out anew as in Magic Resize, or left as it is, and optionally turned a quarter left or right for labels that run sideways (a 90 x 40 mm label becomes an upright 50 x 100 mm one). Every design is previewed before anything changes; each is then saved as a version named after the size, so the state before stays in its version history. Designs edited live also get the change in their edit history (as a checkpoint), and this browser's offline copy of them is dropped, so an editor opened later starts from the new format. No database change.

### Changed

- **Extend artwork into the bleed** now also extends elements turned by a quarter (90 or 270 degrees).

## 0.5.5 (2026-10-21)

### Added

- **Extend artwork into the bleed**, a download option (on by default) for every format with bleed: areas, frames, clipping groups and pictures that stop at the edge of the page grow outward by exactly the bleed set, also inside scaled groups, so the bleed a print shop asks for is filled whatever the design's size or layout. Applied to a copy; the designs stay as they are. Elements it cannot extend without changing their look (turned, round, cropped) are listed in the download menu with their design and name.
- **Finished size in whole millimeters**, a download option: each design goes out at its nearest whole-millimeter size (89.96 x 39.95 mm from before exact sizes becomes 90 x 40 mm), also on a copy.
- Both are stored in export profiles, so one profile per print shop (bleed, crop marks, die line, these two) prepares any selection of designs at once. The proof and the output check show the result. No database change.

## 0.5.4 (2026-10-21)

### Added

- **Measurement units and exact sizes**: every design has a unit (millimetres, centimetres, inches, points or pixels), set in the page panel. Page size, positions and sizes, corner radius, spacing, the rulers, guides, distances and the live size while dragging are shown and entered in it; typing another unit uses it once (`10mm`, `1in`, `72pt`). Sizes are kept exactly instead of being rounded to whole pixels, so a 50 x 100 mm label is 50 x 100 mm in every export. Print formats in mm (A3 to A6, DIN long, US Letter, business card) in the page panel, for a new design, in Magic Resize and Add page; a custom size for a new design in any unit. In mm, cm, in and pt designs type sizes and line widths are in points and the arrow keys move by 0.1 mm.
- **Exact print colors**: the color picker's new **Print color** sets a color as exact CMYK values or as a named spot color (HKS, Pantone, white ink, varnish) with its own plate. Vector PDF and EPS carry them unchanged (CMYK as given, spot colors as separations, gradients between them blended in CMYK) instead of converting through the profile; "Automatic" stays the default. Brand colors keep their print values when applied and when taken from the selection into the kit, group recoloring keeps them, and the output check expects the design's spot colors.
- **Color profiles of your own**: Settings › Color profiles takes ICC profiles for yourself, usable in every workspace, next to the workspace's (admins) and the built-in one; with a personal default ahead of the workspace's. Each design gets a **color profile** in the page panel: exact print colors are shown on screen through it, and the download menu starts with it. The download menu lists your profiles, the workspace's and the built-in one, with a link to manage them.

### Data

- Design file schema 29: an optional `measureUnit` on the file (how lengths are shown; geometry stays in design px). Older versions open such files and show px. One additive migration: a new table `user_print_profiles`; nothing existing changes, a rollback to 0.5.3 leaves it unused.

## 0.5.3 (2026-10-21)

### Added

- **Copy to folder…**: designs and folders can now be copied into another folder of the same workspace, from their menu and for a whole selection in the selection bar, alongside Move to folder. The copy and move dialog lists this workspace too ("this workspace"); a copy there uses the same uploads, fonts and brand kit as the original and keeps its name, and a copied folder arrives with everything inside it. Move within the workspace is the same as Move to folder. No database change.

### Fixed

- The colour swatch in the editor's floating toolbar (page background, fill and text colour) sat 4 px above the middle of its button since 0.5.1. Colour swatches of a fixed size are now centred where they are placed.

## 0.5.2 (2026-10-21)

### Added

- **Proof** in the download menu for CMYK print files: the pages as they will print through the chosen colour profile (soft proof, paper white optional), each plate (cyan, magenta, yellow, black, the die line) in grey or in its ink, the ink coverage with the areas above the limit marked, and the colours out of gamut. Pointing at the page reads the inks there; the panel gives the highest coverage, the area above the limit and the area out of gamut.
- **Check output**: builds the file exactly as Download would and checks the file itself, its structure in the browser (CMYK only, output intent, PDF/X-4, trim and bleed box, EPS bounding box and colours, the spot colours asked for) and its real plates on the server, separated by Ghostscript as a print shop's software does, with the coverage per plate, a soft proof from the plates and the total ink coverage. The image now includes Ghostscript; `GHOSTSCRIPT_PATH` points at another binary, and without one the check is not offered.
- **Max. ink coverage (TAC)** in the CMYK settings, stored in export profiles: the limit the proof and the check measure against (empty: 300 % for uncoated, 330 % for coated profiles).
- The download menu now also points out lines thinner than 0.25 pt, text under 8 pt printed in several inks, and artwork or a coloured page background at the edge of a page exported without bleed.
- **600 dpi** in the print dialog, for sharper small text, hairlines and barcodes on 600 dpi printers. Pages too large to render at the chosen resolution in the browser (A3 at 600 dpi, for example) are pointed out with the resolution they print at; print presets store the new setting.

### Fixed

- The download button for several files said "Download N files" in English in every language.

## 0.5.1 (2026-10-21)

### Added

- **Export profiles**: named download settings (format, size, colour profile, print-shop options, bleed and crop marks) to export with the same settings again in one click. Personal ones are a user's own in every workspace; a workspace's are shared by its members. Names are unique per owner, each profile carries a description and a one-line summary of what it does, and a personal default (else the workspace's) is chosen when the download menu opens. Pick, update and "Save as new" in the download menu; rename, describe, make default, duplicate, copy a shared one into one's own and delete under Settings > Export profiles and in the workspace settings. Who may manage a workspace's profiles is a workspace setting: owners and admins (the default) or every member who may edit.
- **Print presets**: the same for printing on one's own printer, kept apart from the export profiles (own list, own settings tab, own workspace section and setting).
- **Printing**, rebuilt: a print button in the editor next to Download (also Ctrl+P and File > Print), and Print for one design or a whole selection in the dashboard (the design menu and the selection bar). It hands the printer driver a paper it has: each page's own size (label and roll printers, Save as PDF) or A4, A3 or Letter turned to fit the design; prints at the design's actual size, centred, or fitted within a printable margin, and points out pages larger than the paper; at 150, 200 or 300 dpi; with bleed and crop marks as on the pages or set for this print. Pages of different sizes keep their own paper, and no blank pages are added.
- Bleed and crop marks can be set for one download in the editor too, without changing the pages ("Set for this output"); from the dashboard, each design's own settings can be used.

### Fixed

- From the dashboard, the download menu offered only the built-in colour profile, not the workspace's uploaded ones.
- The dashboard's selection bar wrapped its labels onto two lines while there was room beside it.

- Colour swatches sized by their surroundings collapsed to a thin line, so their colour could not be seen or picked: the crop mark colour in the download menu and the page panel, and in the properties panel the gradient stops, page background, highlight, chart series, table and keyframe colours. The swatch now fills the space it is given.
- Texts that count something showed their key name instead of the text when they had no singular and plural forms, for example "editor.download_n_designs_all_pages" under the title of the download menu for several designs, and in bulk sharing, moving to a folder, brand colours added, available AI models and personal AI usage. Such a text now shows as written.

## 0.5.0 (2026-10-20)

### License

- **danvas is now licensed under the GNU Affero General Public License v3 (`AGPL-3.0-only`)**, as HyCanvas is from v0.3.17 onwards. You may use, modify, self-host and redistribute it for any purpose; whoever uses a modified version over a network must be offered its source. danvas releases up to and including 0.4.8 remain available under the Elastic License 2.0. HyScaler's `LICENSE`, `NOTICE`, `COMMERCIAL.md`, `CLA.md` and the new `TRADEMARKS.md` come over unchanged.
- The sign-in page links to the source code of the running version (its release tag), on every screen size. An operator running their own modified build points the link at their code with the new setting `INSTANCE_SOURCE_URL`.
- The image carries the license and notices in `/app` and is labelled `AGPL-3.0-only`.
- Following HyCanvas's new trademark policy (`TRADEMARKS.md`) for a renamed fork, the sign-in page keeps HyScaler's copyright notice ("© 2026 HyScaler.") but no longer says "HyCanvas is a HyScaler product". The note that danvas is an unofficial, modified version of HyCanvas stays.

### From HyCanvas

Merged HyCanvas `development` up to 2026-10-15:

- **Personal AI provider**: each user can connect their own key in their settings, tested before it is saved. A workspace's own provider still takes precedence; a workspace admin can turn personal keys off. Adds three tables and one defaulted column (additive; a rollback to 0.4.8 ignores them).
- A selected image suggests its own colours for the brand palette.
- A template can replace the current page or be added as a new one, by choice.
- Dashboard: search results say what matched (highlighted titles, the number of matches, matching templates) and lead the page; "Start a design" groups its formats by purpose, with Blank (opening the size picker) and Import in a group of their own.
- Editor: "Add page" stays clear of the zoom control; `next dev` no longer rewrites `frontend/AGENTS.md`.

### Kept from danvas

- A duplicated design stays in its folder, design cards keep their relative date and folder, and the compact format tiles stay; reloads after deleting, importing or moving designs now keep the active search.

## 0.4.8 (2026-10-20)

### Fixed

- EPS replaced every umlaut, parenthesis and backslash in a spot colour's name with "?": a die line or spot colour named "Prägung" reached the print shop as the separation "Pr?gung", a different plate from the one asked for. The name is now written byte for byte as in the PDF. The file title ("Design (copy)" became "Design ?copy?") is written the same way.

## 0.4.7 (2026-10-20)

### Added

- **danvas file (.hyc)** in the download menu, next to the other formats (until now only in the editor's File menu).
- **Export check in the download menu**: before the file is made, the menu lists what the chosen format would lose, with page and element. A font that is unknown here or did not load (the text is drawn in a fallback font); an image that did not load; for SVG, vector PDF and EPS a font with no file to outline the text from (it becomes a picture in the file); for PDF, TIFF and EPS an image placed at under 150 dpi. The download is never blocked.
- **Export check suite** (`npm run test:export`, `tests/export`): exports designs through every format in a real Chrome and checks the files as print software reads them: the rendering against the editor (drawn without culling), page boxes, CMYK without RGB, output intent and PDF/X-4, spot colours, black overprint on the separations, resolution in the file. Run by hand after changes to the export; it also runs over a folder of real `.hyc` files.

### Fixed

- Bold, semibold and italic text could come out in a fallback font in downloads from the dashboard (PNG, JPG, TIFF, image PDF): of each web font only the regular face was loaded before drawing, the others only once the canvas first asked for them. Every face a design uses is now loaded, and the export waits for all of them. The editor's download waits the same way.
- A font uploaded into a design counted as loaded while its file was still on the way, so a dashboard download could draw that text in a fallback font.
- Bold or italic text in a font that has no such face (an uploaded font with one file, a workspace font without a bold or italic face, a catalog font without that weight) came out regular in SVG, vector PDF and EPS, while the editor showed it bold or slanted: the browser synthesizes the missing face, the export took the nearest real one. The exports now synthesize it the same way (slanted outlines, and the outline also stroked in the text colour, as wide as the browser makes it on that system). Text in a synthesized bold that is translucent or filled with a gradient is placed as an image instead, which looks the same.

## 0.4.6 (2026-10-20)

### Fixed

- Parts of a design could be missing in the editor and in every export: a path whose points lie outside its own size (as paths from some imported SVG logos do, keeping the drawing's coordinates) was culled as off-screen whenever its size box lay outside the visible area, even though its drawing was in view. In one logo the middle word disappeared this way. A path's box now takes in its points and handles; paths whose points lie within their size keep exactly the box they had.

## 0.4.5 (2026-10-20)

### Added

- Vector PDF in CMYK: the colours go through the chosen ICC profile (and rendering intent), images too, and the profile is embedded as the PDF's output intent. Every shape, outlined text and graphic stays an object of its own, so a print shop can open the file and change a colour. Optionally marked **PDF/X-4** (version, XMP metadata, trapping flag, page boxes), with transparency kept live.
- Image PDF in CMYK, with the output intent and optionally PDF/X-4; it is now written by danvas itself instead of jsPDF.
- **Black in black ink only** for the PDF as for EPS, and **overprint black**: pure black prints over what is under it (in EPS as the Black separation, since PostScript has no overprint mode).
- **Crop marks in registration colour** (the separation "All", on every plate) in vector PDF and EPS.
- **Die line**: a cut or punch contour along the trim in a spot colour of its own, named as the print shop calls it ("Stanze", "CutContour"), with a corner radius, overprinting and in a PDF on its own layer. Vector PDF and EPS.
- PNG and JPG state their resolution in the file header, so print software opens them at the page's physical size; the size row shows the resolution and offers **300 dpi**.
- A table in `docs/danvas.md` lists which print option each format can carry.

### Notes

- Checked against a print shop's Illustrator reference file: the PDF with 1.5 mm bleed and no marks has the same sheet size to the thousandth of a point, carries the output intent and PDF/X-4 marking, and separates (Ghostscript) into cyan, magenta, yellow, black and the die line's own plate, with the registration marks on every plate and black text overprinting. No schema or database change.

## 0.4.4 (2026-10-20)

### Fixed

- Number fields took "1,5" as invalid and silently went back to the previous value, so a decimal value typed with a comma (as usual in German) could not be entered: a crop mark gap or a bleed of 1,5 mm stayed at 3 mm. A decimal comma now counts as a decimal point in every number field.
- A crop mark gap smaller than the bleed was raised to the bleed, so marks could not come closer to the cut than the bleed. The gap now applies exactly as set; with a smaller gap the marks lie over the bleed, which is cut away with them.

## 0.4.3 (2026-10-20)

### Fixed

- Downloading several designs from the dashboard with bleed and crop marks gave them only to the designs that had set them themselves; the others came out as the bare page. From the dashboard the download menu now holds one bleed and one set of crop marks (with all their settings) for every design exported, starting from what the first of them sets. The designs themselves are not changed. In the editor the menu still edits the pages' own settings.

## 0.4.2 (2026-10-20)

### Added

- Designs and folders copy or move to another workspace. A design's and a folder's menu have **Copy to workspace…** and **Move to workspace…**, and the selection bar has **To workspace…** for several at once. The dialog picks the workspace (any the user is at least a member of) and a folder there, shows progress, and lists what could not be transferred.
- The uploads the designs use are copied into the target workspace and the designs point at the copies, so they export there and survive the originals being deleted; an upload shared by several designs is copied once. Workspace fonts they use come along when the user is an admin of the target, otherwise the dialog names the missing families. A brand kit assignment the target does not have is dropped. Folders arrive with their sub-folders and designs.
- Moving puts the originals in the trash once copied (restorable) and removes the source folders it emptied. Version history, comments and share links stay with the originals.
- API: `POST /api/v1/designs/transfer` (`{designIds, folderIds, targetWorkspaceId, targetFolderId, move}`), run as a job polled through `GET /api/v1/jobs/{id}`.
- All new texts are translated into every interface language.

### Notes

- No schema or database change.

## 0.4.1 (2026-10-20)

### Added

- Bleed and crop marks, set per page and each switched on or off on its own. With nothing selected, the page panel has a **Print** section: the bleed (on/off, in millimetres), and crop marks (on/off) with their line type (solid, dashed, dotted), color, weight, length and gap to the cut. **Apply to all pages** copies a page's settings to the whole design.
- The editor shows the bleed as a dashed red line around the page. The page background reaches into it, and content pulled past the page edge stays visible up to it instead of being cut off at the edge.
- The download menu has the same settings for the pages being exported: bleed and crop marks, each switched on or off for the export, with their values editable there (stored on those pages, as in the page panel). They apply to every image and print format: PNG, JPG, SVG, PDF (vector and image), TIFF and EPS. A file can have the bleed only, the marks only, both, or neither. Marks without the bleed start at their gap from the cut, and artwork then ends at the cut. PDFs state the finished size as TrimBox and the bleed as BleedBox. Artwork that runs further past the page than the bleed ends at the bleed line, and crop marks always start outside the bleed, so the two never overlap. The accessible PDF, PPTX, Markdown and the animation and video formats stay at the bare page.
- All new texts are translated into every interface language.

### Notes

- Schema v28 (additive): a page gains optional `printMarks`, and the existing `bleed` is defined as the bleed on every side in design px. Existing designs keep their version and open unchanged. Designs created on 0.4.1 carry v28; going back to 0.4.0 still opens every design, but 0.4.0 refuses to save designs created on 0.4.1.
- The server's embedded composer and PowerPoint converter bundles are rebuilt for v28.

## 0.4.0 (2026-10-16)

### Added

- Brand kits export to a file and import from one. In the Brand panel, managers choose **Export** to save the kit as a `.brandkit.zip` with its colors (print values and spot colors included), fonts and the workspace font files they use, logos with their dark and light versions, icon, photo and graphics collections, voice and controls. **Import** loads such a file into the workspace: it uploads the logos, images and fonts and creates the kit. When a kit of the same name exists, the import shows both side by side and asks whether to replace it (its earlier state stays in the version history) or to keep both under another name.
- The file format is documented in `docs/brand-kit-format.md`, with an example and the steps to write a kit by hand. A bare `brandkit.json` without files imports too.
- All new texts are translated into every interface language.

### Changed

- Brand panel: the dark-background version of a logo is shown at the same size as the light one, instead of in a narrow strip below it.

### Notes

- No schema or database change: export and import use the existing brand kit, upload and workspace font interfaces.

## 0.3.9 (2026-10-16)

### Fixed

- Images with a removed background no longer lose resolution: the cut-out image was drawn from a copy at most 2048 pixels wide, so large photos turned soft. It is now drawn at the photo's full size wherever it is shown that large (an export, a close zoom), and at a lower size only for small previews. This applies to images already cut out, without doing it again.

### Changed

- Remove background fits the edge of the cut-out to the photo's own edges. The model works on a 1024 pixel copy of the photo, so on a large photo its edge came out blurred; the edge is now sharpened against the full-size original (a guided filter). It takes about a second more on a 24 megapixel photo. Images cut out before keep their edge until the background is removed again.

### Notes

- No schema or database change.

## 0.3.8 (2026-10-16)

### Fixed

- Members: sending an invitation again to someone who has become a member in the meantime (for example by signing in through single sign-on) said only that the email could not be sent. It now says that the person is already a member and that their role is changed in the list.

### Changed

- Members: a pending invitation to someone who is a member by now says so ("Already a member as Member; invited as Admin") and offers **Apply role** instead of Resend: it gives them the invited role, if higher, and withdraws the invitation.
- Members: the remaining English texts of the page are translated (the hint below the invitation field, expiry times such as "in 3 days", the delete warning, confirmations and the labels for screen readers).

## 0.3.7 (2026-10-16)

### Added

- A team workspace can take in everyone who signs in with single sign-on. Under Members, owners and admins switch on "Add everyone who signs in with single sign-on" and pick the role (member or viewer). Everyone who already has an SSO account joins at once, and everyone signing in through SSO later joins at sign-in. Nobody's higher role is lowered; people removed from the workspace (or who leave it) are not added back, and an accepted invitation brings them back. Switching it off keeps everyone who is already in.
- API: `GET` and `PUT /api/v1/workspaces/{id}/sso-join` (`{"role": "member" | "viewer" | ""}`; the answer to `PUT` says how many people were added).
- All new texts are translated into every interface language.

### Notes

- New tables `workspace_sso_join` and `workspace_sso_join_exclusions` (additive; a rollback leaves them unused and keeps the memberships already made).

## 0.3.6 (2026-10-16)

### Added

- The crop frame turns independently of the element it crops. While cropping, drag the round handle above the frame, or type the frame's angle in the crop bar; Shift snaps to 15 degree steps. The element stays exactly where it is on the page: a turned leaf can be cut to a straight rectangle, a straight photo to a tilted one. Works on every element, turned, stretched, mirrored or skewed, and on groups, also inside stretched groups. The turned frame can still be trimmed at all eight handles and moved. One undo step.
- Images that use the image crop (straight, unscaled) get a "Rotate frame" button in the crop bar that switches to the turnable frame.
- All new texts are translated into every interface language.

### Notes

- No change to the design file format: a turned frame is the existing clipping group with its own angle. Where the element is stretched unevenly, what is inside the frame may carry a skew, which the format has always had.

## 0.3.5 (2026-10-13)

### Fixed

- Import from Canva: at Canva's daily export limit a run now pauses for at least an hour. Canva sends a "retry after" of about a minute with that limit, and the run trusted it: every few minutes it resumed, read the whole library again, was refused again and paused again, all day, importing nothing and sending Canva hundreds of pointless requests. Nothing was imported twice and nothing was lost.
- A resumed run no longer asks Canva again about designs it already found to have no export format. They stay in the list of failed designs and are tried again when you start a new import.
- Designs without an export format no longer take up a place in the pacing of exports, so a run with many of them reaches the exportable designs sooner.

## 0.3.4 (2026-10-12)

### Changed

- The sidebar's folder tree also shows the designs: open a folder by its arrow and its sub-folders and then its designs are listed below it, like in a file manager. Click a design to open it, or drag it onto another folder to move it. A folder with many designs lists the first 50 and then "+N", which opens the folder. While a search is showing, the tree lists folders only.
- Every folder with anything in it now has an arrow, not only those with sub-folders. On an empty folder, a click on the space where the arrow would be opens the folder instead of doing nothing.

## 0.3.3 (2026-10-12)

### Changed

- Projects: one Import button opens a menu with the three ways to import (files, a folder, from Canva), each with a line saying what it does, instead of three buttons that pushed the toolbar onto a second row. The dot for a running Canva import sits on that button and on its menu entry.
- Design cards and rows say when a design was last edited the way people do ("5 minutes ago", "yesterday"), in your language; past a week it is the date. The exact date and time show on hover.
- A design card's title takes up to two lines before it is cut, and the full title shows on hover.
- Home: the labels of the "Start a design" tiles take two lines instead of being cut ("Instagram post", "Desktop wallpaper").
- Home: the decorative artwork next to the greeting only shows on wide screens. On smaller ones it sat on top of the greeting's text.
- Sidebar, dark mode: the entry you are on is clearly highlighted, and the light decorative shapes no longer show through the import line and the storage meter.

## 0.3.2 (2026-10-12)

### Changed

- The dashboard's sidebar shows the folders as a tree. The arrow next to Projects hides or shows the whole folder list; a folder with sub-folders has its own arrow, and its sub-folders appear indented below it. The way to the folder that is open shows by itself. What you opened and closed is remembered per workspace. Every row takes designs and folders dropped on it.
- The sidebar no longer stops at 12 folders: all of them are listed. Only the navigation scrolls, so the logo, the workspace switcher, the Canva import line and the storage meter stay in place.
- The two decorative marks that floated among the sidebar's entries are gone.
- Folder tiles always show their number of designs, 0 for an empty folder, instead of the word "Empty" on some and counts on others.

## 0.3.1 (2026-10-12)

### Changed

- Import from Canva: the progress counts what is left to import ("12 of 340 designs to import"). Designs of the selection that are already in danvas no longer inflate that number; they are counted as "Already imported" as soon as the folders are read.
- Import from Canva: the floating progress panel is gone, so an import no longer covers anything while you work, least of all in the editor. While one of your imports is going, the dashboard's sidebar shows a line for it above the storage meter and the Import from Canva button carries a dot; click the line for the details or to stop it. As before, only you see your own imports.
- Import from Canva lists your running and recent imports at its top (the last 20), also those dismissed from the sidebar, so an import and its failed designs can always be looked up again.
- A design Canva offers neither as a full PowerPoint nor as images now says which formats Canva does offer for it (for example `pdf, pptx [1,3]`), in the list of failed designs and in the server log. As before, it is tried again on every later run.
- API: `GET /api/v1/canva/runs?all=1` returns the caller's 20 most recent imports, dismissed ones too; runs carry `dismissed`.
- All new texts are translated into every interface language.

## 0.3.0 (2026-10-12)

### Changed

- Import from Canva runs on the server. Once started, the dialog, the tab and even the browser can be closed: the import carries on, and its progress shows at the bottom right on every page and on every device you are signed in on. Stop it from there (it stops after the design it is on), or dismiss it when it has ended.
- Canva's daily export limit no longer ends the import: it pauses, the progress says when it continues, and it continues by itself.
- A server restart does not lose an import: it continues where it was, without importing anything twice.
- Starting another import while one runs queues it; it begins when the first one ends.
- The import checks before each design that you may still add designs to the workspace, and stops with a reason when you may not, or when your Canva account was disconnected.
- All new texts are translated into every interface language.

### Technical

- New tables `canva_import_runs` and `canva_import_run_designs` (additive; a rollback to 0.2.5 leaves them unused). The server converts Canva's exports with the same PPTX and image page importers as the browser, bundled for the Go backend (`backend/internal/pptxconv`, built by `npm run gen:pptx-convert`).
- API: `POST /api/v1/workspaces/{id}/canva/runs`, `GET /api/v1/canva/runs`, `POST /api/v1/canva/runs/{runId}/stop` and `.../dismiss`.

## 0.2.5 (2026-10-12)

### Changed

- Import from Canva runs in the background: once started, its window can be closed and you keep working anywhere in danvas (other folders, the editor, settings) while designs arrive. A small progress indicator at the bottom right shows how far it is, or that it is waiting for Canva; click it to open the details again or stop the run. When it finishes, the indicator shows how many designs came in, were skipped or failed, until you dismiss it.
- The run still happens in the browser tab: the browser now asks before you close or reload the tab while it runs. Running the import again still continues where it stopped.
- While an import runs, "Import from Canva" opens its progress instead of a second selection.
- All new texts are translated into every interface language.

## 0.2.4 (2026-10-09)

### Changed

- The middle handles of an image move its frame over the picture instead of scaling it: drag the left handle in and less of the picture's left shows, while the picture keeps its size and its place on the page; drag out again to show more, up to the edge of the image file. A frame that was much larger than what it shows is trimmed this way without the crop tool. One undo step per drag; Escape abandons it.
- Hold Shift on a middle handle to scale picture and frame together, as the middle handles did before. The corner handles still always scale. The middle handles no longer distort an image.
- Images that leave empty space in their frame (fit "contain" or "none") scale proportionally from their middle handles, as before, without distorting.

## 0.2.3 (2026-10-09)

### Added

- Templates can be deleted: in Templates, the trash button on a template's card, after a confirmation. Allowed for the person who created the template and for owners and admins of its workspace; built-in templates cannot be deleted. Designs already made from the template stay as they are. When it is the workspace's last template, the confirmation says what that means for template protection (people outside the workspace can then no longer add its protected objects to a design that has none yet).
- API: `DELETE /api/v1/templates/{id}`; template listings carry `canDelete` and `lastInWorkspace` for the caller.
- All new texts are translated into every interface language.

## 0.2.2 (2026-10-09)

### Security

- Template protection can no longer be bypassed by a crafted save. A save is judged at the stored file's version: the incoming file is migrated first, so labelling it with an older version or none no longer skips the comparison. Objects added to, removed from or reordered inside a protected group count as a change. A save may add or change a lock on an existing object only for the design's own workspace, and only by someone who may manage its locks; new objects (a duplicated page, an applied template, reused slides) may carry another workspace's locks only when that workspace already protects something in the design, publishes templates, or counts the saver as a member. A lock for a workspace that does not exist is refused.
- Checkpoints of the collaboration history are checked like saves on designs with template locks: the full state is folded into a design file and judged against the stored one, and a checkpoint that cannot be checked is refused. Live edits relayed between collaborators are not yet checked; a forbidden live change still cannot be saved by someone who may not lift the lock.
- From upstream HyCanvas (2026-10-08): five regular expressions that a hostile string from a model or an uploaded file could make very slow (deck outlines, kit rendering, SVG transforms) no longer re-scan the string from every position.
- From upstream HyCanvas (2026-10-08): dependency security updates. Next.js 16.3.3 to 16.3.8 (past the remote code execution fix in its image response in 16.3.6), eslint-config-next to match, and patched versions of brace-expansion, dompurify, sharp, source-map-js, shell-quote and fast-uri. `npm audit` reports nothing for the application's dependencies.
- Import from Canva: the return path after connecting refuses every control character, not only line breaks (a tab could turn "/<tab>/host" into "//host" in a browser).

### Changed

- The CI workflow runs the tests before it builds an image: package, frontend and Go tests (the Go database tests against Postgres with all migrations), the type check, lint and the generated-file checks. A commit whose tests fail is neither built nor published. It also checks that `package.json` carries the version in `VERSION` (it said 0.1.0 until now).
- `NOTICE` is HyScaler's file again, word for word. danvas's additions (the bundled interface font, the vectorizer model, the colour engine and profile) moved to `NOTICE.danvas`; since 0.2.0 one of HyScaler's lines had been reworded.

## 0.2.1 (2026-10-09)

### Added

- Import from Canva: in Projects, "Import from Canva" lists a connected Canva account's folders and designs; tick single designs, whole folders or everything, and they arrive in the open folder with their folder tree. Designs come over editable through Canva's PowerPoint export where Canva offers it for every page, otherwise as one image per page. Exports are paced under Canva's limits (a pause when Canva asks to slow down, a stop at its daily limit), and running the import again skips what is already imported, so a large library is brought over across several runs.
- Each workspace registers its own Canva integration (Client ID and secret, stored encrypted with `AI_SECRET`) under Members, Canva import, which shows the redirect URL and scopes to enter in Canva's developer portal. Every member connects their own Canva account (OAuth with PKCE; tokens encrypted, never sent to the browser). Setup in [docs/dashboard.md](docs/dashboard.md#import-from-canva).
- Database: four new tables (`canva_integrations`, `canva_connections`, `canva_oauth_states`, `canva_imports`), added by migration on start. Nothing existing changes; the design file format is unchanged.

## 0.2.0 (2026-10-08)

### Changed

- The "Verify your email" banner on the home page only appears when the instance can send email; without an email server the link could never arrive, so it only nagged. When it does appear, dismissing it is remembered. The sign-in configuration (`/api/v1/auth/providers`) reports `emailDelivery` for this.
- The interface font, Plus Jakarta Sans, ships with the app (npm package `@fontsource-variable/plus-jakarta-sans`) instead of being downloaded from Google Fonts during the build. Builds no longer depend on Google: a failed font download had made a release build fail at random, and offline builds from source now work.
- Every version tag gets its GitHub release page automatically, once its images are published, with the version's changelog section as release notes. 0.1.8 and 0.1.9 were tagged and published without one, so GitHub kept naming 0.1.7 the latest release, and `install.sh` and `update.sh`, which look the latest release up there, stayed on 0.1.7. A tag whose version has no changelog section now stops the build before it starts.

## 0.1.10 (2026-10-08)

### Fixed

- Updates show up without a hard reload. Pages, translations and icons were sent without caching instructions, so a browser could keep a page from before an update, and that page kept loading the previous version's code (a refreshed instance still showed the old interface). They are now revalidated on every load against a fingerprint of their content: unchanged files cost a tiny "not modified" reply, changed ones arrive at once. The versioned files under `/_next/` stay cached for good.
- `update.sh` and `install.sh` no longer mistake the folder above the stack for a danvas clone. A stack kept inside another git repository (a GitOps repository, for example) had `update.sh` fetch and check out danvas release tags in that repository, and after a failed image pull build that repository's own Dockerfile and keep doing so. The scripts now treat the parent as a clone only when it has danvas's own files.
- danvas built for Windows served a "not found" page for the home page and translation overrides: URL paths were cleaned with the operating system's path rules instead of URL rules.
- The AI deck composer in the backend produced designs stamped with the previous file format version since 0.1.9; its bundle and test fixture are regenerated, and the fixture script works on Windows.

## 0.1.9 (2026-10-08)

### Added

- Replace object: select an image or a vector graphic (a placed logo, icon or SVG) and choose "Replace" in the toolbar above the canvas or in the element's "..." menu. Pick a brand kit logo (dark-background versions included), a workspace upload, or a new file from your device. The replacement takes the old object's place in the layer order, keeps its opacity, blend mode, effects, animation and link, and is one undo step.
- Sizing follows what is visible: transparent margins and solid background plates of logo files are left out. A photo replacing a photo fills the same frame; otherwise the new content gets the old content's visual weight (equal visible area, at most 1.5 times its width or height), centred on it or flush with the page or group edge it touched. Right after a replace the toolbar offers "Optical", "Fit" and "Fill" to switch.
- Template protection: objects of a design can be protected so that designs made from it keep them as they are. Choose the shield in the layers panel or "Template protection" in an element's "..." menu, then "Content only" (the text or picture may change, its position, size and design stay) or "Full" (nothing changes). A protected group protects everything in it. "Only protected objects" in the layers panel lists them.
- The protection travels with the design: copies, designs made from it as a template and copies in personal or other workspaces keep it, and only the workspace that set it can lift it. Objects copied out with copy and paste or duplicate are free.
- Whoever runs into a protected object gets a message saying what is protected, by which workspace, and whom to ask (that workspace's owners and admins, with their email address).
- The protection applies to the people who may change it too, so a template is not changed by accident. They lift it for themselves in one design with "Edit template" and turn it back on with "Protect again".
- New right "Manage template protection" (owners and admins have it; custom roles can grant it).
- The server refuses a save or a version restore that changes protected objects for someone who may not, so the protection holds outside the editor as well.
- All new texts are translated into every interface language.

### Changed

- Design file format version 27: nodes may carry `templateLock`. The step from version 26 changes nothing in existing files.

### Fixed

- The top resize handles and the rotate handle of an object at the top edge of a page could not be grabbed: the page's title and tools lay over them and took the click. The handles of a selection (and of the crop tool) now sit above the page headers.
- Renaming or moving a folder with an invalid name or target showed the generic "That request could not be processed". It now says what is wrong, in every interface language.

## 0.1.8 (2026-10-08)

### Fixed

- PowerPoint import keeps the slide background when it is defined on the slide layout or master instead of the slide itself. Canva's exports do exactly that (a theme reference to the white background colour), so their pages came in without any background.
- Pages without a background no longer look transparent in previews and exports. The dashboard previews, page thumbnails, minimap, presenter thumbnails, print, the shared view, the slide pickers and PNG/JPG export paint a white page first, but the renderer cleared it again before drawing; a JPG of such a page could come out black. They now keep the white page.

## 0.1.7 (2026-10-08)

### Changed

- The home page's "Start from a template" section is collapsible and starts collapsed, so your own designs lead the page; it remembers being opened. Collapsed, no template thumbnails are loaded.

### Fixed

- Dark mode: status colors (warnings, errors, success and info callouts, badges, the "Connect an AI provider" pill and about 190 more places) were light-mode tints that stood out as bright patches. The theme now maps them for the dark chrome the way it maps the grays: tints become dark, text shades light, solid colors stay. Document surfaces pinned light keep the light colors.
- Dark mode: the open list of a native dropdown showed light text on white; every dropdown's list now uses the dark surface and text colors.
- The format and tone dropdowns of the home page's AI prompt are styled like the rest of the prompt bar instead of as native boxes.
- Buttons that darken on hover (the danger button and a few others) brighten instead in dark mode, where their darker shade is now light.
- `npm run gen:theme:check` no longer reports generated files as out of sync on Windows checkouts, where they only differ in line endings.

## 0.1.6 (2026-10-08)

### Added

- A ready-to-deploy stack in [`compose/`](compose/README.md): `compose.yml` and an example `.env`, to paste into Dockge, Arcane or Portainer or to run with `docker compose up -d`. Fill in three secrets and deploy; a missing secret stops the deploy with a message naming it. The same file is `docker-compose.yml` at the repository root (so `docker compose up -d` works in a clone) and `deploy/compose.yaml`; CI keeps all copies identical.
- Images built from source by GitHub Actions (`.github/workflows/image.yml`) for amd64 and arm64 and published as `ghcr.io/4nonx/danvas`: every release (tags `v0.1.6`, `0.1.6`, `0.1`, `latest`; the tag must match the `VERSION` file) and every push to main (`main`, `sha-<commit>`, reporting `v<VERSION>+<commit>`). Pull requests are built and checked without publishing.
- Deploy check before publishing: each image is started through `deploy/compose.yaml` with Postgres and must report its version on `/healthz`, serve the background-removal model and load the app.
- The image presents itself like a packaged app: name, description, license, documentation and source links, the danvas icon and a web-UI link (OCI, Unraid and Artifact Hub labels; GHCR shows the description and license of the multi-arch image).
- `PUID`/`PGID` (default 1000) choose the user the app runs as; `TZ` sets the time zone (tzdata is now in the image).
- An image reference in `deploy/README.md`: tags, platforms, port, volume, user, health check, variables, a single-container `docker run`, and setup in Portainer, Unraid and Synology.
- One-step install on any Docker host: `install.sh` works in an empty folder, fetches the install kit for the latest release, generates the secrets, pins the release in `.env` and pulls the images. Git, Python and a 10 minute build are no longer needed.

### Changed

- The background-removal model ships inside the image (checked against the vendor's SHA-256 at build time) and is served by the instance, so a pulled image removes backgrounds without the vendor's CDN, like the install kit's mirror did. `data/static-data` is no longer used.
- `deploy/compose.yaml` pulls the published image; building from a clone is the `compose.build.yaml` override (`install.sh --build`), and `install.sh` falls back to it when the image cannot be pulled.
- The compose file passes the main settings explicitly (with the template's defaults), so stacks work in tools that keep variables without writing a `.env` file; optional extras still come from `.env`. It needs Docker Compose 2.24 or newer, which `install.sh` checks.
- `update.sh` moves to the latest release (or the one given), pulls its image and keeps running the previous release when the pull fails.
- The image build runs its build stages natively and cross-compiles Go, so arm64 images build without emulating the toolchain.
- The model download is a Node script (`scripts/fetch-bg-model.mjs`), used by both Dockerfiles.
- The app no longer runs as root inside the container. On start, files in the storage volume owned by someone else (written by earlier images as root) are handed to the app user, so existing installs keep working.

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
