package accounts

// Managing permissions and roles (F42 FR-7, FR-8, FR-10): the page "Roles and
// permissions". Every member may read it; changing it needs roles.manage, and
// every change passes the guard rails: a caller only puts actions they hold
// into a permission, only gives a role what they hold, never edits their own
// role, and never touches the protected owner role beyond renaming it (owners
// only). After each change the legacy enum of every affected membership is
// brought in line with its role's derived base role (FR-4).

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"hycanvas/backend/internal/authz"
)

var (
	// ErrNameTaken: another permission or role of the workspace has this name.
	ErrNameTaken = errors.New("name already in use")
	// ErrRoleInUse: the role still has members; name a role to move them to.
	ErrRoleInUse = errors.New("role still has members")
	// ErrOwnRole: nobody edits or deletes the role they hold.
	ErrOwnRole = errors.New("cannot change your own role")
	// ErrProtectedRole: the owner role can only be renamed.
	ErrProtectedRole = errors.New("the owner role cannot be changed")
)

const maxRoleName = 80

// PermissionView is a permission as the page shows it. Name is empty for a
// seeded permission that keeps its seeded name (the UI shows it translated).
type PermissionView struct {
	ID          string          `json:"id"`
	SeedKey     string          `json:"seedKey,omitempty"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Actions     authz.ActionSet `json:"actions"`
	RoleIDs     []string        `json:"roleIds"`
	UpdatedAt   string          `json:"updatedAt"`
}

// RoleView is a role as the page shows it.
type RoleView struct {
	ID            string          `json:"id"`
	SeedKey       string          `json:"seedKey,omitempty"`
	Name          string          `json:"name"`
	Description   string          `json:"description"`
	Protected     bool            `json:"protected"`
	PermissionIDs []string        `json:"permissionIds"`
	Actions       authz.ActionSet `json:"actions"`
	BaseRole      string          `json:"baseRole"`
	MemberCount   int             `json:"memberCount"`
	UpdatedAt     string          `json:"updatedAt"`
}

// RolesView is everything the page needs.
type RolesView struct {
	Actions     []authz.ActionDef `json:"actions"`
	Permissions []PermissionView  `json:"permissions"`
	Roles       []RoleView        `json:"roles"`
	MyRoleID    string            `json:"myRoleId"`
	MyActions   authz.ActionSet   `json:"myActions"`
	CanManage   bool              `json:"canManage"`
}

// PermissionInput creates or (with nil fields left alone) edits a permission.
type PermissionInput struct {
	Name        *string          `json:"name"`
	Description *string          `json:"description"`
	Actions     *authz.ActionSet `json:"actions"`
}

// RoleInput creates or (with nil fields left alone) edits a role.
type RoleInput struct {
	Name          *string   `json:"name"`
	Description   *string   `json:"description"`
	PermissionIDs *[]string `json:"permissionIds"`
}

// RoleEvent is one entry of the change log.
type RoleEvent struct {
	ID        string          `json:"id"`
	Kind      string          `json:"kind"`
	ActorID   string          `json:"actorId,omitempty"`
	ActorName string          `json:"actorName,omitempty"`
	TargetID  string          `json:"targetId,omitempty"`
	Before    json.RawMessage `json:"before,omitempty"`
	After     json.RawMessage `json:"after,omitempty"`
	CreatedAt string          `json:"createdAt"`
}

// MyActions returns the caller's role and actions in a workspace.
func (s *Service) MyActions(ctx context.Context, callerID, workspaceID string) (*MemberRole, error) {
	return s.EffectiveRole(ctx, callerID, workspaceID)
}

// Roles returns the page's data; any member may read it.
func (s *Service) Roles(ctx context.Context, callerID, workspaceID string) (RolesView, error) {
	me, err := s.EffectiveRole(ctx, callerID, workspaceID)
	if err != nil {
		return RolesView{}, err
	}
	if err := s.EnsureRoles(ctx, s.db, workspaceID); err != nil {
		return RolesView{}, err
	}
	v := RolesView{Actions: authz.Actions, MyRoleID: me.RoleID, MyActions: me.Actions, CanManage: me.Actions.Has(authz.RolesManage)}

	links := map[string][]string{} // permission -> roles
	perms := map[string][]string{} // role -> permissions
	rows, err := s.db.Query(ctx, `SELECT rp."role_id"::text, rp."permission_id"::text FROM "workspace_role_permissions" rp
		JOIN "workspace_roles" r ON r.id = rp."role_id" WHERE r."workspace_id" = $1`, workspaceID)
	if err != nil {
		return RolesView{}, err
	}
	for rows.Next() {
		var rid, pid string
		if err := rows.Scan(&rid, &pid); err != nil {
			rows.Close()
			return RolesView{}, err
		}
		links[pid] = append(links[pid], rid)
		perms[rid] = append(perms[rid], pid)
	}
	rows.Close()

	rows, err = s.db.Query(ctx, `SELECT id::text, COALESCE("seed_key", ''), COALESCE(name, ''), description, actions, "updated_at"
		FROM "workspace_permissions" WHERE "workspace_id" = $1 ORDER BY "created_at", id`, workspaceID)
	if err != nil {
		return RolesView{}, err
	}
	for rows.Next() {
		var p PermissionView
		var raw []byte
		var updated time.Time
		if err := rows.Scan(&p.ID, &p.SeedKey, &p.Name, &p.Description, &raw, &updated); err != nil {
			rows.Close()
			return RolesView{}, err
		}
		var set authz.ActionSet
		_ = json.Unmarshal(raw, &set)
		p.Actions = set.Normalized()
		p.RoleIDs = nonNil(links[p.ID])
		p.UpdatedAt = iso(updated)
		v.Permissions = append(v.Permissions, p)
	}
	rows.Close()

	counts := map[string]int{}
	rows, err = s.db.Query(ctx, `SELECT "role_id"::text, count(*) FROM "workspace_members"
		WHERE "workspace_id" = $1 AND status = 'ACTIVE' AND "role_id" IS NOT NULL GROUP BY "role_id"`, workspaceID)
	if err != nil {
		return RolesView{}, err
	}
	for rows.Next() {
		var id string
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			rows.Close()
			return RolesView{}, err
		}
		counts[id] = n
	}
	rows.Close()

	effective, err := workspaceRoles(ctx, s.db, workspaceID)
	if err != nil {
		return RolesView{}, err
	}
	rows, err = s.db.Query(ctx, `SELECT id::text, COALESCE("seed_key", ''), COALESCE(name, ''), description, protected, "updated_at"
		FROM "workspace_roles" WHERE "workspace_id" = $1 ORDER BY protected DESC, "created_at", id`, workspaceID)
	if err != nil {
		return RolesView{}, err
	}
	for rows.Next() {
		var r RoleView
		var updated time.Time
		if err := rows.Scan(&r.ID, &r.SeedKey, &r.Name, &r.Description, &r.Protected, &updated); err != nil {
			rows.Close()
			return RolesView{}, err
		}
		r.PermissionIDs = nonNil(perms[r.ID])
		r.Actions = effective[r.ID].Actions
		r.BaseRole = effective[r.ID].Base()
		r.MemberCount = counts[r.ID]
		r.UpdatedAt = iso(updated)
		v.Roles = append(v.Roles, r)
	}
	rows.Close()
	return v, rows.Err()
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	sort.Strings(s)
	return s
}

// manageTx opens a transaction for a change by the caller, locking the
// workspace's role data and returning the caller's role (read under lock).
func (s *Service) manageTx(ctx context.Context, callerID, workspaceID string) (pgx.Tx, wsRole, error) {
	if err := s.Require(ctx, callerID, workspaceID, authz.RolesManage, ""); err != nil {
		return nil, wsRole{}, err
	}
	if err := s.EnsureRoles(ctx, s.db, workspaceID); err != nil {
		return nil, wsRole{}, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, wsRole{}, err
	}
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('workspace-roles:' || $1))`, workspaceID); err != nil {
		_ = tx.Rollback(ctx)
		return nil, wsRole{}, err
	}
	caller, ok, err := roleOfMember(ctx, tx, callerID, workspaceID, true)
	if err != nil {
		_ = tx.Rollback(ctx)
		return nil, wsRole{}, err
	}
	if !ok || !caller.Actions.Has(authz.RolesManage) {
		_ = tx.Rollback(ctx)
		return nil, wsRole{}, &ActionError{Action: authz.RolesManage}
	}
	return tx, caller, nil
}

func cleanRoleName(name string) (string, error) {
	n := strings.TrimSpace(name)
	if n == "" || len([]rune(n)) > maxRoleName {
		return "", ErrBadRequest
	}
	return n, nil
}

func isUnique(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23505"
}

// syncBaseRoles brings the legacy enum of every membership, pending
// invitation and the SSO setting in line with its role (FR-4).
func syncBaseRoles(ctx context.Context, tx pgx.Tx, workspaceID string) error {
	roles, err := workspaceRoles(ctx, tx, workspaceID)
	if err != nil {
		return err
	}
	for id, r := range roles {
		base := strings.ToUpper(r.Base())
		if _, err := tx.Exec(ctx, `UPDATE "workspace_members" SET role = $1::"Role", "updated_at" = now()
			WHERE "workspace_id" = $2 AND "role_id" = $3 AND role <> $1::"Role"`, base, workspaceID, id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE "invitations" SET role = $1::"Role"
			WHERE "workspace_id" = $2 AND "role_id" = $3 AND "accepted_at" IS NULL AND role <> $1::"Role"`, base, workspaceID, id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE "workspace_sso_join" SET role = $1
			WHERE "workspace_id" = $2 AND "role_id" = $3 AND role <> $1`, base, workspaceID, id); err != nil {
			return err
		}
	}
	return nil
}

// permissionWorkspace returns a permission's workspace.
func (s *Service) permissionWorkspace(ctx context.Context, id string) (string, error) {
	if _, err := uuid.Parse(id); err != nil {
		return "", ErrNotFound
	}
	var ws string
	if err := s.db.QueryRow(ctx, `SELECT "workspace_id"::text FROM "workspace_permissions" WHERE id = $1`, id).Scan(&ws); err != nil {
		return "", ErrNotFound
	}
	return ws, nil
}

// roleWorkspace returns a role's workspace.
func (s *Service) roleWorkspace(ctx context.Context, id string) (string, error) {
	if _, err := uuid.Parse(id); err != nil {
		return "", ErrNotFound
	}
	var ws string
	if err := s.db.QueryRow(ctx, `SELECT "workspace_id"::text FROM "workspace_roles" WHERE id = $1`, id).Scan(&ws); err != nil {
		return "", ErrNotFound
	}
	return ws, nil
}

// CreatePermission adds a permission to the workspace from actions the
// caller holds.
func (s *Service) CreatePermission(ctx context.Context, callerID, workspaceID string, in PermissionInput) (string, error) {
	if in.Name == nil || in.Actions == nil {
		return "", ErrBadRequest
	}
	name, err := cleanRoleName(*in.Name)
	if err != nil {
		return "", err
	}
	actions := in.Actions.Normalized()
	tx, caller, err := s.manageTx(ctx, callerID, workspaceID)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if !caller.Actions.Covers(actions) {
		return "", ErrForbidden
	}
	desc := ""
	if in.Description != nil {
		desc = strings.TrimSpace(*in.Description)
	}
	raw, _ := json.Marshal(actions)
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO "workspace_permissions" ("workspace_id", name, description, actions, "created_by", "updated_by")
		VALUES ($1, $2, $3, $4, $5, $5) RETURNING id::text`, workspaceID, name, desc, raw, callerID).Scan(&id)
	if isUnique(err) {
		return "", ErrNameTaken
	}
	if err != nil {
		return "", err
	}
	if err := logRoleEvent(ctx, tx, workspaceID, callerID, "permission.create", id, nil, map[string]any{"name": name, "actions": actions}); err != nil {
		return "", err
	}
	return id, tx.Commit(ctx)
}

// UpdatePermission edits a permission: a new action list may only hold
// actions the caller has. Roles holding it change with it.
func (s *Service) UpdatePermission(ctx context.Context, callerID, permissionID string, in PermissionInput) error {
	ws, err := s.permissionWorkspace(ctx, permissionID)
	if err != nil {
		return err
	}
	tx, caller, err := s.manageTx(ctx, callerID, ws)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var oldName *string
	var oldRaw []byte
	if err := tx.QueryRow(ctx, `SELECT name, actions FROM "workspace_permissions" WHERE id = $1 FOR UPDATE`, permissionID).Scan(&oldName, &oldRaw); err != nil {
		return ErrNotFound
	}
	var old authz.ActionSet
	_ = json.Unmarshal(oldRaw, &old)
	old = old.Normalized()
	// A permission holding more than the caller has is above them.
	if !caller.Actions.Covers(old) {
		return ErrForbidden
	}
	before := map[string]any{"name": oldName, "actions": old}
	after := map[string]any{}
	if in.Name != nil {
		name, err := cleanRoleName(*in.Name)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE "workspace_permissions" SET name = $2 WHERE id = $1`, permissionID, name); err != nil {
			if isUnique(err) {
				return ErrNameTaken
			}
			return err
		}
		after["name"] = name
	}
	if in.Description != nil {
		if _, err := tx.Exec(ctx, `UPDATE "workspace_permissions" SET description = $2 WHERE id = $1`, permissionID, strings.TrimSpace(*in.Description)); err != nil {
			return err
		}
		after["description"] = strings.TrimSpace(*in.Description)
	}
	if in.Actions != nil {
		next := in.Actions.Normalized()
		if !caller.Actions.Covers(next) {
			return ErrForbidden
		}
		raw, _ := json.Marshal(next)
		if _, err := tx.Exec(ctx, `UPDATE "workspace_permissions" SET actions = $2 WHERE id = $1`, permissionID, raw); err != nil {
			return err
		}
		after["actions"] = next
	}
	if _, err := tx.Exec(ctx, `UPDATE "workspace_permissions" SET "updated_by" = $2, "updated_at" = now() WHERE id = $1`, permissionID, callerID); err != nil {
		return err
	}
	if err := syncBaseRoles(ctx, tx, ws); err != nil {
		return err
	}
	if err := logRoleEvent(ctx, tx, ws, callerID, "permission.update", permissionID, before, after); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// DeletePermission removes a permission; the roles holding it lose it.
func (s *Service) DeletePermission(ctx context.Context, callerID, permissionID string) error {
	ws, err := s.permissionWorkspace(ctx, permissionID)
	if err != nil {
		return err
	}
	tx, caller, err := s.manageTx(ctx, callerID, ws)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var name *string
	var raw []byte
	if err := tx.QueryRow(ctx, `SELECT name, actions FROM "workspace_permissions" WHERE id = $1 FOR UPDATE`, permissionID).Scan(&name, &raw); err != nil {
		return ErrNotFound
	}
	var set authz.ActionSet
	_ = json.Unmarshal(raw, &set)
	if !caller.Actions.Covers(set) {
		return ErrForbidden
	}
	if _, err := tx.Exec(ctx, `DELETE FROM "workspace_permissions" WHERE id = $1`, permissionID); err != nil {
		return err
	}
	if err := syncBaseRoles(ctx, tx, ws); err != nil {
		return err
	}
	if err := logRoleEvent(ctx, tx, ws, callerID, "permission.delete", permissionID, map[string]any{"name": name, "actions": set.Normalized()}, nil); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// roleActionsOf computes a role's actions from permission ids of the workspace.
func roleActionsOf(ctx context.Context, tx pgx.Tx, workspaceID string, permissionIDs []string) (authz.ActionSet, error) {
	if len(permissionIDs) == 0 {
		return authz.ActionSet{}, nil
	}
	for _, id := range permissionIDs {
		if _, err := uuid.Parse(id); err != nil {
			return nil, ErrBadRequest
		}
	}
	rows, err := tx.Query(ctx, `SELECT actions FROM "workspace_permissions" WHERE "workspace_id" = $1 AND id = ANY($2::uuid[])`, workspaceID, permissionIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var sets []authz.ActionSet
	n := 0
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var set authz.ActionSet
		_ = json.Unmarshal(raw, &set)
		sets = append(sets, set)
		n++
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if n != len(dedupe(permissionIDs)) {
		return nil, ErrBadRequest // a permission of another workspace, or none
	}
	return authz.Union(sets...), nil
}

func dedupe(ids []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

func setRolePermissions(ctx context.Context, tx pgx.Tx, roleID string, permissionIDs []string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM "workspace_role_permissions" WHERE "role_id" = $1`, roleID); err != nil {
		return err
	}
	for _, pid := range dedupe(permissionIDs) {
		if _, err := tx.Exec(ctx, `INSERT INTO "workspace_role_permissions" ("role_id", "permission_id") VALUES ($1, $2)`, roleID, pid); err != nil {
			return err
		}
	}
	return nil
}

// CreateRole adds a role from permissions whose actions the caller holds.
func (s *Service) CreateRole(ctx context.Context, callerID, workspaceID string, in RoleInput) (string, error) {
	if in.Name == nil {
		return "", ErrBadRequest
	}
	name, err := cleanRoleName(*in.Name)
	if err != nil {
		return "", err
	}
	tx, caller, err := s.manageTx(ctx, callerID, workspaceID)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var permIDs []string
	if in.PermissionIDs != nil {
		permIDs = *in.PermissionIDs
	}
	actions, err := roleActionsOf(ctx, tx, workspaceID, permIDs)
	if err != nil {
		return "", err
	}
	if !caller.Actions.Covers(actions) {
		return "", ErrForbidden
	}
	desc := ""
	if in.Description != nil {
		desc = strings.TrimSpace(*in.Description)
	}
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO "workspace_roles" ("workspace_id", name, description, "created_by", "updated_by")
		VALUES ($1, $2, $3, $4, $4) RETURNING id::text`, workspaceID, name, desc, callerID).Scan(&id)
	if isUnique(err) {
		return "", ErrNameTaken
	}
	if err != nil {
		return "", err
	}
	if err := setRolePermissions(ctx, tx, id, permIDs); err != nil {
		return "", err
	}
	if err := logRoleEvent(ctx, tx, workspaceID, callerID, "role.create", id, nil, map[string]any{"name": name, "permissionIds": dedupe(permIDs)}); err != nil {
		return "", err
	}
	return id, tx.Commit(ctx)
}

// UpdateRole edits a role. Not the caller's own role; the protected role only
// gets a new name or description (by an owner); the result only holds what
// the caller holds.
func (s *Service) UpdateRole(ctx context.Context, callerID, roleID string, in RoleInput) error {
	ws, err := s.roleWorkspace(ctx, roleID)
	if err != nil {
		return err
	}
	tx, caller, err := s.manageTx(ctx, callerID, ws)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	roles, err := workspaceRoles(ctx, tx, ws)
	if err != nil {
		return err
	}
	target, ok := roles[roleID]
	if !ok {
		return ErrNotFound
	}
	if target.Protected {
		if !caller.Protected {
			return ErrForbidden
		}
		if in.PermissionIDs != nil {
			return ErrProtectedRole // always every action
		}
	} else if caller.ID == roleID {
		return ErrOwnRole
	}
	if !mayHandOut(caller, target) {
		return ErrForbidden // a role above the caller
	}
	before := map[string]any{"actions": target.Actions}
	after := map[string]any{}
	if in.Name != nil {
		name, err := cleanRoleName(*in.Name)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE "workspace_roles" SET name = $2 WHERE id = $1`, roleID, name); err != nil {
			if isUnique(err) {
				return ErrNameTaken
			}
			return err
		}
		after["name"] = name
	}
	if in.Description != nil {
		if _, err := tx.Exec(ctx, `UPDATE "workspace_roles" SET description = $2 WHERE id = $1`, roleID, strings.TrimSpace(*in.Description)); err != nil {
			return err
		}
		after["description"] = strings.TrimSpace(*in.Description)
	}
	if in.PermissionIDs != nil {
		actions, err := roleActionsOf(ctx, tx, ws, *in.PermissionIDs)
		if err != nil {
			return err
		}
		if !caller.Actions.Covers(actions) {
			return ErrForbidden
		}
		if err := setRolePermissions(ctx, tx, roleID, *in.PermissionIDs); err != nil {
			return err
		}
		after["permissionIds"] = dedupe(*in.PermissionIDs)
	}
	if _, err := tx.Exec(ctx, `UPDATE "workspace_roles" SET "updated_by" = $2, "updated_at" = now() WHERE id = $1`, roleID, callerID); err != nil {
		return err
	}
	if err := syncBaseRoles(ctx, tx, ws); err != nil {
		return err
	}
	if err := logRoleEvent(ctx, tx, ws, callerID, "role.update", roleID, before, after); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// DeleteRole removes a role. Its members, pending invitations and the SSO
// setting move to reassignTo (required when the role is in use), which the
// caller must be able to hand out. Never the protected or the caller's role.
func (s *Service) DeleteRole(ctx context.Context, callerID, roleID, reassignTo string) error {
	ws, err := s.roleWorkspace(ctx, roleID)
	if err != nil {
		return err
	}
	tx, caller, err := s.manageTx(ctx, callerID, ws)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	roles, err := workspaceRoles(ctx, tx, ws)
	if err != nil {
		return err
	}
	target, ok := roles[roleID]
	if !ok {
		return ErrNotFound
	}
	if target.Protected {
		return ErrProtectedRole
	}
	if caller.ID == roleID {
		return ErrOwnRole
	}
	if !mayHandOut(caller, target) {
		return ErrForbidden
	}
	var inUse int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM "workspace_members" WHERE "role_id" = $1`, roleID).Scan(&inUse); err != nil {
		return err
	}
	var pending int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM "invitations" WHERE "role_id" = $1 AND "accepted_at" IS NULL`, roleID).Scan(&pending)
	var sso int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM "workspace_sso_join" WHERE "role_id" = $1`, roleID).Scan(&sso)
	if inUse+pending+sso > 0 {
		next, ok := roles[strings.TrimSpace(reassignTo)]
		if !ok || next.ID == roleID {
			return ErrRoleInUse
		}
		if !mayHandOut(caller, next) || (sso > 0 && next.Protected) {
			return ErrForbidden
		}
		base := strings.ToUpper(next.Base())
		if _, err := tx.Exec(ctx, `UPDATE "workspace_members" SET "role_id" = $1, role = $2::"Role", "updated_at" = now() WHERE "role_id" = $3`, next.ID, base, roleID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE "invitations" SET "role_id" = $1, role = $2::"Role" WHERE "role_id" = $3 AND "accepted_at" IS NULL`, next.ID, base, roleID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE "workspace_sso_join" SET "role_id" = $1, role = $2 WHERE "role_id" = $3`, next.ID, base, roleID); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM "workspace_roles" WHERE id = $1`, roleID); err != nil {
		return err
	}
	if err := logRoleEvent(ctx, tx, ws, callerID, "role.delete", roleID, map[string]any{"actions": target.Actions, "members": inUse}, map[string]any{"reassignedTo": reassignTo}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// RoleEvents returns the change log, newest first (activity.view).
func (s *Service) RoleEvents(ctx context.Context, callerID, workspaceID string, limit int) ([]RoleEvent, error) {
	if err := s.Require(ctx, callerID, workspaceID, authz.ActivityView, ""); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := s.db.Query(ctx, `SELECT e.id::text, e.kind, COALESCE(e."actor_id"::text, ''), COALESCE(u.name, u.email, ''),
		COALESCE(e."target_id"::text, ''), e.before, e.after, e."created_at"
		FROM "workspace_role_events" e LEFT JOIN "users" u ON u.id = e."actor_id"
		WHERE e."workspace_id" = $1 ORDER BY e."created_at" DESC LIMIT $2`, workspaceID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RoleEvent{}
	for rows.Next() {
		var e RoleEvent
		var before, after []byte
		var created time.Time
		if err := rows.Scan(&e.ID, &e.Kind, &e.ActorID, &e.ActorName, &e.TargetID, &before, &after, &created); err != nil {
			return nil, err
		}
		e.Before, e.After = before, after
		e.CreatedAt = iso(created)
		out = append(out, e)
	}
	return out, rows.Err()
}
