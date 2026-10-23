# F50 Brand graphics

A workspace's own graphics (plant silhouettes, drawings, line icons, brush strokes) belong with its brand kit, ready for everyone to place, instead of being searched for in the uploads each time. Brand kits already had collections (icons, photos, graphics), but only icons had a user interface: added one at a time from the uploads, unnamed, with no categories.

## Requirements

- **FR-1 Brand page.** The dashboard has a **Brand** page for the workspace, next to Members and Roles: one page for the whole brand, on the tabs the editor's brand panel uses (Colors, Fonts, Logos, Graphics) and Settings. Brands are chosen at the top and created empty, from a logo, from a website or from a kit file. Everyone in the workspace sees it.
- **FR-2 Categories.** Graphics are grouped in categories the managers name themselves (for example Silhouettes, Drawings, Icons): create, rename, reorder, delete. Deleting a category with graphics in it asks first and takes them out of the kit. A category is a kit collection with a name; collections without one (made before) show under their kind's name (Icons, Graphics, Photos), so nothing is lost.
- **FR-3 Upload.** Graphics are uploaded straight into a category, many at a time, by choosing files or dropping them on the page: SVG, PNG, JPEG, WebP, GIF. Each file becomes a workspace upload and joins the category. The file name, without its extension, is the graphic's name.
- **FR-4 Edit.** A graphic can be renamed (its upload is renamed), moved to another category, replaced by another file (it keeps its place; the old file stays in the uploads, where designs that use it still find it), and removed from the kit. Removing only takes it out of the kit: the file stays in the uploads, and designs that use it are unchanged.
- **FR-5 Find.** The page and the editor search the graphics by name, across categories.
- **FR-6 Place.** In the editor, the brand panel lists the kit's graphics by category, with search. A click places a graphic, and so does dragging it onto the page. An SVG is placed as editable vector shapes, named after the graphic, so it takes any fill colour, including CMYK and spot colours; any other image is placed as an image.
- **FR-7 One kit update per change.** Each change is one update of the kit: it appears in the kit's version history and can be restored from there. An upload of many files is one update after all files are in.
- **FR-8 Kit file.** The kit file (`.brandkit.zip`) carries the category names (`collections[].name`); files keep their names, so an imported graphic keeps its name.
- **FR-9 Rights.** `brand.kits` (Define the brand) changes everything on the page, the graphics included; `brand.library` (Maintain the brand library) changes the collections only, and the server refuses any other field of a kit update from a role that has only it. A migration gives the seeded permission "Brand library" to every role that held `brand.kits`, so no right changes on upgrade. The workspace font files on the Fonts tab follow `fonts.manage`.
- **FR-10 The whole brand.** Colors (add by picker or hex, role, remove), font roles, logos (add from uploads or a new file, rename, dark version, remove) and the settings (name, standard brand, locks, the brand check before export, voice, kit file, version history, delete) are managed on the page. The editor's brand panel applies the brand and links to the page; taking colours from a design's selection or page stays in the editor.
- **FR-11 Designs never depend on a kit.** Changing a kit, removing anything from it or deleting it leaves existing designs byte for byte as they are; uploads stay.

## Acceptance

- **AC-1** A manager creates the categories Silhouettes, Drawings and Icons, uploads 24 SVGs into Silhouettes in one go and sees them named after their files.
- **AC-2** Renaming, moving, replacing and removing a graphic each show at once and in the kit's version history; a member without `brand.kits` or `brand.library` sees the page read-only.
- **AC-3** In the editor, clicking a silhouette SVG places a vector group named after it; its fill can be set to a brand colour. Dragging it onto the page places it at the drop point. A PNG drawing is placed as an image.
- **AC-4** A kit with an unnamed icon collection from before shows it as Icons; nothing is lost.
- **AC-5** A kit exported and imported again keeps its categories, their names and order, and the graphics' names.
- **AC-6** A role with only `brand.library` maintains the graphics; its attempt to change colours, the name or anything else of the kit is refused by the server.
- **AC-7** Deleting a brand a design was made with leaves the design file unchanged and its uploads in place.

## Not in this spec

- Tags and per-graphic descriptions; colour variants of one graphic.
