-- Renaming other people's templates is its own action, template.rename.
-- Workspaces seeded before it gain the seeded "rename-templates" permission,
-- given to every role that may delete other people's templates today (owners
-- and admins unless changed): they could already replace such a template under
-- another name, so nobody gains a new power. Afterwards it can be granted or
-- taken on its own. Workspaces without roles yet are seeded with it.
--
-- Additive only: new rows, nothing changed or removed. A rollback ignores the
-- unknown action.
INSERT INTO "workspace_permissions" ("workspace_id", "seed_key", "actions")
SELECT w."id", 'rename-templates', '{"template.rename": "all"}'::jsonb
FROM "workspaces" w
WHERE EXISTS (SELECT 1 FROM "workspace_roles" r WHERE r."workspace_id" = w."id")
  AND NOT EXISTS (
    SELECT 1 FROM "workspace_permissions" p
    WHERE p."workspace_id" = w."id" AND p."seed_key" = 'rename-templates'
  );

INSERT INTO "workspace_role_permissions" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", rn."id"
FROM "workspace_role_permissions" rp
JOIN "workspace_permissions" p ON p."id" = rp."permission_id"
JOIN "workspace_roles" r ON r."id" = rp."role_id"
JOIN "workspace_permissions" rn ON rn."workspace_id" = r."workspace_id" AND rn."seed_key" = 'rename-templates'
WHERE p."actions" ? 'template.delete'
ON CONFLICT DO NOTHING;
