-- Logo versions (F50): the versions every logo of a brand kit comes in
-- (colour, black, white, ...), named per kit, each for a light or a dark
-- ground. Each logo then holds one file per version in logos[].versions.
--
-- Additive only: a new column with an empty default; existing kits keep their
-- logos as they are. A rollback ignores the column.
ALTER TABLE "brand_kits" ADD COLUMN IF NOT EXISTS "logo_versions" JSONB NOT NULL DEFAULT '[]'::jsonb;
