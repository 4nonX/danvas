package sharing

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"hycanvas/backend/internal/authz"
	"hycanvas/backend/internal/templatelock"
)

// ErrTemplateLocked is returned when a save changes objects a template lock
// protects and the saver may not lift that lock.
var ErrTemplateLocked = errors.New("template locked")

// CanLiftTemplateLocks reports whether a user may set, change or lift template
// locks that belong to a workspace, in the given design. On a design of that
// workspace the design's own resolved access decides (workspace role, grants,
// custom roles). Anywhere else, a copy in a personal or another team
// workspace, only the user's role in the lock's workspace counts: owning the
// copy never lifts a lock its origin workspace set. A lock without a workspace
// belongs to the design's own.
func (s *Service) CanLiftTemplateLocks(ctx context.Context, designID, userID, workspaceID string) bool {
	designWS, err := s.workspaceOf(ctx, designID)
	if err != nil {
		return false
	}
	if workspaceID == "" || workspaceID == designWS {
		access, err := s.resolveForUser(ctx, designID, userID, "", nil)
		return err == nil && has(access, authz.CapManageLocks)
	}
	role := s.membershipRole(ctx, userID, workspaceID)
	return role != "" && authz.Resolve(authz.ResolveInput{WorkspaceRole: role}).Has(authz.CapManageLocks)
}

// ValidateTemplateLocks refuses a save that changes protected objects relative
// to the design's previous file (see package templatelock for the rule).
// Returns ErrTemplateLocked with a short summary on a violation.
func (s *Service) ValidateTemplateLocks(ctx context.Context, designID, userID string, prev, next map[string]any) error {
	v := templatelock.Check(prev, next, func(ws string) bool { return s.CanLiftTemplateLocks(ctx, designID, userID, ws) })
	if len(v) == 0 {
		return nil
	}
	ids := make([]string, 0, 5)
	for i, x := range v {
		if i >= 5 {
			break
		}
		ids = append(ids, x.NodeID+" ("+x.Reason+")")
	}
	summary := strings.Join(ids, ", ")
	if len(v) > 5 {
		summary += fmt.Sprintf(" (+%d more)", len(v)-5)
	}
	return fmt.Errorf("%w: protected template objects changed: %s", ErrTemplateLocked, summary)
}

// IsActiveMember reports whether a user is an active member of a workspace.
func (s *Service) IsActiveMember(ctx context.Context, userID, workspaceID string) bool {
	return s.membershipRole(ctx, userID, workspaceID) != ""
}

// WorkspaceName returns a workspace's name, or "" when it does not exist.
func (s *Service) WorkspaceName(ctx context.Context, workspaceID string) string {
	var name string
	_ = s.db.QueryRow(ctx, `SELECT name FROM "workspaces" WHERE id = $1`, workspaceID).Scan(&name)
	return name
}

// LockContact is someone who may lift a workspace's template locks.
type LockContact struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

// TemplateLockWorkspace describes the workspace behind a template lock, for
// the message a blocked user sees: whose template it is and whom to ask.
type TemplateLockWorkspace struct {
	WorkspaceID string        `json:"workspaceId"`
	Name        string        `json:"name"`
	Contacts    []LockContact `json:"contacts"`
	CanManage   bool          `json:"canManage"`
}

// maxLockContacts bounds the contact list a message shows.
const maxLockContacts = 5

// TemplateLockInfo describes each workspace the given locks name. A workspace
// that no longer exists comes back with an empty name and no contacts.
func (s *Service) TemplateLockInfo(ctx context.Context, designID, userID string, workspaceIDs []string) []TemplateLockWorkspace {
	out := make([]TemplateLockWorkspace, 0, len(workspaceIDs))
	designWS, _ := s.workspaceOf(ctx, designID)
	for _, ws := range workspaceIDs {
		id := ws
		if id == "" {
			id = designWS
		}
		info := TemplateLockWorkspace{WorkspaceID: ws, Contacts: []LockContact{}, CanManage: s.CanLiftTemplateLocks(ctx, designID, userID, ws)}
		info.Name = s.WorkspaceName(ctx, id)
		rows, err := s.db.Query(ctx, `SELECT COALESCE(u.name, ''), u.email FROM "workspace_members" m
			JOIN "users" u ON u.id = m."user_id"
			WHERE m."workspace_id" = $1 AND m.status = 'ACTIVE' AND m.role IN ('OWNER', 'ADMIN')
			ORDER BY (m.role = 'OWNER') DESC, u.name LIMIT $2`, id, maxLockContacts)
		if err == nil {
			for rows.Next() {
				var c LockContact
				if rows.Scan(&c.Name, &c.Email) == nil {
					info.Contacts = append(info.Contacts, c)
				}
			}
			rows.Close()
		}
		out = append(out, info)
	}
	return out
}
