# What danvas adds

The other pages in this folder are HyScaler's documentation of HyCanvas and describe everything danvas inherits. This page covers what danvas adds on top and how to use it. The list of changes by area is in the [root README](../README.md#what-is-different-from-hycanvas); what changed in which release is in the [changelog](../CHANGELOG.md).

## Dashboard

### Folders

Designs live in folders, as deep as you like. In **Projects**, **New folder** creates one in the folder that is open; designs and folders move by drag and drop or with **Move to folder** in their menu.

The sidebar shows the folders as a tree below **Projects**:

- The arrow next to Projects hides or shows the whole folder list.
- A folder with anything in it has its own arrow. Opened, it lists its sub-folders and then its designs, like a file manager.
- Click a folder to open it in the main view; click a design to open it in the editor.
- Drag a design or a folder onto any folder row to move it there.
- A folder with many designs lists the first 50 and then "+N", which opens the folder.
- What you opened is remembered per workspace. The way to the folder you are in shows by itself.
- While a search is showing, the tree lists folders only.

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

## Brand kits and fonts

- **Workspace fonts**: under **Members**, **Upload fonts** adds font files to the workspace once. They then appear in every font picker and are embedded in vector exports.
- **Brand kits** take any number of named font roles and an icon collection; their colors and fonts apply into groups.
- **Logos**: managers add logos to a kit from uploads or a new upload, remove them, and add or change each logo's dark-background version. Each logo tile shows the light and the dark version at the same size.
- **Export and import**: managers save a kit as a `.brandkit.zip` (colors, fonts with their files, logos, collections, voice and controls) and import one into any workspace. When the name is taken, the import shows both kits and asks whether to replace the existing one (its earlier state stays in the version history) or to import under another name. The file format, and how to write one by hand, is in [Brand kit files](brand-kit-format.md).

## Export

All of these are drawn by the same engine as the editor, so they match what you see:

- **SVG** and **vector PDF**.
- **Accessible PDF (tagged)**: the vector PDF plus a structure tree in reading order, alt text, and an invisible real-text layer.
- **Print**: vector PDF, TIFF in CMYK or RGB with the color profile embedded, and EPS (PostScript Level 3), with ICC color management and black-only text. For CMYK, choose a color profile; workspace admins upload their own printing profiles under **Members**, **Print profiles** (**Upload .icc profile**).
- **Video (MP4)**: the deck's playthrough, encoded in the browser. A browser that cannot encode video says so.

Effects (shadows, glows, blurs) keep their size at every export scale.

### Bleed and crop marks

Artwork that should reach the edge of a printed piece is printed larger and cut back, so no white edge is left when the cut is slightly off. Each page sets this for itself:

- With nothing selected, the page panel's **Print** section sets the page's **bleed** in millimetres (3 mm is common; ask your print shop). The editor shows the bleed as a dashed red line around the page: the page background reaches out to it, and pictures and shapes pulled past the page edge stay visible up to it.
- **Crop marks** are switched on per page, with their line type (solid, dashed or dotted), color, weight in points, length and gap to the cut in millimetres. A mark never starts inside the bleed, and artwork that runs further past the page than the bleed is cut at the bleed line, so marks are never printed on artwork.
- **Apply to all pages** copies the page's bleed and marks to every page of the design.
- Print exports (vector PDF, image PDF, TIFF and EPS) include each page's bleed and marks, as long as **Bleed and crop marks** is on in the export dialog. In a PDF the finished size is the TrimBox and the bleed the BleedBox, as print shops expect; the page itself is large enough for the marks. Off exports the bare page. PNG, JPG, SVG and the accessible PDF always export the bare page.

## Running an instance

- **Install and update**: the stack in [`compose/`](../compose/README.md), or `install.sh` and `update.sh` from [`deploy/`](../deploy/README.md), which also documents every setting, the image's tags and platforms, and reverse proxies.
- **Identity without rebuilding**: `INSTANCE_NAME`, `INSTANCE_ACCENT` (one color; the scale, gradient, `theme-color` and favicon are derived from it) and `INSTANCE_LOCALE`.
- **Language**: the interface follows the browser's language unless the instance or the user sets one.
- **Updates show without a hard reload**: pages and translations are revalidated on every load.
- **Releases**: every version tag builds the image `ghcr.io/4nonx/danvas` for amd64 and arm64 after the tests pass, and gets a release page with its changelog section. Database migrations run on start and are additive; existing designs stay openable across updates.

## Tools

- [`tools/canva-export`](../tools/canva-export): a read-only exporter that downloads a Canva account's designs as PPTX into a folder tree.
- [`tools/esr-convert`](../tools/esr-convert): the conversion of the Real-ESRGAN model to ONNX.
