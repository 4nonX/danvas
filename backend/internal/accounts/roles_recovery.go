package accounts

// Recovery for self-hosters (F42 FR-9): give an existing user the owner role
// of a workspace from the server's command line, when nobody who could do it
// in the app is left. Never reachable through the API.

import (
	"context"
	"strings"

	"github.com/google/uuid"
)

// GrantOwner makes the user with this email an active owner of the workspace
// (by id or slug), adding the membership when needed. Returns the workspace
// id and name.
func (s *Service) GrantOwner(ctx context.Context, workspaceRef, email string) (string, string, error) {
	var wsID, wsName string
	ref := strings.TrimSpace(workspaceRef)
	q := `SELECT id::text, name FROM "workspaces" WHERE slug = $1`
	if _, err := uuid.Parse(ref); err == nil {
		q = `SELECT id::text, name FROM "workspaces" WHERE id = $1::uuid`
	}
	rows, err := s.db.Query(ctx, q, ref)
	if err != nil {
		return "", "", err
	}
	n := 0
	for rows.Next() {
		if err := rows.Scan(&wsID, &wsName); err != nil {
			rows.Close()
			return "", "", err
		}
		n++
	}
	rows.Close()
	if n == 0 {
		return "", "", ErrNotFound
	}
	if n > 1 {
		return "", "", ErrBadRequest // the slug is not unique: use the id
	}
	u, err := s.findUserByEmail(ctx, strings.ToLower(strings.TrimSpace(email)))
	if err != nil || u == nil {
		return "", "", ErrNotFound
	}
	if err := s.EnsureRoles(ctx, s.db, wsID); err != nil {
		return "", "", err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var ownerRole string
	if err := tx.QueryRow(ctx, `SELECT id::text FROM "workspace_roles" WHERE "workspace_id" = $1 AND protected`, wsID).Scan(&ownerRole); err != nil {
		return "", "", err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO "workspace_members" (id, "workspace_id", "user_id", role, "role_id", status, "joined_at", "updated_at")
		 VALUES ($1, $2, $3, 'OWNER', $4, 'ACTIVE', now(), now())
		 ON CONFLICT ("workspace_id", "user_id") DO UPDATE
		   SET role = 'OWNER', "role_id" = EXCLUDED."role_id", status = 'ACTIVE', "updated_at" = now()`,
		uuid.NewString(), wsID, u.ID, ownerRole); err != nil {
		return "", "", err
	}
	if err := logRoleEvent(ctx, tx, wsID, "", "member.recovery", "", nil, map[string]any{"userId": u.ID, "roleId": ownerRole}); err != nil {
		return "", "", err
	}
	return wsID, wsName, tx.Commit(ctx)
}
