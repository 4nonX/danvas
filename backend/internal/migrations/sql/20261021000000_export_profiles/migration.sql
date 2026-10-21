-- Export profiles and print presets: named sets of output settings to send a
-- design out with the same settings again in one click
-- (internal/exportprofiles). "kind" keeps the two apart: "export" for the
-- download menu (format, size, colour, print-shop options), "print" for the
-- print dialog (size on paper, resolution, bleed and marks).
--
-- A profile belongs to exactly one owner: a user (personal, usable in every
-- workspace) or a workspace (shared by its members). Names are unique per
-- owner and kind, ignoring case, so everyone can tell profiles apart. Each
-- owner may mark one profile per kind as its default; a personal default
-- wins over the workspace's. The settings are stored as the client sends
-- them (a versioned JSON object), so new options need no migration.
--
-- workspace_export_settings: who may manage the workspace's profiles of each
-- kind, "admins" (owners and admins, the default when there is no row) or
-- "members" (every member who may edit).
--
-- Additive only: new tables, nothing existing changes. A rollback leaves them
-- unused.
CREATE TABLE IF NOT EXISTS "export_profiles" (
    "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "kind"         TEXT NOT NULL DEFAULT 'export',
    "workspace_id" UUID REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "user_id"      UUID REFERENCES "users"("id") ON DELETE CASCADE,
    "name"         TEXT NOT NULL,
    "description"  TEXT NOT NULL DEFAULT '',
    "settings"     JSONB NOT NULL,
    "is_default"   BOOLEAN NOT NULL DEFAULT false,
    "created_by"   UUID REFERENCES "users"("id") ON DELETE SET NULL,
    "updated_by"   UUID REFERENCES "users"("id") ON DELETE SET NULL,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "export_profiles_one_owner" CHECK (("workspace_id" IS NULL) <> ("user_id" IS NULL)),
    CONSTRAINT "export_profiles_kind" CHECK ("kind" IN ('export', 'print'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "export_profiles_workspace_name_key"
    ON "export_profiles" ("workspace_id", "kind", lower("name")) WHERE "workspace_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "export_profiles_user_name_key"
    ON "export_profiles" ("user_id", "kind", lower("name")) WHERE "user_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "export_profiles_workspace_default_key"
    ON "export_profiles" ("workspace_id", "kind") WHERE "workspace_id" IS NOT NULL AND "is_default";
CREATE UNIQUE INDEX IF NOT EXISTS "export_profiles_user_default_key"
    ON "export_profiles" ("user_id", "kind") WHERE "user_id" IS NOT NULL AND "is_default";

CREATE TABLE IF NOT EXISTS "workspace_export_settings" (
    "workspace_id"             UUID PRIMARY KEY REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "profiles_managed_by"      TEXT NOT NULL DEFAULT 'admins',
    "print_presets_managed_by" TEXT NOT NULL DEFAULT 'admins',
    "updated_by"               UUID REFERENCES "users"("id") ON DELETE SET NULL,
    "updated_at"               TIMESTAMPTZ NOT NULL DEFAULT now()
);
