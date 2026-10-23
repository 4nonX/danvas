-- Maintaining a brand kit's library (F50) becomes its own action,
-- brand.library, split from brand.kits. Workspaces seeded before it gain the
-- seeded "brand-library" permission, given to every role that may manage
-- brand kits today, so nobody gains or loses a right; afterwards it can be
-- granted on its own. Workspaces without roles yet are seeded with it.
--
-- Additive only: new rows, nothing changed or removed. A rollback ignores the
-- unknown action.
INSERT INTO "workspace_permissions" ("workspace_id", "seed_key", "actions")
SELECT w."id", 'brand-library', '{"brand.library": "all"}'::jsonb
FROM "workspaces" w
WHERE EXISTS (SELECT 1 FROM "workspace_roles" r WHERE r."workspace_id" = w."id")
  AND NOT EXISTS (
    SELECT 1 FROM "workspace_permissions" p
    WHERE p."workspace_id" = w."id" AND p."seed_key" = 'brand-library'
  );

INSERT INTO "workspace_role_permissions" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", lib."id"
FROM "workspace_role_permissions" rp
JOIN "workspace_permissions" p ON p."id" = rp."permission_id"
JOIN "workspace_roles" r ON r."id" = rp."role_id"
JOIN "workspace_permissions" lib ON lib."workspace_id" = r."workspace_id" AND lib."seed_key" = 'brand-library'
WHERE p."actions" ? 'brand.kits'
ON CONFLICT DO NOTHING;
