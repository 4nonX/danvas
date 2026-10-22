# F44 Folder print defaults

A dashboard folder can name the export profile and the print preset its designs use by default, so a folder of labels opens the download menu and the print dialog with the label settings, and a folder of business cards with theirs, for everyone in the workspace.

## Requirements

- **FR-1 Storage.** `folder_export_defaults` (folder, kind `export` or `print`, profile): one default per folder and kind. Only the workspace's own profiles can be a folder default. Deleting the folder or the profile removes the entry (cascade); nothing else changes.
- **FR-2 Inheritance.** A folder without its own default uses the nearest folder above it that has one. Designs outside any folder have no folder default.
- **FR-3 Precedence.** When the download menu or the print dialog opens for designs of one folder: the folder's default (own or inherited), else the user's own default, else the workspace's default. The picker says where the chosen profile comes from.
- **FR-4 Who sets it.** The action `folder.defaults` (F42). Everyone who can see the folder sees its defaults.
- **FR-5 Where.** The folder's menu on the dashboard, **Print and export defaults**: one picker per kind (the workspace's profiles, or none), and what a subfolder currently inherits.
- **FR-6 The editor knows the design's folder.** `GET /designs/{id}` returns `folderId`.
- **FR-7 Several designs.** A selection on the dashboard uses the folder default only when every selected design is in folders that resolve to the same profile.

## Acceptance

- **AC-1** With a folder default set, the download menu and the print dialog of a design in that folder (or a subfolder) open with it, also for a user with a default of their own.
- **AC-2** Only roles with `folder.defaults` can set or clear a default; a personal profile or one of another workspace is refused.
- **AC-3** Deleting the profile or the folder leaves no stale default; moving a design to another folder changes its defaults with it.
