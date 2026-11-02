-- A template's whole life is rights in the role now, nothing is built in for its
-- creator: template.edit is new, and it, template.rename and template.delete are
-- scoped (own: templates the member created). Workspaces seeded before it gain
-- three seeded permissions:
--   "edit-templates" (template.edit on all), on every role that may delete all
--   templates (owners and admins unless changed);
--   "edit-own-templates" (template.edit and template.rename on own) and
--   "delete-own-templates" (template.delete on own), on every role that may
--   create templates (their creators, members included).
-- Workspaces without roles yet are seeded with them.
--
-- Additive only: new rows, nothing changed or removed.
INSERT INTO "workspace_permissions" ("workspace_id", "seed_key", "actions")
SELECT w."id", s.key, s.actions::jsonb
FROM "workspaces" w
CROSS JOIN (VALUES
  ('edit-templates', '{"template.edit": "all"}'),
  ('edit-own-templates', '{"template.edit": "own", "template.rename": "own"}'),
  ('delete-own-templates', '{"template.delete": "own"}')
) AS s(key, actions)
WHERE EXISTS (SELECT 1 FROM "workspace_roles" r WHERE r."workspace_id" = w."id")
  AND NOT EXISTS (
    SELECT 1 FROM "workspace_permissions" p
    WHERE p."workspace_id" = w."id" AND p."seed_key" = s.key
  );

-- Only delete on all counts: delete on own, seeded below, is no reason to edit
-- everything.
INSERT INTO "workspace_role_permissions" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", np."id"
FROM "workspace_role_permissions" rp
JOIN "workspace_permissions" p ON p."id" = rp."permission_id"
JOIN "workspace_roles" r ON r."id" = rp."role_id"
JOIN "workspace_permissions" np ON np."workspace_id" = r."workspace_id" AND np."seed_key" = 'edit-templates'
WHERE p."actions"->>'template.delete' = 'all'
ON CONFLICT DO NOTHING;

INSERT INTO "workspace_role_permissions" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", np."id"
FROM "workspace_role_permissions" rp
JOIN "workspace_permissions" p ON p."id" = rp."permission_id"
JOIN "workspace_roles" r ON r."id" = rp."role_id"
JOIN "workspace_permissions" np ON np."workspace_id" = r."workspace_id" AND np."seed_key" IN ('edit-own-templates', 'delete-own-templates')
WHERE p."actions" ? 'template.publish'
ON CONFLICT DO NOTHING;
