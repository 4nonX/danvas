package accounts

// Assigning roles (F42 FR-4, FR-8): resolving a role reference, the caller's
// role read under a row lock, and the guard rails every assignment passes.

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"hycanvas/backend/internal/authz"
)

// wsRole is one role of a workspace with its effective actions.
type wsRole struct {
	ID        string
	SeedKey   string
	Protected bool
	Actions   authz.ActionSet
}

// Base is the legacy enum value kept on memberships holding this role.
func (r wsRole) Base() string { return authz.BaseRole(r.Protected, r.Actions) }

type rowQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func workspaceRoles(ctx context.Context, q rowQuerier, workspaceID string) (map[string]wsRole, error) {
	list, err := loadRoleActions(ctx, q, workspaceID)
	if err != nil {
		return nil, err
	}
	out := make(map[string]wsRole, len(list))
	for _, r := range list {
		out[r.ID] = wsRole{ID: r.ID, SeedKey: r.SeedKey, Protected: r.Protected, Actions: r.Actions}
	}
	return out, nil
}

// resolveRole finds the role a reference names: a role id of the workspace,
// or a legacy role name ("owner", "admin", "member", "viewer"), which means
// the seeded role of that name (or, when it was deleted, a role with that
// base). Unknown references are ErrBadRequest.
func resolveRole(ctx context.Context, q rowQuerier, workspaceID, ref string) (wsRole, error) {
	roles, err := workspaceRoles(ctx, q, workspaceID)
	if err != nil {
		return wsRole{}, err
	}
	ref = strings.TrimSpace(ref)
	if _, perr := uuid.Parse(ref); perr == nil {
		if r, ok := roles[ref]; ok {
			return r, nil
		}
		return wsRole{}, ErrBadRequest
	}
	name := strings.ToLower(ref)
	if _, ok := roleRank[name]; !ok {
		return wsRole{}, ErrBadRequest
	}
	var fallback *wsRole
	for _, r := range roles {
		if r.SeedKey == name {
			return r, nil
		}
		if fallback == nil && r.Base() == name {
			rr := r
			fallback = &rr
		}
	}
	if fallback != nil {
		return *fallback, nil
	}
	return wsRole{}, ErrBadRequest
}

// roleOfMember reads a member's role inside q (with FOR UPDATE when lock is
// set, so a concurrent change of that member cannot be bypassed). ok is false
// for a non-member. A membership without a role yet reads as its legacy one.
func roleOfMember(ctx context.Context, q interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	rowQuerier
}, userID, workspaceID string, lock bool) (wsRole, bool, error) {
	sql := `SELECT role::text, "role_id" FROM "workspace_members" WHERE "workspace_id"=$1 AND "user_id"=$2 AND status='ACTIVE'`
	if lock {
		sql += ` FOR UPDATE`
	}
	var legacy string
	var roleID *string
	if err := q.QueryRow(ctx, sql, workspaceID, userID).Scan(&legacy, &roleID); err != nil {
		if err == pgx.ErrNoRows {
			return wsRole{}, false, nil
		}
		return wsRole{}, false, err
	}
	if roleID != nil {
		roles, err := workspaceRoles(ctx, q, workspaceID)
		if err != nil {
			return wsRole{}, false, err
		}
		if r, ok := roles[*roleID]; ok {
			return r, true, nil
		}
	}
	r, err := resolveRole(ctx, q, workspaceID, strings.ToLower(legacy))
	if err != nil {
		// Unseeded workspace: the legacy rights.
		return wsRole{SeedKey: strings.ToLower(legacy), Protected: strings.EqualFold(legacy, "owner"),
			Actions: authz.PlanSeed(authz.SeedOptions{}).RoleActions(strings.ToLower(legacy))}, true, nil
	}
	return r, true, nil
}

// mayHandOut is the no-escalation rule: the caller can give a role only when
// they hold every action of it (at least as widely), and only holders of the
// protected role hand out the protected role.
func mayHandOut(caller, target wsRole) bool {
	if target.Protected {
		return caller.Protected
	}
	return caller.Actions.Covers(target.Actions)
}
