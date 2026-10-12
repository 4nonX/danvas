-- Server-side Canva import runs (docs/roadmap/41-canva-import.md).
--
-- canva_import_runs: one import a member started, executed by the server
-- (internal/canvaimport) so it continues with the browser closed and after a
-- restart. status: queued (waiting for a slot, or for the owner's previous
-- run), running, paused (Canva's daily limit; resumes at resume_at), done,
-- stopped (by its owner) or halted (could not continue: halted names why).
-- Progress counters and the failed designs are kept for the owner's progress
-- view until dismissed.
-- canva_import_run_designs: the Canva designs a run imported, so a run that
-- resumes after a restart does not count them twice.
--
-- Additive only: new tables, nothing existing changes. Deploys onto a live
-- instance with no window; a rollback leaves them unused.
CREATE TABLE IF NOT EXISTS "canva_import_runs" (
    "id"               UUID PRIMARY KEY,
    "workspace_id"     UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "user_id"          UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "target_folder_id" UUID,
    "picks"            JSONB NOT NULL,
    "untitled"         TEXT NOT NULL DEFAULT 'Untitled',
    "status"           TEXT NOT NULL DEFAULT 'queued',
    "stop_requested"   BOOLEAN NOT NULL DEFAULT false,
    "resume_at"        TIMESTAMPTZ,
    "total"            INTEGER,
    "imported"         INTEGER NOT NULL DEFAULT 0,
    "skipped"          INTEGER NOT NULL DEFAULT 0,
    "failed"           INTEGER NOT NULL DEFAULT 0,
    "as_images"        INTEGER NOT NULL DEFAULT 0,
    "current"          TEXT NOT NULL DEFAULT '',
    "waiting"          BOOLEAN NOT NULL DEFAULT false,
    "halted"           TEXT,
    "halted_detail"    TEXT,
    "failures"         JSONB NOT NULL DEFAULT '[]'::jsonb,
    "dismissed"        BOOLEAN NOT NULL DEFAULT false,
    "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
    "started_at"       TIMESTAMPTZ,
    "finished_at"      TIMESTAMPTZ,
    "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "canva_import_runs_user_idx" ON "canva_import_runs" ("user_id", "dismissed");
CREATE INDEX IF NOT EXISTS "canva_import_runs_status_idx" ON "canva_import_runs" ("status", "created_at");

CREATE TABLE IF NOT EXISTS "canva_import_run_designs" (
    "run_id"          UUID NOT NULL REFERENCES "canva_import_runs"("id") ON DELETE CASCADE,
    "canva_design_id" TEXT NOT NULL,
    PRIMARY KEY ("run_id", "canva_design_id")
);
