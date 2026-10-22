-- Workspace roles and permissions (F42, docs/roadmap/42-roles-and-permissions.md).
--
-- workspace_permissions: named bundles of actions, per workspace. "actions" is a
-- JSON object of action key to scope ("own" or "all"). Seeded rows carry their
-- seed_key; a NULL name means "the seeded name, in the reader's language".
-- workspace_roles: named sets of permissions, per workspace; the protected one
-- is the owner role (every action, cannot be edited or deleted).
-- workspace_role_permissions: which permissions a role holds.
-- workspace_role_events: the change log of permissions, roles and assignments.
--
-- workspace_members, invitations and workspace_sso_join get a nullable role_id.
-- The legacy "role" columns stay and are kept equal to the role's derived base
-- role, so a release from before F42 still reads a sensible rank.
--
-- No rows are written here: the server seeds every workspace on boot and on
-- creation (internal/accounts, roles_seed.go), from one definition.
--
-- Additive only: new tables and nullable columns, nothing existing changes. A
-- rollback leaves them unused.
CREATE TABLE IF NOT EXISTS "workspace_permissions" (
    "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "seed_key"     TEXT,
    "name"         TEXT,
    "description"  TEXT NOT NULL DEFAULT '',
    "actions"      JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_by"   UUID REFERENCES "users"("id") ON DELETE SET NULL,
    "updated_by"   UUID REFERENCES "users"("id") ON DELETE SET NULL,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "workspace_permissions_workspace_idx" ON "workspace_permissions" ("workspace_id");
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_permissions_seed_key" ON "workspace_permissions" ("workspace_id", "seed_key") WHERE "seed_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_permissions_name_key" ON "workspace_permissions" ("workspace_id", lower("name")) WHERE "name" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "workspace_roles" (
    "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "seed_key"     TEXT,
    "name"         TEXT,
    "description"  TEXT NOT NULL DEFAULT '',
    "protected"    BOOLEAN NOT NULL DEFAULT false,
    "created_by"   UUID REFERENCES "users"("id") ON DELETE SET NULL,
    "updated_by"   UUID REFERENCES "users"("id") ON DELETE SET NULL,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "workspace_roles_workspace_idx" ON "workspace_roles" ("workspace_id");
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_roles_seed_key" ON "workspace_roles" ("workspace_id", "seed_key") WHERE "seed_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_roles_name_key" ON "workspace_roles" ("workspace_id", lower("name")) WHERE "name" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_roles_one_protected" ON "workspace_roles" ("workspace_id") WHERE "protected";

CREATE TABLE IF NOT EXISTS "workspace_role_permissions" (
    "role_id"       UUID NOT NULL REFERENCES "workspace_roles"("id") ON DELETE CASCADE,
    "permission_id" UUID NOT NULL REFERENCES "workspace_permissions"("id") ON DELETE CASCADE,
    PRIMARY KEY ("role_id", "permission_id")
);
CREATE INDEX IF NOT EXISTS "workspace_role_permissions_permission_idx" ON "workspace_role_permissions" ("permission_id");

CREATE TABLE IF NOT EXISTS "workspace_role_events" (
    "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "actor_id"     UUID REFERENCES "users"("id") ON DELETE SET NULL,
    "kind"         TEXT NOT NULL,
    "target_id"    UUID,
    "before"       JSONB,
    "after"        JSONB,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "workspace_role_events_workspace_idx" ON "workspace_role_events" ("workspace_id", "created_at" DESC);

-- A role in use cannot be deleted (RESTRICT): its members are moved first.
ALTER TABLE "workspace_members" ADD COLUMN IF NOT EXISTS "role_id" UUID REFERENCES "workspace_roles"("id") ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS "workspace_members_role_idx" ON "workspace_members" ("role_id");
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "role_id" UUID REFERENCES "workspace_roles"("id") ON DELETE SET NULL;
ALTER TABLE "workspace_sso_join" ADD COLUMN IF NOT EXISTS "role_id" UUID REFERENCES "workspace_roles"("id") ON DELETE SET NULL;
