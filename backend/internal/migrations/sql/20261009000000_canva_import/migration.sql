-- Import from Canva (docs/roadmap/41-canva-import.md).
--
-- canva_integrations: the Canva integration a workspace admin registered in
-- Canva's developer portal (Client ID + secret). One per workspace.
-- canva_connections: a member's own Canva account, connected through OAuth
-- (PKCE); tokens per user and workspace.
-- canva_oauth_states: the short-lived state of a connect in progress (the
-- PKCE verifier stays on the server, never in the browser).
-- canva_imports: which Canva design became which danvas design, so a re-run
-- skips what is already there.
--
-- Secrets are encrypted at rest with the same AES-256-GCM machinery as the AI
-- keys (cipher/iv/tag columns, key from AI_SECRET); none is ever returned by
-- the API.
--
-- Additive only: new tables, nothing existing changes. Deploys onto a live
-- instance with no window; a rollback leaves them unused.
CREATE TABLE IF NOT EXISTS "canva_integrations" (
    "workspace_id"  UUID PRIMARY KEY REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "client_id"     TEXT NOT NULL,
    "secret_cipher" TEXT NOT NULL,
    "secret_iv"     TEXT NOT NULL,
    "secret_tag"    TEXT NOT NULL,
    "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "canva_connections" (
    "workspace_id"   UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "user_id"        UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "display_name"   TEXT NOT NULL DEFAULT '',
    "access_cipher"  TEXT NOT NULL,
    "access_iv"      TEXT NOT NULL,
    "access_tag"     TEXT NOT NULL,
    "refresh_cipher" TEXT NOT NULL,
    "refresh_iv"     TEXT NOT NULL,
    "refresh_tag"    TEXT NOT NULL,
    "expires_at"     TIMESTAMPTZ NOT NULL,
    "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY ("workspace_id", "user_id")
);

CREATE TABLE IF NOT EXISTS "canva_oauth_states" (
    "state"           TEXT PRIMARY KEY,
    "workspace_id"    UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "user_id"         UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "verifier_cipher" TEXT NOT NULL,
    "verifier_iv"     TEXT NOT NULL,
    "verifier_tag"    TEXT NOT NULL,
    "redirect_uri"    TEXT NOT NULL,
    "return_to"       TEXT NOT NULL DEFAULT '/dashboard/',
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "canva_imports" (
    "workspace_id"    UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "canva_design_id" TEXT NOT NULL,
    "design_id"       UUID NOT NULL REFERENCES "designs"("id") ON DELETE CASCADE,
    "imported_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY ("workspace_id", "canva_design_id")
);
