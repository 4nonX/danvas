package accounts

import (
	"context"
	"log/slog"
	"strings"

	"github.com/google/uuid"
)

// SSO join: a team workspace can take in everyone who signs in through the
// instance's OIDC provider, at a fixed role. Owners and admins switch it on
// for their workspace; from then on every SSO sign-in adds the person (first
// sign-in and every later one), and switching it on adds everyone who already
// has an SSO account. Higher roles are never lowered. Someone removed from the
// workspace (or who left it) is not added back; an accepted invitation lifts
// that.

// ssoJoinRoles are the roles a workspace may hand out this way.
var ssoJoinRoles = map[string]bool{"member": true, "viewer": true}

// SsoJoin is a workspace's SSO join setting; Role is empty when it is off.
type SsoJoin struct {
	Role string `json:"role"`
}

// GetSsoJoin returns the setting; any member may read it.
func (s *Service) GetSsoJoin(ctx context.Context, callerID, workspaceID string) (SsoJoin, error) {
	if err := s.AssertMember(ctx, callerID, workspaceID, "viewer"); err != nil {
		return SsoJoin{}, err
	}
	var role string
	_ = s.db.QueryRow(ctx, `SELECT role FROM "workspace_sso_join" WHERE "workspace_id" = $1`, workspaceID).Scan(&role)
	return SsoJoin{Role: strings.ToLower(role)}, nil
}

// SetSsoJoin switches the setting (role "" = off) and, when on, adds everyone
// with an SSO account at once. It returns how many people were added.
func (s *Service) SetSsoJoin(ctx context.Context, callerID, workspaceID, role string) (int, error) {
	role = strings.ToLower(strings.TrimSpace(role))
	if role != "" && !ssoJoinRoles[role] {
		return 0, ErrBadRequest
	}
	if err := s.AssertMember(ctx, callerID, workspaceID, "admin"); err != nil {
		return 0, err
	}
	kind, _, err := s.workspaceMeta(ctx, workspaceID)
	if err != nil {
		return 0, err
	}
	if kind == "personal" {
		return 0, ErrForbidden
	}
	if role == "" {
		_, err := s.db.Exec(ctx, `DELETE FROM "workspace_sso_join" WHERE "workspace_id" = $1`, workspaceID)
		return 0, err
	}
	if _, err := s.db.Exec(ctx,
		`INSERT INTO "workspace_sso_join" ("workspace_id", role, "enabled_by", "updated_at") VALUES ($1, $2, $3, now())
		 ON CONFLICT ("workspace_id") DO UPDATE SET role = EXCLUDED.role, "enabled_by" = EXCLUDED."enabled_by", "updated_at" = now()`,
		workspaceID, strings.ToUpper(role), callerID); err != nil {
		return 0, err
	}
	// Everyone who already signs in through SSO, unless excluded or already in.
	ct, err := s.db.Exec(ctx,
		`INSERT INTO "workspace_members" (id, "workspace_id", "user_id", role, status, "joined_at", "updated_at")
		 SELECT gen_random_uuid(), $1, u.id, $2::"Role", 'ACTIVE', now(), now()
		 FROM "users" u
		 WHERE EXISTS (SELECT 1 FROM "auth_identities" a WHERE a."user_id" = u.id AND a.provider = 'OIDC')
		   AND NOT EXISTS (SELECT 1 FROM "workspace_sso_join_exclusions" x WHERE x."workspace_id" = $1 AND x."user_id" = u.id)
		 ON CONFLICT ("workspace_id", "user_id") DO NOTHING`,
		workspaceID, strings.ToUpper(role))
	if err != nil {
		return 0, err
	}
	return int(ct.RowsAffected()), nil
}

// applySsoJoin adds a person signing in through SSO to every workspace that
// takes in SSO sign-ins and that they are not part of (or excluded from).
// Best effort: a failure is logged and never blocks the sign-in.
func (s *Service) applySsoJoin(ctx context.Context, userID string) {
	if _, err := uuid.Parse(userID); err != nil {
		return
	}
	if _, err := s.db.Exec(ctx,
		`INSERT INTO "workspace_members" (id, "workspace_id", "user_id", role, status, "joined_at", "updated_at")
		 SELECT gen_random_uuid(), j."workspace_id", $1, j.role::"Role", 'ACTIVE', now(), now()
		 FROM "workspace_sso_join" j
		 WHERE NOT EXISTS (SELECT 1 FROM "workspace_sso_join_exclusions" x WHERE x."workspace_id" = j."workspace_id" AND x."user_id" = $1)
		 ON CONFLICT ("workspace_id", "user_id") DO NOTHING`, userID); err != nil {
		slog.Warn("sso join: could not add to workspaces", "user", userID, "err", err)
	}
}

// excludeFromSsoJoin keeps someone removed from (or leaving) a workspace that
// takes in SSO sign-ins from being added back.
func (s *Service) excludeFromSsoJoin(ctx context.Context, workspaceID, userID string) {
	if _, err := s.db.Exec(ctx,
		`INSERT INTO "workspace_sso_join_exclusions" ("workspace_id", "user_id")
		 SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM "workspace_sso_join" WHERE "workspace_id" = $1)
		 ON CONFLICT DO NOTHING`, workspaceID, userID); err != nil {
		slog.Warn("sso join: could not record a removal", "workspace", workspaceID, "user", userID, "err", err)
	}
}

// liftSsoJoinExclusion: an accepted invitation brings someone back for good.
func (s *Service) liftSsoJoinExclusion(ctx context.Context, workspaceID, userID string) {
	if _, err := s.db.Exec(ctx,
		`DELETE FROM "workspace_sso_join_exclusions" WHERE "workspace_id" = $1 AND "user_id" = $2`, workspaceID, userID); err != nil {
		slog.Warn("sso join: could not lift an exclusion", "workspace", workspaceID, "user", userID, "err", err)
	}
}
