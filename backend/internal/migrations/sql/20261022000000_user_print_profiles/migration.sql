-- Personal print colour profiles (ICC), next to the workspace ones in
-- "print_profiles": anyone may upload the profile their print shop sent
-- them and use it in every workspace, without asking an admin. Workspace
-- profiles stay as they are (admins manage them, every member uses them).
--
-- A user may mark one of their own as their default; the download menu then
-- starts with it ahead of the workspace's default. The bytes live in the row,
-- as for workspace profiles, so they travel with database backups.
--
-- Additive only: a new table, nothing existing changes. A rollback leaves it
-- unused.
CREATE TABLE IF NOT EXISTS "user_print_profiles" (
    "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id"      UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "name"         TEXT NOT NULL,
    "description"  TEXT NOT NULL DEFAULT '',
    "color_space"  TEXT NOT NULL,
    "icc_version"  TEXT NOT NULL DEFAULT '',
    "size_bytes"   INTEGER NOT NULL,
    "checksum"     TEXT NOT NULL,
    "data"         BYTEA NOT NULL,
    "is_default"   BOOLEAN NOT NULL DEFAULT false,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "user_print_profiles_user_idx" ON "user_print_profiles" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "user_print_profiles_user_checksum_key" ON "user_print_profiles" ("user_id", "checksum");
