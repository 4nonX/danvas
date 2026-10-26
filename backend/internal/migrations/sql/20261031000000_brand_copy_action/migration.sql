-- Copying brand kits into other workspaces becomes its own action,
-- brand.copy. Workspaces seeded before it gain the seeded "brand-copy"
-- permission, given to every role that may manage brand kits today (owners
-- and admins unless changed): they could already export a kit and import it
-- elsewhere, so nobody gains a right. Afterwards it can be granted or taken
-- on its own. Workspaces without roles yet are seeded with it.
--
-- Additive only: new rows, nothing changed or removed. A rollback ignores the
-- unknown action.
INSERT INTO "workspace_permissions" ("workspace_id", "seed_key", "actions")
SELECT w."id", 'brand-copy', '{"brand.copy": "all"}'::jsonb
FROM "workspaces" w
WHERE EXISTS (SELECT 1 FROM "workspace_roles" r WHERE r."workspace_id" = w."id")
  AND NOT EXISTS (
    SELECT 1 FROM "workspace_permissions" p
    WHERE p."workspace_id" = w."id" AND p."seed_key" = 'brand-copy'
  );

INSERT INTO "workspace_role_permissions" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", cp."id"
FROM "workspace_role_permissions" rp
JOIN "workspace_permissions" p ON p."id" = rp."permission_id"
JOIN "workspace_roles" r ON r."id" = rp."role_id"
JOIN "workspace_permissions" cp ON cp."workspace_id" = r."workspace_id" AND cp."seed_key" = 'brand-copy'
WHERE p."actions" ? 'brand.kits'
ON CONFLICT DO NOTHING;
