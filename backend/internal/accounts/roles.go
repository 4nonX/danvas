package accounts

// Effective actions and the one check every handler uses (F42 FR-3, FR-6).

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"

	"hycanvas/backend/internal/authz"
)

// ActionError is the 403 of a missing action: errors.Is(err, ErrForbidden)
// holds, and the API names the action in its problem code.
type ActionError struct{ Action authz.Action }

func (e *ActionError) Error() string        { return "forbidden: missing action " + string(e.Action) }
func (e *ActionError) Is(target error) bool { return target == ErrForbidden }

// roleActions is one role with its effective actions.
type roleActions struct {
	ID        string
	SeedKey   string
	Protected bool
	Actions   authz.ActionSet
}

// loadRoleActions loads every role of a workspace with the union of its
// permissions' actions (the protected role has every action).
func loadRoleActions(ctx context.Context, q interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}, workspaceID string) ([]roleActions, error) {
	rows, err := q.Query(ctx, `
		SELECT r.id, COALESCE(r."seed_key", ''), r."protected",
		       COALESCE(jsonb_agg(p."actions") FILTER (WHERE p.id IS NOT NULL), '[]'::jsonb)
		FROM "workspace_roles" r
		LEFT JOIN "workspace_role_permissions" rp ON rp."role_id" = r.id
		LEFT JOIN "workspace_permissions" p ON p.id = rp."permission_id"
		WHERE r."workspace_id" = $1
		GROUP BY r.id`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []roleActions
	for rows.Next() {
		var r roleActions
		var raw []byte
		if err := rows.Scan(&r.ID, &r.SeedKey, &r.Protected, &raw); err != nil {
			return nil, err
		}
		r.Actions = unionJSON(r.Protected, raw)
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, rows.Err()
}

func unionJSON(protected bool, raw []byte) authz.ActionSet {
	if protected {
		return authz.Everything()
	}
	var sets []authz.ActionSet
	_ = json.Unmarshal(raw, &sets)
	return authz.Union(sets...)
}

// MemberRole is the caller's role in a workspace with its effective actions.
type MemberRole struct {
	RoleID    string          `json:"roleId"`
	SeedKey   string          `json:"seedKey,omitempty"`
	Protected bool            `json:"protected"`
	Legacy    string          `json:"legacyRole"`
	Actions   authz.ActionSet `json:"actions"`
}

// EffectiveRole returns the caller's role and actions in a workspace, or
// ErrForbidden when they are not an active member. A membership without a
// role yet (written by a release from before F42) reads as the seeded role
// for its legacy enum value.
func (s *Service) EffectiveRole(ctx context.Context, userID, workspaceID string) (*MemberRole, error) {
	return LoadMemberRole(ctx, s.db, userID, workspaceID)
}

// Querier reads rows (satisfied by *pgxpool.Pool and pgx.Tx).
type Querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// LoadMemberRole is EffectiveRole for packages that hold only a database
// handle (sharing, brand): the one definition of a member's actions.
func LoadMemberRole(ctx context.Context, db Querier, userID, workspaceID string) (*MemberRole, error) {
	var legacy string
	var roleID *string
	var protected *bool
	var seedKey *string
	var raw []byte
	err := db.QueryRow(ctx, `
		SELECT m.role::text, m."role_id", r."protected", r."seed_key",
		       COALESCE(jsonb_agg(p."actions") FILTER (WHERE p.id IS NOT NULL), '[]'::jsonb)
		FROM "workspace_members" m
		LEFT JOIN "workspace_roles" r ON r.id = m."role_id"
		LEFT JOIN "workspace_role_permissions" rp ON rp."role_id" = r.id
		LEFT JOIN "workspace_permissions" p ON p.id = rp."permission_id"
		WHERE m."workspace_id" = $1 AND m."user_id" = $2 AND m.status = 'ACTIVE'
		GROUP BY m.role, m."role_id", r."protected", r."seed_key"`, workspaceID, userID).
		Scan(&legacy, &roleID, &protected, &seedKey, &raw)
	if err != nil {
		return nil, ErrForbidden
	}
	legacy = strings.ToLower(legacy)
	if roleID == nil || protected == nil {
		// Not reconciled yet: the seeded role of the legacy value, exactly the
		// pre-F42 rights.
		return &MemberRole{Legacy: legacy, SeedKey: legacy, Protected: legacy == "owner",
			Actions: authz.PlanSeed(seedOptionsOf(ctx, db, workspaceID)).RoleActions(legacy)}, nil
	}
	mr := &MemberRole{RoleID: *roleID, Protected: *protected, Legacy: legacy, Actions: unionJSON(*protected, raw)}
	if seedKey != nil {
		mr.SeedKey = *seedKey
	}
	return mr, nil
}

func seedOptionsOf(ctx context.Context, db Querier, workspaceID string) authz.SeedOptions {
	var exportBy, printBy string
	_ = db.QueryRow(ctx,
		`SELECT "profiles_managed_by", "print_presets_managed_by" FROM "workspace_export_settings" WHERE "workspace_id" = $1`,
		workspaceID).Scan(&exportBy, &printBy)
	return authz.SeedOptions{ExportProfilesByMembers: exportBy == "members", PrintPresetsByMembers: printBy == "members"}
}

// Require checks that the user may perform the action in the workspace.
// creatorID is who created the target (for scoped actions: "own" passes only
// for them); "" when the action has no single target.
func (s *Service) Require(ctx context.Context, userID, workspaceID string, a authz.Action, creatorID string) error {
	mr, err := s.EffectiveRole(ctx, userID, workspaceID)
	if err != nil {
		return err
	}
	if !mr.Actions.Allows(a, creatorID != "" && creatorID == userID) {
		return &ActionError{Action: a}
	}
	return nil
}

// Can is Require as a boolean, for read paths that only shape a response.
func (s *Service) Can(ctx context.Context, userID, workspaceID string, a authz.Action, creatorID string) bool {
	return s.Require(ctx, userID, workspaceID, a, creatorID) == nil
}

// IsActionError reports the missing action of a Require error.
func IsActionError(err error) (authz.Action, bool) {
	var ae *ActionError
	if errors.As(err, &ae) {
		return ae.Action, true
	}
	return "", false
}
