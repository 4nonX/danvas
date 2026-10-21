# What danvas adds

The other pages in this folder are HyScaler's documentation of HyCanvas and describe everything danvas inherits. This page covers what danvas adds on top and how to use it. The list of changes by area is in the [root README](../README.md#what-is-different-from-hycanvas); what changed in which release is in the [changelog](../CHANGELOG.md).

## Dashboard

### Folders

Designs live in folders, as deep as you like. In **Projects**, **New folder** creates one in the folder that is open; designs and folders move by drag and drop or with **Move to folder** in their menu, and **Copy to folder…** copies them into another folder (see below).

The sidebar shows the folders as a tree below **Projects**:

- The arrow next to Projects hides or shows the whole folder list.
- A folder with anything in it has its own arrow. Opened, it lists its sub-folders and then its designs, like a file manager.
- Click a folder to open it in the main view; click a design to open it in the editor.
- Drag a design or a folder onto any folder row to move it there.
- A folder with many designs lists the first 50 and then "+N", which opens the folder.
- What you opened is remembered per workspace. The way to the folder you are in shows by itself.
- While a search is showing, the tree lists folders only.

### Copying and moving to folders and workspaces

A design or a folder can be copied to another folder of the same workspace, or copied or moved to another workspace, for example from your personal workspace to the team's once it is finished. In its menu choose **Copy to folder…**, **Copy to workspace…** or **Move to workspace…**; with several designs and folders selected (the box at a card's top left), **Copy to folder…** and **To workspace…** in the selection bar do the same for all of them. All three open one dialog: **Copy** or **Move**, the workspace and the folder there; **Copy to folder…** starts on this workspace, marked "(this workspace)".

- Pick the workspace (any you are at least a member of) and the folder there. A copied folder arrives with its sub-folders and designs in the same structure. Copies keep their names.
- Within the same workspace, a copy uses the same uploads, fonts and brand kit as the original; nothing else is copied. **Move** there is the same as **Move to folder**. A folder cannot be copied or moved into itself or one of its sub-folders.

Between workspaces:

- The uploads a design uses (pictures, masks, logos, video and audio) are copied into the target workspace, so the designs there export and keep working even if the originals' uploads are deleted later. An upload used by several of the designs is copied once.
- Workspace fonts the designs use come along when you are an admin of the target; otherwise the dialog names the ones its admins would have to add.
- A brand kit assignment the target does not have is dropped, so the designs follow the target's default kit.
- **Copy** leaves the originals where they are. **Move** puts them in the trash once they are copied, so they can be restored from there, and removes source folders it emptied. Version history, comments and share links stay with the originals.
- Copying needs view access to the source, moving needs membership. The copied uploads count towards the target's storage.

Design cards say when a design was last edited ("5 minutes ago", "yesterday"); the exact date and time show on hover.

### Importing

**Import** in Projects opens a menu with three ways to bring designs in, always into the folder that is open:

- **Import files**: `.pptx`, `.odp`, `.md` and `.hyc` files. PowerPoint files stay editable: picture fills with crop and transparency, freeform paths, real groups, and backgrounds defined on the slide layout or master come over.
- **Import folder**: a whole folder from your device; its sub-folders become folders here.
- **Import from Canva**: designs and folder trees straight from a Canva account. The server runs the import, so it carries on with the browser closed. Setup and behavior are described in [the dashboard guide](dashboard.md#import-from-canva).

You can also drop files onto the Projects view.

### Download and share for a selection

Tick several designs (and folders) and the bar at the bottom offers download and share for all of them at once: every page of every design into one zip, or one person's access or view links for all selected designs.

### Everyone through single sign-on

On an instance that signs people in through an identity provider (OIDC), a team workspace can take in everyone who signs in that way: under **Members**, an owner or admin ticks **Add everyone who signs in with single sign-on** and picks the role (member or viewer). Everyone who already has an SSO account joins at once; anyone signing in through SSO later joins at sign-in. Higher roles stay as they are. Someone you remove is not added back automatically; inviting them again brings them back. Switching it off keeps everyone who is already in.

### Invitations

Owners and admins invite people by email under **Members**; the invitation also shows up in danvas under the bell for anyone who already has an account there. For the email to go out, the instance needs a mail server (see `SMTP_*` in [`deploy/README.md`](../deploy/README.md)).

If someone has become a member in the meantime (for example through single sign-on above), their pending invitation says so and offers **Apply role**: they get the invited role, if it is higher than the one they have, and the invitation is withdrawn. Sending it again is refused with that explanation, since members need no invitation; their role is changed in the list.

### Templates

- **Delete a template**: in Templates, the trash button on a template's card, after a confirmation. Allowed for the person who created the template and for owners and admins of its workspace. Built-in templates cannot be deleted. Designs already made from the template stay as they are.
- Instances can hide the built-in templates with `BUILTIN_TEMPLATES=off` (see [`deploy/README.md`](../deploy/README.md)).

## Template protection

Objects of a design can be protected, so that designs made from it keep them as they are.

- **Set it**: the shield in the layers panel, or **Template protection** in an element's "..." menu. Choose **Content only** (the text or picture may change; position, size and design stay) or **Full** (nothing changes). Protecting a group protects everything in it. **Only protected objects** in the layers panel lists them.
- **It travels with the design**: copies, designs made from it as a template, and copies in personal or other workspaces keep the protection. Objects copied out with copy and paste or duplicate are free.
- **Who can lift it**: only people with the right **Manage template protection** in the workspace that set it. Owners and admins have it; custom roles can grant it. Everyone else gets a message saying what is protected, by which workspace, and whom to ask.
- **Editing a protected template**: the protection also applies to the people who may change it, so a template is not changed by accident. They lift it for themselves in one design with **Edit template** and turn it back on with **Protect again**.
- **Enforced by the server**: a save, a version restore or a collaboration checkpoint that changes protected objects is refused for someone who may not, so the protection holds outside the editor too. Live edits relayed between collaborators are not checked one by one; a forbidden change still cannot be saved.
- When a workspace deletes its last template, people outside it can no longer add its protected objects to a design that has none yet. The confirmation says so.

## Editor

### Replace object

Select an image or a vector graphic (a placed logo, icon or SVG) and choose **Replace** in the toolbar above the canvas or in the element's "..." menu. Pick a brand kit logo (dark-background versions included), a workspace upload, or a file from your device.

The replacement takes the old object's place in the layer order and keeps its opacity, blend mode, effects, animation and link. It is one undo step. Sizing follows what is visible: transparent margins and solid background plates of logo files are left out. Right after a replace the toolbar offers **Optical** (same visual weight), **Fit** and **Fill** to switch.

### Cropping

Every element can be cropped: images by their edge and corner handles, and shapes, text, groups, scaled and rotated elements with a clipping crop.

The crop frame turns independently of the element: drag the round handle above the frame, or type its angle in the crop bar (Shift snaps to 15°). The element stays where it is, so a tilted graphic can be cut to a straight rectangle and a straight one to a tilted frame. For a straight, unscaled image, "Rotate frame" in the crop bar switches to this frame.

On an image, the middle handles move the frame over the picture: drag the left handle in and less of the picture's left shows, while the picture keeps its size and place. Drag out again to show more, up to the edge of the image file. Hold Shift on a middle handle to scale picture and frame together. The corner handles always scale. One undo step per drag; Escape abandons it.

### Vectorize and Make editable

- **Vectorize** traces a raster image into editable vector shapes, with accurate straight edges and kept thin lines. An optional step upscales the image four times in the browser (Real-ESRGAN) before tracing, which helps with small or blurry sources.
- **Make editable** turns a placed SVG image into editable shapes in place, keeping its exact position, fit and crop. Text in the SVG is taken over for any font, and outlined text arrives as letter shapes.

### Remove background

**Remove background** is a toolbar button with live progress. It is non-destructive: the original stays and a mask is stored, so **Restore background** brings it back. The model runs in the browser and is served by the instance itself, not by a third party.

The model works on a 1024 pixel copy of the photo. Its edge is then fitted to the full-size original, so hair and outlines stay sharp on large photos, and the cut-out is drawn at the photo's full resolution in exports and at close zoom.

### Color

- The eyedropper works in every browser (it falls back to sampling the canvas).
- Opacity applies to fills and to group colors.
- Group color swatches recolor every use of a color inside a group or selection at once.
- Copy and paste style works on groups and carries text colors.

### Units and exact sizes

Every design has a measurement unit: millimetres, centimetres, inches, points or pixels. Set it in the page panel (**Unit**, with no element selected); a new design made from a print format or with a custom size in mm starts in mm.

- Page size, position and size of elements, corner radius, paragraph spacing and indents, shadow offsets, the rulers, guides, distance labels and the live size while dragging all use it. Type another unit to use it once: `10mm`, `1in`, `72pt`, `2 cm`; arithmetic works as before (`+5`, `*2`, `210/3`).
- Values are kept exactly, not rounded to whole pixels: a page of 50 x 100 mm is exactly that in every export (vector PDF and EPS state it to the hundredth of a millimetre).
- In a design in mm, cm, in or pt, type is sized in points and line widths are shown in points, as print software does. Arrow keys move by 0.1 mm (Shift: 1 mm), or 1 px in a pixel design.
- The page size list has the print formats (A3 to A6, DIN long, US Letter, business card) in exact millimetres, as do Magic Resize and **Add page**.

### Exact print colors

Every color picker has **Print color** below the color fields:

- **Automatic** (the default): the color is converted to CMYK through the color profile chosen for the export, as before.
- **CMYK**: the four values are entered and printed exactly as given, for example C73 M25 Y7 K0 for a house color; no profile changes them.
- **Spot color**: a named ink with a plate of its own (HKS, Pantone, white ink, varnish, as the print shop calls it), with CMYK values for how it looks and what prints when the plate is not used.

The values go into vector PDF and EPS unchanged: CMYK as the process values, a spot color as its own separation; a gradient between such colors blends in CMYK. On screen they are shown through the design's color profile (see below). Changing the opacity keeps the print color; picking another shade turns it back into an automatic one. Brand colors keep their print values when applied, and adding a color from the selection to the brand kit takes them along, so a house color set up once prints the same everywhere. Raster formats (image PDF, TIFF), effects (shadows, glows) and text without a font file for outlining are pictures and go through the profile. The download menu's output check expects the design's spot colors as plates.

### Color profiles

ICC profiles describe how CMYK prints on a paper and press. There are three kinds:

- **Built in**: PSO Uncoated ISO12647 (FOGRA47), always available.
- **The workspace's**: uploaded by its admins under **Members**, **Print profiles**, for every member.
- **Your own**: under **Settings**, **Color profiles**, anyone uploads the profile a print shop sent them (for example PSO Coated v3); only they see it, in every workspace. Rename, make default, remove the default again, or delete it there.

Which one applies: the profile chosen in the download menu; it starts with the design's color profile (page panel, **Color profile of the design**; **Default** follows your default, else the workspace's, else the built-in one). The design's profile also decides how exact CMYK and spot colors look on screen; changing it shows them anew (one undo step), their print values stay. The download menu and the page panel list your profiles, the workspace's and the built-in one, with **Manage** leading to the settings.

## Brand kits and fonts

- **Workspace fonts**: under **Members**, **Upload fonts** adds font files to the workspace once. They then appear in every font picker and are embedded in vector exports.
- **Brand kits** take any number of named font roles and an icon collection; their colors and fonts apply into groups.
- **Logos**: managers add logos to a kit from uploads or a new upload, remove them, and add or change each logo's dark-background version. Each logo tile shows the light and the dark version at the same size.
- **Export and import**: managers save a kit as a `.brandkit.zip` (colors, fonts with their files, logos, collections, voice and controls) and import one into any workspace. When the name is taken, the import shows both kits and asks whether to replace the existing one (its earlier state stays in the version history) or to import under another name. The file format, and how to write one by hand, is in [Brand kit files](brand-kit-format.md).

## Export

All of these are drawn by the same engine as the editor, so they match what you see:

- **SVG** and **vector PDF**.
- **Accessible PDF (tagged)**: the vector PDF plus a structure tree in reading order, alt text, and an invisible real-text layer.
- **Print**: vector PDF, image PDF, TIFF and EPS (PostScript Level 3), each in CMYK through an ICC color profile or in RGB. For CMYK, choose a color profile and a rendering intent: your own, the workspace's or the built-in one (see [Color profiles](#color-profiles)). Colors set as exact CMYK or spot colors are written as given ([Exact print colors](#exact-print-colors)).
- **danvas file (.hyc)**: the design itself in the open file format, all pages, for keeping, for another instance or to import again. Also in the editor's **File** menu.

The download menu checks what the chosen format would lose before the file is made, and lists it with the page and element: a font that is unknown here or did not load (a fallback font draws the text), an image that did not load, for the vector formats a font with no file to outline the text from (the text becomes a picture in the file), and for PDF, TIFF and EPS an image placed at under 150 dpi, lines thinner than 0.25 pt, text under 8 pt printed in several inks (in CMYK), and artwork or a coloured page background reaching the edge of a page exported without bleed. It never blocks the download.

To check every format against the editor after a change to the export, run `npm run test:export` (see [`tests/export`](../tests/export/README.md)).

### Files for print shops

What a print shop needs depends on the format; the download menu offers each option where the format can carry it:

| | Vector PDF | Image PDF | EPS | TIFF | JPG | PNG | SVG |
|---|---|---|---|---|---|---|---|
| Bleed and crop marks | yes | yes | yes | yes | yes | yes | yes |
| CMYK through an ICC profile | yes | yes | yes | yes | no | no | no |
| Profile embedded (output intent / ICC) | yes | yes | no | yes | no | no | no |
| PDF/X-4 | yes | yes | | | | | |
| Black in black ink only, black overprint | yes | | yes | | | | |
| Crop marks in registration colour | yes | | yes | | | | |
| Die line in a spot colour | yes | | yes | | | | |
| Resolution written into the file | | | | yes | yes | yes | |

- **Vector PDF** is the file print shops usually ask for: every shape, text (as outlines) and graphic stays an object of its own, so the print shop can open it in Illustrator and change a colour. With CMYK it carries the profile as its output intent and, with **PDF/X-4** on, is marked as PDF/X-4 (version, XMP metadata, trapping flag, page boxes). Transparency stays live.
- **Black ink only** prints pure black as 100 % K instead of a four-colour black; **Overprint black** then lets it print over what is under it, so no white gap shows when the plates are slightly out of register. In EPS, which has no overprint mode, black is written as the Black separation for this.
- **Crop marks in registration colour** put the marks on every printing plate (the separation "All"), as presses expect.
- **Die line**: a cut or punch contour along the trim, in a spot colour of its own (named as the print shop calls it, for example "Stanze" or "CutContour", with a corner radius), overprinting, and in a PDF on its own layer. It is not printed; the print shop cuts along it. Ask the print shop whether they want it: many draw their own.
- **JPG and PNG** cannot hold CMYK (PNG by definition, JPG not from a browser); use TIFF for a CMYK picture. Their header states the resolution (the page's physical size kept), so print software opens a 300 dpi export at the right size. **300 dpi** in the size row sets that resolution.
- **SVG** has no CMYK, profiles or spot colours by definition.
- **Video (MP4)**: the deck's playthrough, encoded in the browser. A browser that cannot encode video says so.

Effects (shadows, glows, blurs) keep their size at every export scale.

### Proof and output check

For a CMYK print file the download menu has two more buttons above **Download**:

- **Proof** shows the pages as they will print, computed in the browser through the chosen colour profile and intent: the soft proof (optionally with the paper's white simulated), each plate (cyan, magenta, yellow, black, the die line) in grey or in its ink, the **ink coverage** with every area above the limit marked, and the colours **out of gamut** (which the profile cannot print). Pointing at the page reads the inks there; the side panel gives the highest coverage, the area above the limit and the area out of gamut. It is a close estimate from the screen rendering.
- **Check output** builds the file exactly as **Download** would and checks the file itself. In the browser: CMYK only, output intent, PDF/X-4 marking, trim and bleed box, for EPS the bounding box and colours, and the spot colours asked for. On the server, Ghostscript separates the file into its real plates, as a print shop's software does: each plate with its coverage, a soft proof made from them, and the total ink coverage against the limit. Up to 20 pages and 200 MB; the check needs Ghostscript on the server (the image has it, see `GHOSTSCRIPT_PATH`).

**Max. ink coverage (TAC)**, in the CMYK settings and stored in export profiles, is the total of all four inks the print shop allows; empty means the usual value for the paper (300 % for uncoated, 330 % for coated profiles).

### Bleed and crop marks

Artwork that should reach the edge of a printed piece is printed larger and cut back, so no white edge is left when the cut is slightly off. Each page sets this for itself:

- With nothing selected, the page panel's **Print** section switches the page's **bleed** on (3 mm, which is common; ask your print shop) and sets it in millimetres. The editor shows the bleed as a dashed red line around the page: the page background reaches out to it, and pictures and shapes pulled past the page edge stay visible up to it.
- **Crop marks** are switched on per page, with their line type (solid, dashed or dotted), color, weight in points, length and gap to the cut in millimetres. Each mark starts at the gap set from the cut, exactly as given: a gap at least as large as the bleed keeps the marks off the artwork, a smaller one lays them over the bleed, which is cut away with them. Artwork that runs further past the page than the bleed is cut at the bleed line. Every value accepts a decimal comma or point (1,5 or 1.5).
- **Apply to all pages** copies the page's bleed and marks to every page of the design.
- The download menu shows the same settings for the pages being exported and edits them there. Downloading from the dashboard (one design or a whole selection), the menu instead holds one bleed and one set of marks for every design exported, starting from what the first of them sets; the designs themselves are not changed. **Bleed** and **Crop marks** are switched on or off for the export, for every image and print format (PNG, JPG, SVG, vector and image PDF, TIFF, EPS): bleed only, marks only (they then start at their gap from the cut, and artwork ends at the cut), both, or neither. Switching one on for pages that have none gives them the default (3 mm bleed, solid black marks). In a PDF the finished size is the TrimBox and the bleed the BleedBox, as print shops expect; the page itself is large enough for the marks. A transparent PNG keeps the page background out, in the bleed too. The accessible PDF, PPTX, Markdown and the animation and video formats always export the bare page.

What a print shop asks for (bleed X mm, crop marks of Y mm, a die line) is set once in the download menu and works for every design, whatever its size or layout. Two more options make each design fit it, on a copy, so the designs themselves do not change:

- **Extend artwork into the bleed** (on by default): areas, frames, clipping groups and pictures that stop at the edge of the page grow outward by exactly the bleed set, on each side they meet, also inside scaled groups. Without it a bleed would stay white wherever artwork ends at the cut. What cannot grow without changing its look (a turned element, an ellipse or free path, a cropped or letterboxed picture) is left as it is and listed in the download menu with its design and name, to extend by hand; text and lines are not extended.
- **Finished size in whole millimeters**: each design goes out at its nearest whole-millimeter size, so a label made as 89.96 x 39.95 mm (designs from before exact sizes) is cut as 90 x 40 mm; artwork at the edge counts as meeting the new edge.

Both apply to every format with bleed and marks, to the proof and to the output check, and are stored in export profiles: one profile per print shop then turns any selection of designs into its files in one go.

### Export profiles

An export profile is a named set of download settings: format, size, colour profile and intent, the maximum ink coverage (TAC), the print-shop options, bleed and crop marks, extending artwork into the bleed and the finished size in whole millimetres. The download menu starts with a profile picker:

- Pick a profile and the menu takes its settings. A line under it says what it does (for example "PDF vector · CMYK, PSO Uncoated · PDF/X-4 · bleed 1.5 mm · die line Stanze"), after its description.
- Change anything and the menu says so; **Update** writes the change into the profile, **Save as new** keeps it as a new one (name, description, "Just me" or "Whole workspace", default).
- **Manage** opens the full list. Under **Settings**, **Export profiles** are a user's own (in every workspace, seen by nobody else); in the workspace settings, next to the colour profiles, are the workspace's, shared by every member. Rename and describe by clicking, make one the default, duplicate, copy a workspace profile into one's own, delete.
- The download menu opens with the user's default, else the workspace's. Names are unique per owner, ignoring case.
- Who may create, change and delete the workspace's profiles is set in the workspace settings: owners and admins (the default) or every member who may edit. Everyone uses them.

A profile can hold bleed and crop marks "as on the pages" or "set for this output": the second applies one bleed and one set of marks to the export without changing the design.

### Printing

**Print** opens the system print dialog with the design drawn as for a download. It is in the editor next to **Download** (and Ctrl+P, File > Print) and, for one design or a whole selection, in the dashboard's design menu and selection bar.

- **Paper**: the paper handed to the printer driver. "Size of the design" gives each page paper of its own size (with bleed and marks), for label and roll printers loaded with that media and for "Save as PDF"; A4, A3 or Letter is the sheet in the printer, turned to fit the design.
- **Size on paper**: the design's actual size (100 %), centred on the paper, or fitted to it within a margin most printers can print to. A page larger than the paper at actual size is pointed out before printing.
- The printer receives the paper size and one RGB image per page; its driver handles the colours (the colour profiles of the download menu are for print-shop files). For actual size, keep the scale at 100 % ("Default") in the system print dialog.
- **Resolution**: 150, 200, 300 or 600 dpi. The whole page, text included, reaches the printer as an image, so 600 dpi gives sharper small text, hairlines and barcodes on printers that print at 600 dpi (most office laser printers). Each page is rendered at no more than 7000 pixels on its longest side to stay within the browser's memory; a page larger than that (A3 at 600 dpi, for example) prints at a lower resolution, and the dialog says which.
- **Bleed and crop marks**: as on the pages, or set for this print.
- **Print presets** store these settings like export profiles store a download's: personal or per workspace, with a default, their own list under **Settings**, **Print presets** and in the workspace settings, and their own setting for who manages the workspace's.

## Running an instance

- **Install and update**: the stack in [`compose/`](../compose/README.md), or `install.sh` and `update.sh` from [`deploy/`](../deploy/README.md), which also documents every setting, the image's tags and platforms, and reverse proxies.
- **Identity without rebuilding**: `INSTANCE_NAME`, `INSTANCE_ACCENT` (one color; the scale, gradient, `theme-color` and favicon are derived from it) and `INSTANCE_LOCALE`.
- **Source code link**: the sign-in page links to the source of the running version (the release tag), as the AGPL-3.0 requires. Running your own modified build, set `INSTANCE_SOURCE_URL` to your repository.
- **Language**: the interface follows the browser's language unless the instance or the user sets one.
- **Updates show without a hard reload**: pages and translations are revalidated on every load.
- **Releases**: every version tag builds the image `ghcr.io/4nonx/danvas` for amd64 and arm64 after the tests pass, and gets a release page with its changelog section. Database migrations run on start and are additive; existing designs stay openable across updates.

## Tools

- [`tools/canva-export`](../tools/canva-export): a read-only exporter that downloads a Canva account's designs as PPTX into a folder tree.
- [`tools/esr-convert`](../tools/esr-convert): the conversion of the Real-ESRGAN model to ONNX.
