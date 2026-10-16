-- Everyone who signs in through SSO joins a workspace (internal/accounts,
-- ssojoin.go).
--
-- workspace_sso_join: a team workspace that takes in everyone signing in
-- through the instance's OIDC provider, at the given role (MEMBER or VIEWER).
-- No row = off.
-- workspace_sso_join_exclusions: people removed from such a workspace (or who
-- left it); they are not added back automatically. An accepted invitation
-- lifts the exclusion.
--
-- Additive only: new tables, nothing existing changes. A rollback leaves them
-- unused (memberships already created stay as they are).
CREATE TABLE IF NOT EXISTS "workspace_sso_join" (
    "workspace_id" UUID PRIMARY KEY REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "role"         TEXT NOT NULL,
    "enabled_by"   UUID REFERENCES "users"("id") ON DELETE SET NULL,
    "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "workspace_sso_join_exclusions" (
    "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "user_id"      UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY ("workspace_id", "user_id")
);
