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

**Print and export defaults** in a folder's menu name the workspace export profile and print preset its designs, and those of its subfolders, open the download menu and the print dialog with: a folder of labels opens with the label settings for everyone. A subfolder without its own default uses the nearest folder above it that has one. Setting them takes the right **Set folder defaults** (owners and admins by default); everyone else sees them read-only. A folder default comes before anyone's own default; the picker then says which folder it comes from. Several designs on the dashboard use it only when all of them resolve to the same one.

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

### Changing the format of designs

**Change format…** in a design's menu, or in the selection bar for several designs, gives every page of them a new size in one go, for example when a print shop asks for 50 x 100 mm labels instead of 90 x 40 mm ones. Set:

- **New size**, in any unit; the designs take that unit afterwards. Each page gets exactly this size; bleed, print marks and notes stay as they are.
- **Turn the content** left or right, for labels that run sideways on a roll: the content is laid out on the turned size (100 x 50 mm) and turned a quarter, so the page ends up upright at exactly 50 x 100 mm and looks like the old one turned.
- **Content**: **Scale and spread** (everything grows or shrinks by one factor, so text keeps its line breaks; the space left over is shared out by where things sit, and colour areas that run along an edge stretch with it), **Lay out anew** (as Magic Resize does) or **Leave as it is** (only the page changes).

The dialog previews the result for every design before anything changes. **Change format** then saves each design as a version named after the size (Format 50 × 100 mm); the state before stays in the version history, from where it can be restored. Designs edited live get the change in their edit history as well, so an editor opened later starts from it; close the designs in every editor before changing them. Combined with **Extend artwork into the bleed** on download, the turned colour areas still fill the bleed.

### Importing

**Import** in Projects opens a menu with three ways to bring designs in, always into the folder that is open:

- **Import files**: `.pptx`, `.odp`, `.md` and `.hyc` files. PowerPoint files stay editable: picture fills with crop and transparency, freeform paths, real groups, and backgrounds defined on the slide layout or master come over.
- **Import folder**: a whole folder from your device; its sub-folders become folders here.
- **Import from Canva**: designs and folder trees straight from a Canva account. The server runs the import, so it carries on with the browser closed. Setup and behavior are described in [the dashboard guide](dashboard.md#import-from-canva).

You can also drop files onto the Projects view.

### Download and share for a selection

Tick several designs (and folders) and the bar at the bottom offers download and share for all of them at once: every page of every design into one zip, or one person's access or view links for all selected designs.

### Everyone through single sign-on

On an instance that signs people in through an identity provider (OIDC), a team workspace can take in everyone who signs in that way: under **Members**, someone whose role may set up SSO sign-in ticks **Add everyone who signs in with single sign-on** and picks the role (any role of the workspace except the owner role, and only one whose rights they hold themselves). Everyone who already has an SSO account joins at once; anyone signing in through SSO later joins at sign-in. Higher roles stay as they are. Someone you remove is not added back automatically; inviting them again brings them back. Switching it off keeps everyone who is already in.

### Invitations

People whose role may invite (by default owners and admins) invite by email under **Members**, with any role whose rights they hold themselves; the invitation also shows up in danvas under the bell for anyone who already has an account there. For the email to go out, the instance needs a mail server (see `SMTP_*` in [`deploy/README.md`](../deploy/README.md)).

If someone has become a member in the meantime (for example through single sign-on above), their pending invitation says so and offers **Apply role**: they get the invited role, if it is higher than the one they have, and the invitation is withdrawn. Sending it again is refused with that explanation, since members need no invitation; their role is changed in the list.

### Roles and permissions

Who may do what in a team workspace is set on the dashboard under **Roles and permissions** (in the left bar). It has three layers:

- **Actions** are the single things danvas checks, for example rename a design, delete it for good, upload a file, publish a template, manage colour profiles, set up the AI provider, invite people. danvas defines them; the tab **Actions** lists each with a sentence and the permissions that contain it. Many actions can apply to one's own items only or to everything in the workspace.
- **Permissions** bundle actions under a name ("Print data" = colour profiles, export profiles and print presets). Each action in a permission is set to **Own items only** or **Everything in the workspace** where it has that choice.
- **Roles** are sets of permissions. Every member, every invitation and the SSO sign-in above get one role.

Every workspace starts with four roles: **Owner** (every right, including deleting the workspace), **Admin**, **Member** and **Viewer**, which allow exactly what the four fixed roles allowed before 0.6.0. Roles and permissions can be created, edited, duplicated and deleted, the seeded ones too. When a role still has members, deleting it asks which role they move to.

The rules, checked by the server on every request:

- You can only hand out what your own role holds: a permission only with actions you have, a role only with permissions you hold, and you can only give someone (or invite them with, or set for SSO) a role whose rights you hold. Nobody changes their own role.
- The **Owner** role always has every right. It can be renamed, never changed or deleted, and only owners give it to someone or take it away. The last owner of a workspace cannot be removed or demoted.
- A right your role lacks is refused with a message naming it, and the matching button is not shown.
- Every change to roles and permissions, and every role given to a member, is listed under **Log** (for roles that may see it).

The switch **Who may change them** beside the workspace's export profiles and print presets still works: it adds or removes that right for the **Member** role. Any other role gets it on the roles page. **Roles for single designs** on the Members page are something else: named sets of rights on one design, given when it is shared.

If a workspace has lost its last owner (for example the only owner left the company and their account was removed), the server's administrator can give an existing user the owner role on the command line: `hycanvas workspace grant-owner <workspace id or slug> <email>` (in the container: `docker compose exec app /app/hycanvas workspace grant-owner ...`). It is recorded in the log.

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

### Barcodes

**Elements**, **Barcode** inserts a barcode for labels and packaging: EAN-13, EAN-8, UPC-A, Code 128, GS1-128, Code 39, PZN (the German pharmacy product number, printed as Code 39 with `PZN - 12345678` below it), Data Matrix (square or rectangular), GS1 Data Matrix and QR Code (with its error correction level). The dialog checks the content while you type and says what is wrong (a check digit, the length, a character the type cannot carry, an invalid GS1 identifier or date); leave the check digit out and it is computed. The older **QR code** element stays for web links with a logo in the middle; for print, a QR code from **Barcode** has the same exact sizing, black ink and checks as the other codes.

- **Exact**: every bar is drawn at a whole multiple of the module width X, in the size you set in mm, with the quiet zones the type requires inside the element. Bars are 100 % black ink (`0 / 0 / 0 / 100`) by default, or any colour of the colour field, exact CMYK and spot colours included; the background is transparent unless you add one.
- **Size**: X and, for linear codes, the bar height in the properties panel. Dragging the handles changes X and the bar height and encodes the code again, so it is never stretched; one undo returns to before the drag. For EAN and UPC the panel shows the size as a percentage of the nominal 0.33 mm.
- **Text line**: shown or hidden, in any font the design can use (upload OCR-B to the workspace for the classic look), at a size that follows X unless you set one. EAN and UPC digits sit under the halves of the code, with the guard bars extended between them.
- **Printers**: under **Print** in the panel, a printer resolution (203 or 300 dpi for label and thermal printers, 600 or 1200 dpi for office lasers, or any other) rounds X to whole printer dots so every bar comes out the same width; the print dialog then starts at that resolution, and a bar width reduction narrows every bar for presses that spread ink.
- **Checked before printing**: the download menu and the print dialog list barcodes whose module is below what scanners read reliably (EAN and UPC: 0.264 mm, GS1 Data Matrix: 0.255 mm, other codes: 0.19 mm), without quiet zones, with light bars, with bars in several inks of a CMYK file, or with fewer than 2 pixels per module in a raster file or print.
- **Compatible**: a barcode is stored as an ordinary group of a vector path and text, with its settings alongside. Every export draws it, and earlier danvas versions open, show and print it exactly; double-click selects the whole barcode instead of entering it, and the layers panel lists it as one layer. **Convert to shapes** (where groups offer Ungroup) turns it into ordinary shapes and text that print the same but can no longer be changed as a barcode.

QR codes are now drawn without the slight enlargement of each module they had before: on screen nothing changes, in print files every module has its exact size.

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
- **The workspace's**: uploaded by its admins on the dashboard's **Members** page, under **Print and export**, **Color profiles**, for every member.
- **Your own**: under **Settings**, **Color profiles**, anyone uploads the profile a print shop sent them (for example PSO Coated v3); only they see it, in every workspace. Rename, make default, remove the default again, or delete it there.

Which one applies: the profile chosen in the download menu; it starts with the design's color profile (page panel, **Color profile of the design**; **Default** follows your default, else the workspace's, else the built-in one). The design's profile also decides how exact CMYK and spot colors look on screen; changing it shows them anew (one undo step), their print values stay. The download menu and the page panel list your profiles, the workspace's and the built-in one, with **Manage: Mine · Workspace** leading to your own list or to the workspace's. Where each kind is kept and who may change it: [Where profiles are kept](#where-profiles-are-kept).

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

- **Extend artwork into the bleed** (on by default): areas, frames, clipping groups and pictures that stop at the edge of the page grow outward by exactly the bleed set, on each side they meet, also inside scaled groups. Without it a bleed would stay white wherever artwork ends at the cut. Elements turned by a quarter (90 or 270 degrees, as after **Change format** with a turn) grow too. What cannot grow without changing its look (an element at any other angle, an ellipse or free path, a cropped or letterboxed picture) is left as it is and listed in the download menu with its design and name, to extend by hand; text and lines are not extended.
- **Finished size in whole millimeters**: each design goes out at its nearest whole-millimeter size, so a label made as 89.96 x 39.95 mm (designs from before exact sizes) is cut as 90 x 40 mm; artwork at the edge counts as meeting the new edge.

Both apply to every format with bleed and marks, to the proof and to the output check, and are stored in export profiles: one profile per print shop then turns any selection of designs into its files in one go.

### Export profiles

An export profile is a named set of download settings: format, size, colour profile and intent, the maximum ink coverage (TAC), the print-shop options, bleed and crop marks, extending artwork into the bleed and the finished size in whole millimetres. The download menu starts with a profile picker:

- Pick a profile and the menu takes its settings. A line under it says what it does (for example "PDF vector · CMYK, PSO Uncoated · PDF/X-4 · bleed 1.5 mm · die line Stanze"), after its description.
- Change anything and the menu says so; **Update** writes the change into the profile, **Save as new** keeps it as a new one (name, description, "Just me" or "Whole workspace", default).
- **Manage: Mine · Workspace** opens the full list: your own under **Settings**, **Export profiles**, the workspace's on its **Members** page (see [Where profiles are kept](#where-profiles-are-kept)). There **New** creates one, **Edit** changes every setting of a profile in one dialog (format, PDF type, colour, colour profile and intent, ink limit, black ink, PDF/X-4, registration marks, die line, bleed and crop marks, extending into the bleed, whole millimetres, zip), a click renames or describes it, and it can be made the default, duplicated, copied from the workspace into one's own, or deleted.
- The download menu opens with the user's default, else the workspace's. Names are unique per owner, ignoring case.
- Who may create, change and delete the workspace's profiles follows the roles ([Roles and permissions](#roles-and-permissions)): by default owners and admins. The switch on the same **Members** page also gives it to the Member role. Everyone uses them.

A profile can hold bleed and crop marks "as on the pages" or "set for this output": the second applies one bleed and one set of marks to the export without changing the design.

### Printing

**Print** opens the system print dialog with the design drawn as for a download. It is in the editor next to **Download** (and Ctrl+P, File > Print) and, for one design or a whole selection, in the dashboard's design menu and selection bar.

- **Paper**: the paper handed to the printer driver. "Size of the design" gives each page paper of its own size (with bleed and marks), for label and roll printers loaded with that media and for "Save as PDF"; A4, A3 or Letter is the sheet in the printer, turned to fit the design.
- **Size on paper**: the design's actual size (100 %), centred on the paper, or fitted to it within a margin most printers can print to. A page larger than the paper at actual size is pointed out before printing.
- The printer receives the paper size and one RGB image per page; its driver handles the colours (the colour profiles of the download menu are for print-shop files). For actual size, keep the scale at 100 % ("Default") in the system print dialog.
- **Resolution**: 150, 200, 203, 300, 600 or 1200 dpi. The whole page, text included, reaches the printer as an image, so the printer's own resolution gives the sharpest small text, hairlines and barcodes: 203 or 300 dpi for label and thermal printers, 600 or 1200 dpi for office laser printers. When barcodes on the pages are set up for a printer resolution, the dialog starts at it and says so if another is chosen. Each page is rendered at no more than 7000 pixels on its longest side to stay within the browser's memory; a page larger than that (A3 at 600 dpi, for example) prints at a lower resolution, and the dialog says which.
- **Bleed and crop marks**: as on the pages, or set for this print.
- **Print presets** store these settings like export profiles store a download's: personal or per workspace, with a default, their own list under **Settings**, **Print presets** and on the workspace's **Members** page (**Edit** there changes pages, paper, size on paper, resolution, bleed and crop marks), and their own setting for who manages the workspace's.

### Where profiles are kept

Colour profiles, export profiles and print presets each exist twice: **your own** and **the workspace's**. Your own are for you alone; the workspace's are shared by everyone in it, for example one export profile per print shop.

| | Your own | The workspace's |
|---|---|---|
| Where to manage them | **Settings** (in the menu under your name): **Export profiles**, **Print presets**, **Color profiles** | Dashboard, **Members** in the left bar, section **Print and export**: **Color profiles**, **Export profiles**, **Print presets** |
| Who sees and uses them | only you, in every workspace you work in (your personal one too) | every member of that workspace, only there |
| Create, edit, delete | you | whoever's role holds the matching right (see [Roles and permissions](#roles-and-permissions)); by default owners and admins, and for export profiles and print presets also the Member role when switched on there |
| Default | **Use as my default** (colour profiles: **Make default**): applies to you only and comes before the workspace's default | **Use as the workspace default** (colour profiles: **Make default**): applies to every member who has no default of their own; a folder can also name one of them for its designs, which comes before everyone's own ([Folders](#folders)) |

In the download menu, the print dialog and the page panel both kinds are listed together, yours as **Mine** and the workspace's under its name. Beside each picker, **Manage: Mine · Workspace** opens your own list in **Settings** or the workspace's on its **Members** page, at the right section. Each list creates, edits (every setting, with **Edit**), renames, sets the default and deletes; colour profiles are created by uploading an `.icc` file. **Copy to mine** turns a workspace profile into one of your own, to change it for yourself without changing it for everyone.

What you pick in the download menu or the print dialog applies to that one download or print only: the designs do not change, and a profile only changes when you choose **Update** (or edit it in the lists above).

A rule of thumb: what everyone should use (the print shop's bleed, die line and colour profile) belongs to the workspace; what only you need (a test setting, a proof printer at home) belongs to you.

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
