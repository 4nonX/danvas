# F41 Import from Canva

Bring designs from Canva into danvas directly, with their folder structure, instead of downloading files by hand and importing them. Aimed at people moving their work over, so it has to cope with whole libraries, not just a few files.

## Constraints from Canva's Connect API

These shape everything below; they are Canva's rules, not choices.

- **Every app needs a Canva integration** with OAuth redirect URLs on a domain its owner controls. A single shared danvas integration cannot serve self-hosted instances on their own domains, private integrations need a Canva Enterprise plan, and a public one needs Canva's review. A public integration in **draft** (not reviewed) can be used for individual use. So each instance's admin registers their own draft integration (an account with MFA enabled) and enters its credentials in danvas.
- **OAuth 2.0 authorization code with PKCE** (`S256`). The code verifier stays on the server. Access tokens live 4 hours; refresh tokens rotate and are single-use.
- **Folders**: `GET /v1/folders/{id}/items`, from `root`, paged by `continuation`, items of type `folder`, `design` (and `image`, `brand_template`), 100 requests per minute per user.
- **Exports** are asynchronous jobs: `POST /v1/exports` then `GET /v1/exports/{id}` until `success` (download URLs valid 24 hours) or `failed`. Limits per user: 20 job requests per minute, 75 exports per 5 minutes and 500 per day; 75 per 5 minutes per document. A large library takes more than a day.
- **PPTX** is the editable route, but not every design can export to it: `GET /v1/designs/{id}/export-formats` lists the pages each format supports.

## Requirements

- **FR-1** An admin enters the integration's Client ID and secret in the workspace settings. The secret is stored encrypted (`AI_SECRET`, like AI keys) and never returned. The settings show the redirect URL and the scopes to register (`folder:read`, `design:content:read`, `profile:read`), so the Canva side can be set up by copying.
- **FR-2** Any member connects their own Canva account (OAuth with PKCE, `state` checked, verifier kept server-side). The connection is per user and workspace; tokens are encrypted at rest, refreshed before expiry (serialized per connection, because refresh tokens are single-use) and removed when refresh fails, so the user simply reconnects. Disconnect deletes them.
- **FR-3** The import dialog shows the user's Canva library as a tree: folders and designs, loaded lazily, with thumbnails. Any mix can be ticked: single designs, whole folders (with everything below), or everything.
- **FR-4** The import goes into the dashboard folder that is open. A ticked folder becomes a danvas folder of the same name, its sub-folders likewise, all the way down; a ticked design goes straight into the target. Existing folders of the same name are reused, as in the bulk import.
- **FR-5** Each design is exported as PPTX when Canva offers PPTX for all of its pages, and imported through the PPTX importer (editable). Otherwise it is exported as PNG, one image per page, and becomes a design whose pages each hold that image (looks exact, not editable); the run reports how many arrived this way. Video designs take the PNG route and arrive as still pages. A design with neither format fails with its reason.
- **FR-6** Exports are paced to stay under Canva's limits (at most 14 started per minute, which keeps a run under 75 per 5 minutes). A 429 from Canva waits for its `Retry-After` (a minute when it names none) and retries, at most six times in a row per call, then the run halts with the advice to continue later; the daily limit pauses the run for Canva's `Retry-After` but at least an hour (Canva names about a minute, though the limit counts exports over 24 hours), after which it continues by itself. A resumed run does not ask again about designs it found to have no export format; a new run does.
- **FR-7** Every imported design is recorded (Canva design id to danvas design id, per workspace). A re-run skips designs already imported, unless their danvas copy was deleted, so an interrupted or day-limited import is continued by running it again.
- **FR-8** The server runs the import (`internal/canvaimport`), so it goes on with the dialog, the tab or the browser closed, and after a server restart (a run left running is queued again and skips what it already imported). Its owner, and nobody else, sees the run's progress in the dashboard on every device (a line in the sidebar per run that is going or not yet dismissed, nothing floating over the page, nothing in the editor; the owner's 20 most recent runs, dismissed ones too, at the top of the import dialog): how many designs were imported, skipped and failed, the failed ones with the reason, and why a run halted. The progress counts the designs left to import: those of the selection already in danvas are counted as skipped as soon as the folders are read, before the first export. A design without a usable export format fails with the formats Canva does offer (`pdf, pptx [1,3]`), in the run's failures and in the log. The owner can stop a run (after the design it is on) and dismiss an ended one. Each owner's runs execute one at a time, in the order started; at most four runs execute at once on an instance.
- **FR-8a** The server converts the exports with the same importers the browser uses for file imports: `@hc/export`'s PPTX importer and the image pages builder, bundled for goja (`scripts/build-pptx-convert.mjs`, `backend/internal/pptxconv`) with decompression, UTF-8 decoding and base64 done natively in Go. One export is at most 256 MiB, unpacked entries at most 256 MiB each and 512 MiB together, and one conversion at most two minutes.
- **FR-8b** A run re-checks before each design that its owner may still add designs to the workspace, and halts when not; a disconnected Canva account halts it too.
- **FR-9** Every Canva call goes through the backend (client credentials and tokens never reach the browser). Download URLs are fetched only from Canva's own HTTPS hosts.
- **FR-10** A 429 counts as the daily limit when Canva's message mentions it.

## Acceptance

- **AC-1** With no integration configured the dialog explains what to set up and links to the settings; an admin sees the redirect URL and scopes there.
- **AC-2** Connect, pick a mix of a folder with nested folders and a single design: the danvas tree matches Canva's, designs open in the editor.
- **AC-3** Run the same selection again: nothing is imported twice. Delete one imported design and run again: only that one comes back.
- **AC-4** A design without PPTX export (for example a multi-page non-presentation) arrives as image pages.
- **AC-5** A forced 429 pauses and resumes the run without failing designs.
- **AC-6** Start an import, close the browser, sign in on another device: the run's progress shows there and the designs keep arriving. Restart the server during a run: it continues without importing anything twice.

## Non-goals

- Importing Canva uploads (images, videos) into the danvas upload library.
- Brand templates, comments, and Canva's version history.
- Keeping a sync: this is a one-way import.
- Preserving Canva's sort order beyond the folder structure (danvas lists designs by its own sorting).

## Data

Additive SQL only: `canva_integrations` (per workspace), `canva_connections` (per workspace and user), `canva_oauth_states` (short-lived, PKCE verifier and `state`), `canva_imports` (the mapping of FR-7), `canva_import_runs` (the runs of FR-8, their selection and progress) and `canva_import_run_designs` (the designs each run imported, so a resumed run counts them once). No design-file schema change.

API: `POST /api/v1/workspaces/{id}/canva/runs` (start), `GET /api/v1/canva/runs` (the caller's runs that are not dismissed; with `?all=1` the 20 most recent, dismissed ones too), `POST /api/v1/canva/runs/{runId}/stop`, `POST /api/v1/canva/runs/{runId}/dismiss`. The browser-side calls (list a folder, start and poll an export, download a file, record an import) stay for API clients.
