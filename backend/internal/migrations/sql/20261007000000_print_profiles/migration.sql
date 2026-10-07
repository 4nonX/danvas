-- Print colour profiles (ICC) per workspace, for CMYK exports.
--
-- A workspace admin uploads the output profile their print shop works to
-- (e.g. PSO Coated v3 / FOGRA51); exports convert to CMYK through it and
-- embed it. The bytes live in the row: profiles are a few MB, a workspace has
-- a handful, and keeping them in the database puts them in every database
-- backup with the designs that rely on them.
--
-- Additive only: a new table, nothing existing changes. Deploys onto a live
-- instance with no window.
CREATE TABLE IF NOT EXISTS "print_profiles" (
    "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "workspace_id"  UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "name"          TEXT NOT NULL,
    "description"   TEXT NOT NULL DEFAULT '',
    "color_space"   TEXT NOT NULL,
    "icc_version"   TEXT NOT NULL DEFAULT '',
    "size_bytes"    INTEGER NOT NULL,
    "checksum"      TEXT NOT NULL,
    "data"          BYTEA NOT NULL,
    "is_default"    BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "print_profiles_workspace_idx" ON "print_profiles" ("workspace_id");
CREATE UNIQUE INDEX IF NOT EXISTS "print_profiles_workspace_checksum_key" ON "print_profiles" ("workspace_id", "checksum");
