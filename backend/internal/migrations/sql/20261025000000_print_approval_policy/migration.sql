-- Print files only after approval (F47): a workspace can require that a
-- design's print files (print PDF, TIFF, EPS, printing) are made only once
-- the design is approved. Off unless set. Additive only: a new column with a
-- default; a rollback ignores it.
ALTER TABLE "workspace_export_settings" ADD COLUMN IF NOT EXISTS "require_approval_for_print" BOOLEAN NOT NULL DEFAULT false;
