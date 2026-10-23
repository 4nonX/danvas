# F50 Brand graphics

A workspace's own graphics (plant silhouettes, drawings, line icons, brush strokes) belong with its brand kit, ready for everyone to place, instead of being searched for in the uploads each time. Brand kits already had collections (icons, photos, graphics), but only icons had a user interface: added one at a time from the uploads, unnamed, with no categories.

## Requirements

- **FR-1 Brand page.** The dashboard has a **Brand** page for the workspace, next to Members and Roles. It shows the workspace's brand kits (choose one; create one when there is none) and manages the kit's graphics. Everyone in the workspace sees it; people whose role may manage brand kits (`brand.kits`, owners and admins by default) change it.
- **FR-2 Categories.** Graphics are grouped in categories the managers name themselves (for example Silhouettes, Drawings, Icons): create, rename, reorder, delete. Deleting a category with graphics in it asks first and takes them out of the kit. A category is a kit collection with a name; collections without one (made before) show under their kind's name (Icons, Graphics, Photos), so nothing is lost.
- **FR-3 Upload.** Graphics are uploaded straight into a category, many at a time, by choosing files or dropping them on the page: SVG, PNG, JPEG, WebP, GIF. Each file becomes a workspace upload and joins the category. The file name, without its extension, is the graphic's name.
- **FR-4 Edit.** A graphic can be renamed (its upload is renamed), moved to another category, replaced by another file (it keeps its place; the old file stays in the uploads, where designs that use it still find it), and removed from the kit. Removing only takes it out of the kit: the file stays in the uploads, and designs that use it are unchanged.
- **FR-5 Find.** The page and the editor search the graphics by name, across categories.
- **FR-6 Place.** In the editor, the brand panel lists the kit's graphics by category, with search. A click places a graphic, and so does dragging it onto the page. An SVG is placed as editable vector shapes, named after the graphic, so it takes any fill colour, including CMYK and spot colours; any other image is placed as an image.
- **FR-7 One kit update per change.** Each change is one update of the kit: it appears in the kit's version history and can be restored from there. An upload of many files is one update after all files are in.
- **FR-8 Kit file.** The kit file (`.brandkit.zip`) carries the category names (`collections[].name`); files keep their names, so an imported graphic keeps its name.

## Acceptance

- **AC-1** A manager creates the categories Silhouettes, Drawings and Icons, uploads 24 SVGs into Silhouettes in one go and sees them named after their files.
- **AC-2** Renaming, moving, replacing and removing a graphic each show at once and in the kit's version history; a member without `brand.kits` sees the page read-only.
- **AC-3** In the editor, clicking a silhouette SVG places a vector group named after it; its fill can be set to a brand colour. Dragging it onto the page places it at the drop point. A PNG drawing is placed as an image.
- **AC-4** A kit with an unnamed icon collection from before shows it as Icons; nothing is lost.
- **AC-5** A kit exported and imported again keeps its categories, their names and order, and the graphics' names.

## Not in this spec

- Tags and per-graphic descriptions; colour variants of one graphic.
- Managing colours, fonts and logos on the brand page (they stay in the editor's brand panel for now).
