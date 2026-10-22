# Feature Checklist

A living checklist of what ships today versus what is planned. Shipped items are grounded in the code; pending items map to the specs in [`roadmap/`](roadmap/README.md). Keep this in sync as scope changes.

## Shipped

### Editor core
- [x] Scene-graph engine on Canvas2D (framework-agnostic; browser, worker, headless server)
- [x] Shapes, lines, arrows, frames, grids, tables, 9 chart types, QR codes
- [x] Barcodes: EAN-13/8, UPC-A, Code 128, GS1-128, Code 39, PZN, Data Matrix, GS1 Data Matrix, QR Code; live validation, exact vector bars in one ink, quiet zones, printer-dot rounding, bar width reduction, output check ([spec 43](roadmap/43-barcodes.md))
- [x] Text: presets, font pairings, searchable catalog, custom font upload (embedded)
- [x] Fills (solid/gradient/image/pattern), stroke, corner radius, opacity, effects (shadow/lift/hollow/glow/neon/echo/splice/outline/blur) with per-effect level controls
- [x] Image filters, Light/Color/Detail adjust, crop, remove background, rasterize
- [x] Animations: entrance/exit/emphasis presets, motion-path keyframes, photo motion (Ken Burns/parallax)
- [x] Layers panel, alignment guides/snap, rulers, grid, minimap, zoom control
- [x] Keyboard shortcuts (with remapping dialog), command menu + AI command bar
- [x] Magic Resize (switch format / re-flow), boolean ops, groups
- [x] Autosave + manual save

### Content systems
- [x] Uploads (folders, tags, from-URL, SVG/PDF import, screen/mic recording)
- [x] Stock (bundled catalog + live Openverse photos, licensing/attribution, faceted filters: category/style/orientation, colorful-first browse order)
- [x] Templates (categories, save-as-template, workspace collections, locked regions)
- [x] Brand kits (colors/fonts/logos/voice, brand lock with off/warn/block policy, auto-fix, re-skin)
- [x] Brand kit export and import as a `.brandkit.zip` (documented format), replace-or-rename on a name clash

### Document types
- [x] Presentations (present mode: 9 transitions incl. Magic Move, laser/pen/spotlight, autopilot, presenter HUD, rehearsal timer)
- [x] Pure, exportable transition compositor in `@hc/engine` (F28 FR-13), shared by present mode, the player, and (planned) export
- [x] Shared-link deck player: engine-drawn slides, navigation, fullscreen, real transitions (F28 FR-26)
- [x] Animated export of a whole deck (APNG/GIF) with slide transitions composited (F28 FR-19 groundwork)
- [x] Second-display presenter view: audience window, wall clock, teleprompter (F28 FR-15)
- [x] Slide master/layout/placeholder model + swappable deck Theme, schema v11 (F28 FR-3, FR-4)
- [x] Accessibility model: per-node alt text + decorative, page reading order, schema v12 (F28 FR-29)
- [x] Reading Order pane; keyboard Tab navigation follows reading order and skips decorative nodes (F28 FR-29)
- [x] PPTX round-trip: export (editable text/shapes/images/notes, raster fallback) + import (incl. real tables; charts/SmartArt as placed placeholders; animations and master inheritance flatten)
- [x] Deck-to-video: one-click server MP4 of the full playthrough (animations + transitions)
- [x] Present-and-record: slides + ink + mic narration to a local .webm (camera bubble pending)
- [x] Grid/outline overview editing view (`SlideOverview`: grid + outline, sections, drag reorder)
- [x] Live audience over share links: Q&A with upvotes, presenter polls, emoji reactions (captions pending)
- [x] Live data-linked charts/tables (inline CSV or URL via the SSRF-guarded proxy) + bulk data-merge (one slide per CSV row)
- [x] Tagged, selectable-text PDF export
- [x] Whiteboards (sticky/frame/ink/connectors, 8 templates, facilitation, synced timer, dot voting, convert-to-deck)
- [x] Sheets (~48-function formula engine, formatting, borders, sort)
- [x] Docs (block editor, callouts, embeds, AI writing tools, DOCX/PDF export)
- [x] Video (multi-track timeline with real media clips, drag to move/trim across tracks with live trim preview, multi-select, context menus on clips/lanes/ruler, on-stage reframe/scale of clips, track reordering, clip copy/paste/duplicate, close gap, fade handles and transition chips, true overlap cross-dissolves, nested sequences, volume envelopes, per-clip color adjustments and filter presets, opacity/rotation/fit, motion presets with easing, animated title cards, markers and export range, media panel with thumbnails/durations/recording/delete and proxy status, 540p preview proxies, green-screen keying, clip keyframes, scene detection, detach audio, live compositing preview with audio mix, loop/rate/mute/level meter and click-to-seek timecode, project settings panel with stage background, filmstrips/waveforms, styled captions with SRT/VTT, screen/webcam/voice recording, media panel search/sort/import-from-URL/usage badges/hover-scrub, draggable markers and range edges, gain-envelope editing on the clip, per-track meters, track height presets, crop tool, preview quality toggle, unified export dialog: in-browser exact export plus server ffmpeg MP4/WebM/GIF/MP3 with fps/captions/stem knobs and an export history)

### Collaboration
- [x] Realtime CRDT (Yjs), presence cursors, follow mode, locks, per-user undo
- [x] Offline editing (IndexedDB) with merge on reconnect
- [x] Multi-instance scale (Redis fan-out, cross-instance roster, CAS lock authority)
- [x] Comments (threads, pins, @mentions, reactions, resolve, convert-to-task)
- [x] Version history (auto/named checkpoints, restore, branch, CRDT scrub timeline)
- [x] Approvals (any/all policy, server-enforced lock), activity feed, engagement insights
- [x] Share links (view/comment/edit, password, expiry, require-sign-in) with canonical URLs
- [x] My tasks

### AI
- [x] Bring-your-own-key providers (13 presets incl. OpenAI/Anthropic/DeepSeek/Moonshot (Kimi)/Azure OpenAI/Amazon Bedrock + custom), encrypted per workspace; a separate image provider per workspace for text-only providers
- [x] Design assistant chat: one agentic surface over the validated tool catalog (generate deck/doc/poster, images, restyle, charts, diagrams, whole-deck translation, speaker notes, critique); the earlier dedicated AI panels were consolidated into it
- [x] Multi-page generation from server-validated outlines with speaker notes; doc/URL/file-to-deck ingestion (.txt/.md/.pdf text layer); no-key Assist tools
- [x] Outline review before generation: editable outline (edit/reorder/add/remove) + generation dials (density/tone/audience/scenario) in the confirmation gate, with regenerate and skip
- [x] Streaming generation: SSE endpoint (outline/page/done/error, disconnect-aware), and decks paint instantly with outline content while per-slide model fills and imagery stream in behind
- [x] Computed chart values: with tabular data attached, insertChart parses the data (header detection, numeric coercion) and the model picks only chart type and columns; values come from the source, with an inline binding so Refresh re-parses
- [x] Web search grounding: per-workspace search provider (hosted API key or self-hosted metasearch URL, encrypted like AI keys), AI-written 12-word queries, webSearch assistant tool attaching untrusted-framed results as generation sources
- [x] Ingestion depth: up to 8 grounding attachments per generation (paste/URL/files), office-format extraction (.docx paragraphs, .pptx slides in deck order, .xlsx tab-separated rows), scanned-PDF detection with a friendly message, per-attachment editable extracted text
- [x] Per-slide AI regeneration: regenerateSlide rewrites one slide per instruction, optionally re-selecting the layout, preserving node ids (Magic Move) and any images whose prompts are unchanged
- [x] Narrative assistant ops: insertAgenda (algorithmic TOC with accurate final page numbers), splitSlide (one slide into two coherent halves), insertComparison (side-by-side layout fill)
- [x] Layout-grounded generation: decks target the master/layout/placeholder model (per-layout derived content schemas with v21 capacities, deterministic layout selection repair with variety, placeholder fills, picture slots through the image queue; freeform engine remains the no-layout fallback)
- [x] Placeholder-first generation imagery: decks land instantly and hero images stream in behind (prompt-keyed asset reuse, license-free stock routing, AI generation fallback, per-design guard, alt text, chat retry on failure)
- [x] Deck themes end to end: 13 curated seed themes, create-theme-from-brand-kit, AI generateTheme (strict hex/font validation, deterministic OKLCH contrast repair), generation stamps its visual system as the file theme, and a theme swap restyles exactly what the previous theme painted in one undo step
- [x] Extract layouts from a deck: heuristic slot decomposition with capacity hints, near-identical page dedupe, optional vision role correction (one self-review pass, heuristic fallback), capacity verification against simulated max fill (qualityCheck-gated)
- [x] Brand kit draft from a company domain: SSRF-gated page scan (logo candidates, frequency-ranked palette with an observed-colors-only model re-rank, webfont-first font guesses) behind an explicit confirm step; the chosen logo imports as a workspace asset
- [x] PPTX fidelity golden set: regression fixtures pinning gradient fills with stops, the weight-600 bold threshold, decorated runs, group flattening vs rotated-group rasterization, explicit crops via srcRect, multi-paragraph notes, z-order, chOff/chExt group scaling, and the no-silent-drop placeholder rule
- [x] Present-and-record camera bubble: optional webcam (declining keeps slides+ink+narration), draggable preview whose position drives the composite, cover-cropped rounded-rect bubble drawn over slide + ink, fully client-side

### Export and publishing
- [x] Export: PNG/JPG/PDF/SVG/APNG/GIF/Lottie, size multipliers, page selection, zip
- [x] Print exports: vector PDF, image PDF, TIFF and EPS in CMYK (ICC profile) or RGB; PDF output intent and PDF/X-4
- [x] Print-shop extras: black ink only with black overprint, registration-colour crop marks, die line as a spot colour on its own layer (vector PDF, EPS); resolution in PNG/JPG headers
- [x] Bleed and crop marks per page (line type, color, weight, length, gap), for every image and print format; PDF TrimBox/BleedBox
- [x] Measurement unit per design (mm, cm, in, pt, px) for sizes, positions, rulers and guides, exact (unrounded) sizes, print formats in mm, type in pt in print designs
- [x] Export-time prepress for any design: artwork at the page edge extended into the bleed, finished size rounded to whole mm (on a copy; stored in export profiles)
- [x] Change format for one or many designs from the dashboard: exact new size in any unit, content scaled and spread, laid out anew or left, optional quarter turn; previewed first, saved as a named version (also into the live edit history)
- [x] Exact print colors: CMYK values and named spot colors in the color picker, written unchanged to vector PDF and EPS (spot colors as separations, CMYK gradients); kept by brand colors and group recoloring
- [x] ICC color profiles: built in, per workspace (admins) and personal (Settings), with defaults; a color profile per design for the screen display of print colors and the download default
- [x] Print-file checks: proof in the browser (soft proof through the ICC profile, single plates, ink coverage against a TAC limit, out-of-gamut colours) and output check of the real file (structure in the browser, plates separated by Ghostscript on the server); preflight hints for hairlines, small text in several inks, artwork at the edge without bleed
- [x] Serial print: CSV/text/XLSX/pasted data, {{Column}} placeholders, column per text/barcode/QR, per-row encoding with invalid rows listed, preview, into download or print ([spec 46](roadmap/46-serial-print.md))
- [x] Imposition: several on one sheet (A4/A3/SRA3/Letter/custom), best fit with turning, gap, cut marks, repeat or in order; vector PDF via forms, image PDF and printing ([spec 45](roadmap/45-imposition.md))
- [x] Print and export defaults per folder, inherited by subfolders, before personal defaults ([spec 44](roadmap/44-folder-print-defaults.md))
- [x] Print files only after approval: workspace rule, print PDF/TIFF/EPS/printing and the server's render.pdf held back until the design is approved, approvers exempt, print proof (soft proof, plates, TAC) in the approval banner ([spec 47](roadmap/47-print-approval.md))
- [x] Finished size in the export profile: designs of another size (or turned) named in the download menu, Change format for exactly those ([spec 48](roadmap/48-profile-finished-size.md))
- [x] Export profiles and print presets: named settings, personal or per workspace, with defaults and full management (create, edit every setting, rename, default, duplicate, delete; own in Settings, the workspace's on its Members page)
- [x] Print from the editor and the dashboard (one design or a selection): paper handed to the driver (each page's own size, or A4/A3/Letter), actual size or fitted, 150 to 1200 dpi (203 dpi for label printers), bleed and crop marks
- [x] Website generator (static HTML, SEO, nav, file export), local generation only
- [x] Social publish planner, local/mock only

### Accounts, workspaces, platform
- [x] Roles and permissions per workspace: code-defined actions bundled into admin-defined permissions (own items or everything) and roles, full CRUD on one page, seeded Owner/Admin/Member/Viewer, no escalation, protected owner role, change log, command-line owner recovery ([spec 42](roadmap/42-roles-and-permissions.md))
- [x] Roles for single designs (named capability sets on a share); invitations and SSO join with any workspace role
- [x] Cookie sessions, MFA (TOTP), OIDC SSO
- [x] Per-workspace + per-user storage quotas with UI meters
- [x] Copy designs and folders to another folder of the same workspace; copy or move them to another workspace, uploads and library fonts included
- [x] Notifications (email + web-push preferences)
- [x] Dark mode (system/light/dark), app-wide reduced motion
- [x] Design accessibility checker (contrast/alt-text/reading-order/tap-target)

### Self-host and ops
- [x] Single self-daemonizing binary (service start/stop/restart/status/log)
- [x] First-run setup wizard (browser + CLI), reverse-proxy support
- [x] `storage migrate` local to S3
- [x] Multi-platform release binaries + checksums + generated notes
- [x] Lean channel-tagged Docker images, stable-branch-gated releases

## Pending

### AI media ([spec 23](roadmap/23-ai-media.md)), not started
- [ ] Captions, TTS, music generation, AI avatars, lip-sync, image-to-video (blocked on the video pipeline + audio/video model endpoints)

### Presentations ([spec 28](roadmap/28-presentations.md); the AI/generation remainder is broken down in [28-presentations-leverage-tasks.md](roadmap/28-presentations-leverage-tasks.md))
- [ ] Narration in the exported deck video; per-transition easing
- [ ] Tracked per-audience player links with passcodes and per-slide dwell analytics; iframe embed
- [ ] Camera bubble in present-and-record
- [ ] Live captions (blocked on the AI media pipeline, spec 23)
- [ ] PPTX fidelity: native chart/SmartArt import, animation and master-inheritance preservation
- [ ] 60fps present at scale (unverified)

### Whiteboard ([spec 30](roadmap/30-whiteboard.md))
- [ ] True infinite canvas; board-native ink and free-draw connectors
- [ ] Full facilitation suite (breakouts, spotlight/take-control, server-authoritative voting)
- [ ] AI canvas agents; diagram-as-code; performance at 10k+ objects

### Realtime ([spec 16](roadmap/16-realtime-collaboration.md))
- [ ] Per-page subdocuments + lazy load at scale
- [ ] True in-CRDT branches; server-authoritative last-leave snapshot
- [ ] On-the-wire per-node enforcement (needs a Go CRDT decoder)

### Accessibility, i18n, enterprise ([spec 38](roadmap/38-accessibility-i18n-security-compliance-selfhost-nfr.md))
- [ ] UI internationalization/localization; high-contrast theme; full keyboard model + assistive-tech tree
- [ ] SCIM, audit log, DLP, customer-managed keys (CMEK), data residency
- [ ] Observability (metrics/traces), Helm chart, compliance programs (SOC 2/ISO 27001), backup/DR drills

### Publishing gaps (marked in-product)
- [ ] Real social-account posting (currently local planner only)
- [ ] Hosted website publishing: domains, TLS, server-side password gate, form capture

### Sheets gaps
- [ ] Merge cells, frozen panes, filter views, function autocomplete
