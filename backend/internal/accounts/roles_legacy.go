package accounts

// The pre-F42 "managed by" switches of export profiles and print presets,
// answered from the roles (F42 FR-11). Setting "members" gives the seeded
// Member role the matching team permission, "admins" takes it away; the
// legacy column is kept current for a release from before F42.

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"hycanvas/backend/internal/authz"
)

// legacyTeamPermission is the seeded bundle behind each switch.
func legacyTeamPermission(a authz.Action) (authz.SeedPermission, bool) {
	switch a {
	case authz.PrintExportProfiles:
		return authz.SeedExportProfilesTeam, true
	case authz.PrintPrintPresets:
		return authz.SeedPrintPresetsTeam, true
	}
	return authz.SeedPermission{}, false
}

// SeedRoleAllows reports whether the workspace's seeded role (by seed key)
// holds the action; false when that role no longer exists.
func (s *Service) SeedRoleAllows(ctx context.Context, workspaceID, roleSeedKey string, a authz.Action) (bool, error) {
	roles, err := loadRoleActions(ctx, s.db, workspaceID)
	if err != nil {
		return false, err
	}
	for _, r := range roles {
		if r.SeedKey == roleSeedKey {
			return r.Actions.Has(a), nil
		}
	}
	return false, nil
}

// SetLegacyManagedBy applies a "managed by" switch to the roles. The actor
// needs roles.manage (the switch was an owner/admin setting).
func (s *Service) SetLegacyManagedBy(ctx context.Context, actorID, workspaceID string, a authz.Action, members bool) error {
	perm, ok := legacyTeamPermission(a)
	if !ok {
		return ErrBadRequest
	}
	if err := s.Require(ctx, actorID, workspaceID, authz.RolesManage, ""); err != nil {
		return err
	}
	if err := s.EnsureRoles(ctx, s.db, workspaceID); err != nil {
		return err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var roleID string
	err = tx.QueryRow(ctx, `SELECT id FROM "workspace_roles" WHERE "workspace_id" = $1 AND "seed_key" = 'member'`, workspaceID).Scan(&roleID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound // the Member role was deleted: manage it on the roles page
	}
	if err != nil {
		return err
	}
	var permID string
	err = tx.QueryRow(ctx, `SELECT id FROM "workspace_permissions" WHERE "workspace_id" = $1 AND "seed_key" = $2`, workspaceID, perm.Key).Scan(&permID)
	if errors.Is(err, pgx.ErrNoRows) {
		if !members {
			return tx.Commit(ctx)
		}
		actions, _ := json.Marshal(perm.Actions)
		if err := tx.QueryRow(ctx,
			`INSERT INTO "workspace_permissions" ("workspace_id", "seed_key", "actions", "created_by", "updated_by") VALUES ($1, $2, $3, $4, $4) RETURNING id`,
			workspaceID, perm.Key, actions, actorID).Scan(&permID); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	if members {
		_, err = tx.Exec(ctx, `INSERT INTO "workspace_role_permissions" ("role_id", "permission_id") VALUES ($1, $2) ON CONFLICT DO NOTHING`, roleID, permID)
	} else {
		_, err = tx.Exec(ctx, `DELETE FROM "workspace_role_permissions" WHERE "role_id" = $1 AND "permission_id" = $2`, roleID, permID)
	}
	if err != nil {
		return err
	}
	if err := logRoleEvent(ctx, tx, workspaceID, actorID, "role.permissions", roleID, nil, map[string]any{"permission": perm.Key, "on": members}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// logRoleEvent records a change to permissions, roles or assignments (FR-10).
func logRoleEvent(ctx context.Context, q interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}, workspaceID, actorID, kind, targetID string, before, after any) error {
	b, _ := json.Marshal(before)
	a, _ := json.Marshal(after)
	var target any
	if targetID != "" {
		target = targetID
	}
	var actor any
	if actorID != "" {
		actor = actorID
	}
	_, err := q.Exec(ctx, `INSERT INTO "workspace_role_events" ("workspace_id", "actor_id", "kind", "target_id", "before", "after")
		VALUES ($1, $2, $3, $4, $5, $6)`, workspaceID, actor, kind, target, nullJSON(b), nullJSON(a))
	return err
}

func nullJSON(b []byte) any {
	if len(b) == 0 || string(b) == "null" {
		return nil
	}
	return b
}
