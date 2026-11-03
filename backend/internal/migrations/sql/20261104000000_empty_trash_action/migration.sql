-- Emptying the trash in one go has its own right. Workspaces seeded before it
-- gain the seeded permission on every role that may manage roles (owners and
-- admins unless changed). Workspaces without roles yet are seeded with it.
--
-- Additive only: new rows, nothing changed or removed. A rollback ignores the
-- unknown action.
INSERT INTO "workspace_permissions" ("workspace_id", "seed_key", "actions")
SELECT w."id", 'empty-trash', '{"design.emptyTrash": "all"}'::jsonb
FROM "workspaces" w
WHERE EXISTS (SELECT 1 FROM "workspace_roles" r WHERE r."workspace_id" = w."id")
  AND NOT EXISTS (
    SELECT 1 FROM "workspace_permissions" p
    WHERE p."workspace_id" = w."id" AND p."seed_key" = 'empty-trash'
  );

INSERT INTO "workspace_role_permissions" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", np."id"
FROM "workspace_role_permissions" rp
JOIN "workspace_permissions" p ON p."id" = rp."permission_id"
JOIN "workspace_roles" r ON r."id" = rp."role_id"
JOIN "workspace_permissions" np ON np."workspace_id" = r."workspace_id"
  AND np."seed_key" = 'empty-trash'
WHERE p."actions" ? 'roles.manage'
ON CONFLICT DO NOTHING;
