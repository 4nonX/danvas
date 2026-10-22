-- Folder print defaults (F44): a dashboard folder names the export profile
-- and the print preset its designs open with. One per folder and kind; only
-- the workspace's own profiles (checked by the service). A folder without an
-- entry inherits the nearest folder above it that has one.
--
-- Deleting the folder or the profile removes the entry. Additive only: a new
-- table; a rollback leaves it unused.
CREATE TABLE IF NOT EXISTS "folder_export_defaults" (
    "folder_id"  UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "kind"       TEXT NOT NULL,
    "profile_id" UUID NOT NULL REFERENCES "export_profiles"("id") ON DELETE CASCADE,
    "updated_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY ("folder_id", "kind"),
    CONSTRAINT "folder_export_defaults_kind" CHECK ("kind" IN ('export', 'print'))
);
CREATE INDEX IF NOT EXISTS "folder_export_defaults_profile_idx" ON "folder_export_defaults" ("profile_id");
