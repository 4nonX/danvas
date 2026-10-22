package accounts

// Seeding and reconciling workspace roles (F42 FR-4, FR-5). EnsureRoles is the
// one place that puts a workspace in order: it creates the seeded permissions
// and roles when the workspace has none, and gives every membership,
// invitation and the SSO auto-join setting the role matching its legacy enum
// value when it has no role yet, or when the two disagree (a release from
// before F42 changed the enum during a rollback: the newer change wins). It
// runs when a workspace is created, after anyone joins, and for every
// workspace on boot, so there is no second seeding path to drift.

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"hycanvas/backend/internal/authz"
)

// EnsureRoles seeds and reconciles one workspace. q may be the pool or an open
// transaction; the work runs in its own (nested) transaction, serialized per
// workspace by an advisory lock so concurrent callers and instances agree.
func (s *Service) EnsureRoles(ctx context.Context, q DBTX, workspaceID string) error {
	tx, err := q.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('workspace-roles:' || $1))`, workspaceID); err != nil {
		return err
	}
	if err := seedRolesTx(ctx, tx, workspaceID); err != nil {
		return err
	}
	if err := reconcileRolesTx(ctx, tx, workspaceID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// BackfillRoles runs EnsureRoles for every workspace (on boot). A failure in
// one workspace is reported and the rest still run.
func (s *Service) BackfillRoles(ctx context.Context) (int, error) {
	rows, err := s.db.Query(ctx, `SELECT id FROM "workspaces"`)
	if err != nil {
		return 0, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	var firstErr error
	for _, id := range ids {
		if err := s.EnsureRoles(ctx, s.db, id); err != nil && firstErr == nil {
			firstErr = fmt.Errorf("workspace %s: %w", id, err)
		}
	}
	return len(ids), firstErr
}

func seedRolesTx(ctx context.Context, tx pgx.Tx, workspaceID string) error {
	var n int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM "workspace_roles" WHERE "workspace_id" = $1`, workspaceID).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	// The pre-F42 "managed by members" switches carry over (FR-11).
	var exportBy, printBy string
	err := tx.QueryRow(ctx,
		`SELECT "profiles_managed_by", "print_presets_managed_by" FROM "workspace_export_settings" WHERE "workspace_id" = $1`,
		workspaceID).Scan(&exportBy, &printBy)
	if err != nil && err != pgx.ErrNoRows {
		return err
	}
	plan := authz.PlanSeed(authz.SeedOptions{
		ExportProfilesByMembers: exportBy == "members",
		PrintPresetsByMembers:   printBy == "members",
	})
	permIDs := map[string]string{}
	for _, p := range plan.Permissions {
		actions, _ := json.Marshal(p.Actions)
		var id string
		if err := tx.QueryRow(ctx,
			`INSERT INTO "workspace_permissions" ("workspace_id", "seed_key", "actions") VALUES ($1, $2, $3) RETURNING id`,
			workspaceID, p.Key, actions).Scan(&id); err != nil {
			return err
		}
		permIDs[p.Key] = id
	}
	for _, r := range plan.Roles {
		var id string
		if err := tx.QueryRow(ctx,
			`INSERT INTO "workspace_roles" ("workspace_id", "seed_key", "protected") VALUES ($1, $2, $3) RETURNING id`,
			workspaceID, r.Key, r.Protected).Scan(&id); err != nil {
			return err
		}
		for _, pk := range r.Permissions {
			if _, err := tx.Exec(ctx,
				`INSERT INTO "workspace_role_permissions" ("role_id", "permission_id") VALUES ($1, $2)`, id, permIDs[pk]); err != nil {
				return err
			}
		}
	}
	return nil
}

// roleBases loads every role of the workspace with its derived base role.
func roleBases(ctx context.Context, tx pgx.Tx, workspaceID string) (byID map[string]string, bySeed map[string]string, err error) {
	roles, err := loadRoleActions(ctx, tx, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	byID = map[string]string{}
	bySeed = map[string]string{}
	for _, r := range roles {
		byID[r.ID] = authz.BaseRole(r.Protected, r.Actions)
		if r.SeedKey != "" {
			bySeed[r.SeedKey] = r.ID
		}
	}
	return byID, bySeed, nil
}

// legacyTarget picks the role for a legacy enum value: the seeded role of
// that name, or failing that (it was deleted) any role with that base role.
func legacyTarget(enum string, byID, bySeed map[string]string) string {
	enum = strings.ToLower(enum)
	if id, ok := bySeed[enum]; ok {
		return id
	}
	for id, base := range byID {
		if base == enum {
			return id
		}
	}
	return ""
}

func reconcileRolesTx(ctx context.Context, tx pgx.Tx, workspaceID string) error {
	byID, bySeed, err := roleBases(ctx, tx, workspaceID)
	if err != nil {
		return err
	}
	fix := func(table, keyCol, enumCol, extra string) error {
		rows, err := tx.Query(ctx, fmt.Sprintf(
			`SELECT %s, %s::text, "role_id" FROM %s WHERE "workspace_id" = $1 %s`, keyCol, enumCol, table, extra), workspaceID)
		if err != nil {
			return err
		}
		type row struct{ key, enum, roleID string }
		var todo []row
		for rows.Next() {
			var key, enum string
			var roleID *string
			if err := rows.Scan(&key, &enum, &roleID); err != nil {
				rows.Close()
				return err
			}
			cur := ""
			if roleID != nil {
				cur = *roleID
			}
			if cur != "" && byID[cur] == strings.ToLower(enum) {
				continue // in order
			}
			if target := legacyTarget(enum, byID, bySeed); target != "" && target != cur {
				todo = append(todo, row{key, enum, target})
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		for _, r := range todo {
			if _, err := tx.Exec(ctx, fmt.Sprintf(`UPDATE %s SET "role_id" = $1 WHERE %s = $2`, table, keyCol), r.roleID, r.key); err != nil {
				return err
			}
		}
		return nil
	}
	if err := fix(`"workspace_members"`, "id", "role", ""); err != nil {
		return err
	}
	if err := fix(`"invitations"`, "id", "role", `AND "accepted_at" IS NULL`); err != nil {
		return err
	}
	return fix(`"workspace_sso_join"`, `"workspace_id"`, "role", "")
}
