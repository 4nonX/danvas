-- Adding the colour list to a download becomes its own action,
-- design.colorList. Workspaces seeded before it gain the seeded "color-list"
-- permission, given to every role that may download designs today, so
-- nobody gains or loses anything; afterwards it can be taken from a role on
-- its own. Workspaces without roles yet are seeded with it.
--
-- Additive only: new rows, nothing changed or removed. A rollback ignores the
-- unknown action.
INSERT INTO "workspace_permissions" ("workspace_id", "seed_key", "actions")
SELECT w."id", 'color-list', '{"design.colorList": "all"}'::jsonb
FROM "workspaces" w
WHERE EXISTS (SELECT 1 FROM "workspace_roles" r WHERE r."workspace_id" = w."id")
  AND NOT EXISTS (
    SELECT 1 FROM "workspace_permissions" p
    WHERE p."workspace_id" = w."id" AND p."seed_key" = 'color-list'
  );

INSERT INTO "workspace_role_permissions" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", cl."id"
FROM "workspace_role_permissions" rp
JOIN "workspace_permissions" p ON p."id" = rp."permission_id"
JOIN "workspace_roles" r ON r."id" = rp."role_id"
JOIN "workspace_permissions" cl ON cl."workspace_id" = r."workspace_id" AND cl."seed_key" = 'color-list'
WHERE p."actions" ? 'design.download'
ON CONFLICT DO NOTHING;
