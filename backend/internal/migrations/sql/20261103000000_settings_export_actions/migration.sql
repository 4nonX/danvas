-- Exporting a workspace's settings to a file: one right per kind of setting, so
-- each can be given or taken on its own. Workspaces seeded before it gain one
-- seeded permission per kind, on every role that may manage roles (owners and
-- admins unless changed). Workspaces without roles yet are seeded with them.
--
-- Additive only: new rows, nothing changed or removed. A rollback ignores the
-- unknown actions.
INSERT INTO "workspace_permissions" ("workspace_id", "seed_key", "actions")
SELECT w."id", s.key, s.actions::jsonb
FROM "workspaces" w
CROSS JOIN (VALUES
  ('export-export-profiles', '{"export.exportProfiles": "all"}'),
  ('export-print-presets', '{"export.printPresets": "all"}'),
  ('export-color-profiles', '{"export.colorProfiles": "all"}'),
  ('export-color-libraries', '{"export.colorLibraries": "all"}'),
  ('export-roles', '{"export.roles": "all"}'),
  ('export-workspace-rules', '{"export.workspaceRules": "all"}'),
  ('export-folder-defaults', '{"export.folderDefaults": "all"}'),
  ('export-member-emails', '{"export.memberEmails": "all"}')
) AS s(key, actions)
WHERE EXISTS (SELECT 1 FROM "workspace_roles" r WHERE r."workspace_id" = w."id")
  AND NOT EXISTS (
    SELECT 1 FROM "workspace_permissions" p
    WHERE p."workspace_id" = w."id" AND p."seed_key" = s.key
  );

INSERT INTO "workspace_role_permissions" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", np."id"
FROM "workspace_role_permissions" rp
JOIN "workspace_permissions" p ON p."id" = rp."permission_id"
JOIN "workspace_roles" r ON r."id" = rp."role_id"
JOIN "workspace_permissions" np ON np."workspace_id" = r."workspace_id"
  AND np."seed_key" IN ('export-export-profiles', 'export-print-presets', 'export-color-profiles', 'export-color-libraries', 'export-roles', 'export-workspace-rules', 'export-folder-defaults', 'export-member-emails')
WHERE p."actions" ? 'roles.manage'
ON CONFLICT DO NOTHING;
