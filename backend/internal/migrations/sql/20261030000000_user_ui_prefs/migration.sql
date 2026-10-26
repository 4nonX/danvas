-- Interface preferences per user, kept with the account so they follow the
-- person to every browser and device: for example the order of the element
-- rows in the editor, which rows are hidden and which elements are pinned.
-- One JSON value per key; the browser owns the shape of each value.
--
-- Additive only: a new table, nothing existing changes. A rollback ignores it
-- (the previous release keeps its preferences in the browser).
CREATE TABLE IF NOT EXISTS "user_ui_prefs" (
    "user_id"    UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "key"        TEXT NOT NULL,
    "value"      JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("user_id", "key")
);
