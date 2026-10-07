-- Workspace fonts: font files (WOFF2/WOFF/TTF/OTF) a workspace admin
-- uploads (custom and licensed typefaces), usable in every design of the
-- workspace and embedded by the vector exports. One row per face; a family
-- is the faces sharing a family name (weights, italics).
--
-- The bytes live in the row, like print profiles: a few hundred KB per face,
-- and they belong in the same database backups as the designs using them.
--
-- Additive only: a new table, nothing existing changes. Deploys onto a live
-- instance with no window.
CREATE TABLE IF NOT EXISTS "workspace_fonts" (
    "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "workspace_id"  UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "family"        TEXT NOT NULL,
    "weight"        INTEGER NOT NULL DEFAULT 400,
    "style"         TEXT NOT NULL DEFAULT 'normal',
    "file_name"     TEXT NOT NULL DEFAULT '',
    "format"        TEXT NOT NULL,
    "size_bytes"    INTEGER NOT NULL,
    "checksum"      TEXT NOT NULL,
    "data"          BYTEA NOT NULL,
    "created_by_id" UUID,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "workspace_fonts_workspace_idx" ON "workspace_fonts" ("workspace_id");
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_fonts_workspace_checksum_key" ON "workspace_fonts" ("workspace_id", "checksum");
