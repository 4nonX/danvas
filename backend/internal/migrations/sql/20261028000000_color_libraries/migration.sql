-- Colour libraries per workspace, for the colour list of a print export.
--
-- A workspace uploads a colour book it holds a licence for (an .ase or .acb
-- file, e.g. a Pantone book) or a house colour list (.csv); the browser reads
-- the file and only the entries (name, Lab, CMYK, RGB) are stored. The colour
-- list of an export names, per colour of the design, the nearest entry and
-- its distance (CIEDE2000). Nothing is shipped with the product.
--
-- Additive only: a new table, nothing existing changes. Deploys onto a live
-- instance with no window.
CREATE TABLE IF NOT EXISTS "color_libraries" (
    "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "workspace_id"  UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "name"          TEXT NOT NULL,
    "source_file"   TEXT NOT NULL DEFAULT '',
    "entries"       JSONB NOT NULL,
    "entry_count"   INTEGER NOT NULL,
    "created_by_id" UUID,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "color_libraries_workspace_idx" ON "color_libraries" ("workspace_id");
