# Changelog

All notable changes to danvas are listed here, newest first. Versions follow the `VERSION` file. After 0.1.10 no part of a version goes past 9: the next release is 0.2.0. Self-hosters upgrade by swapping the binary; every release keeps existing designs openable (see the zero data loss rules in `CLAUDE.md`).

## Unreleased

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
