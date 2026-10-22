package accounts

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"hycanvas/backend/internal/authz"
)

type rolesFixture struct {
	ctx                      context.Context
	tx                       pgx.Tx
	svc                      *Service
	ws                       string
	owner, organizer, member string
	view                     RolesView
}

func ptrS(s string) *string { return &s }

func (f *rolesFixture) roleBySeed(t *testing.T, key string) RoleView {
	t.Helper()
	v, err := f.svc.Roles(f.ctx, f.owner, f.ws)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range v.Roles {
		if r.SeedKey == key {
			return r
		}
	}
	t.Fatalf("no role %s", key)
	return RoleView{}
}

func (f *rolesFixture) permBySeed(t *testing.T, key string) string {
	t.Helper()
	v, _ := f.svc.Roles(f.ctx, f.owner, f.ws)
	for _, p := range v.Permissions {
		if p.SeedKey == key {
			return p.ID
		}
	}
	t.Fatalf("no permission %s", key)
	return ""
}

func (f *rolesFixture) legacy(t *testing.T, userID string) string {
	t.Helper()
	var role string
	if err := f.tx.QueryRow(f.ctx, `SELECT role::text FROM "workspace_members" WHERE "workspace_id"=$1 AND "user_id"=$2`, f.ws, userID).Scan(&role); err != nil {
		t.Fatal(err)
	}
	return role
}

// A workspace with an owner, an "organizer" (a custom role that may manage
// roles and assign them, but holds nothing else) and a member.
func setupRoles(t *testing.T) *rolesFixture {
	t.Helper()
	ctx, tx := rolesTestTx(t)
	svc := NewService(tx, "test-jwt-secret")
	f := &rolesFixture{ctx: ctx, tx: tx, svc: svc}
	signup := func(n string) string {
		u, _, _, err := svc.Signup(ctx, n+"+"+uuid.NewString()+"@example.com", "a-strong-password", n)
		if err != nil {
			t.Fatal(err)
		}
		return u.ID
	}
	f.owner, f.organizer, f.member = signup("owner"), signup("organizer"), signup("member")
	team, err := svc.CreateWorkspace(ctx, f.owner, "Team", "")
	if err != nil {
		t.Fatal(err)
	}
	f.ws = team.ID
	for _, u := range []string{f.organizer, f.member} {
		if _, err := tx.Exec(ctx, `INSERT INTO "workspace_members" (id,"workspace_id","user_id",role,status,"joined_at","updated_at")
			VALUES ($1,$2,$3,'MEMBER','ACTIVE',now(),now())`, uuid.NewString(), f.ws, u); err != nil {
			t.Fatal(err)
		}
	}
	if err := svc.EnsureRoles(ctx, tx, f.ws); err != nil {
		t.Fatal(err)
	}
	permID, err := svc.CreatePermission(ctx, f.owner, f.ws, PermissionInput{Name: ptrS("Organize team"),
		Actions: &authz.ActionSet{authz.RolesManage: authz.ScopeAll, authz.MembersAssign: authz.ScopeAll, authz.DesignComment: authz.ScopeAll}})
	if err != nil {
		t.Fatalf("create permission: %v", err)
	}
	roleID, err := svc.CreateRole(ctx, f.owner, f.ws, RoleInput{Name: ptrS("Organizer"), PermissionIDs: &[]string{permID}})
	if err != nil {
		t.Fatalf("create role: %v", err)
	}
	if err := svc.ChangeMemberRole(ctx, f.owner, f.ws, f.organizer, roleID); err != nil {
		t.Fatalf("assign organizer: %v", err)
	}
	return f
}

// AC-3: a member's actions are exactly the union of their role's permissions,
// and the legacy enum follows the derived base role.
func TestRolesAdmin_EffectiveActionsAreTheUnion(t *testing.T) {
	f := setupRoles(t)
	mr, err := f.svc.EffectiveRole(f.ctx, f.organizer, f.ws)
	if err != nil {
		t.Fatal(err)
	}
	want := []authz.Action{authz.DesignComment, authz.MembersAssign, authz.RolesManage}
	if got := mr.Actions.Keys(); len(got) != len(want) {
		t.Fatalf("organizer actions %v, want %v", got, want)
	}
	if f.legacy(t, f.organizer) != "ADMIN" {
		t.Fatalf("roles.manage means base admin, got %s", f.legacy(t, f.organizer))
	}
	if f.svc.Can(f.ctx, f.organizer, f.ws, authz.DesignEdit, "") {
		t.Fatal("organizer must not edit designs")
	}
}

// AC-4: nobody hands out more than they hold, nobody edits their own role,
// the owner role stays whole.
func TestRolesAdmin_GuardRails(t *testing.T) {
	f := setupRoles(t)
	admin := f.roleBySeed(t, "admin")
	owner := f.roleBySeed(t, "owner")
	member := f.roleBySeed(t, "member")

	// Escalation: a permission or role with actions the organizer lacks.
	if _, err := f.svc.CreatePermission(f.ctx, f.organizer, f.ws, PermissionInput{Name: ptrS("Fonts"), Actions: &authz.ActionSet{authz.FontsManage: authz.ScopeAll}}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("organizer created a permission beyond their role: %v", err)
	}
	if err := f.svc.ChangeMemberRole(f.ctx, f.organizer, f.ws, f.member, admin.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("organizer made someone admin: %v", err)
	}
	if err := f.svc.UpdateRole(f.ctx, f.organizer, member.ID, RoleInput{Name: ptrS("Staff")}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("organizer edited a role above them: %v", err)
	}
	// Own role.
	me, _ := f.svc.EffectiveRole(f.ctx, f.organizer, f.ws)
	if err := f.svc.UpdateRole(f.ctx, f.organizer, me.RoleID, RoleInput{Name: ptrS("Boss")}); !errors.Is(err, ErrOwnRole) {
		t.Fatalf("organizer edited their own role: %v", err)
	}
	// The owner role: never edited or deleted, renamed only by owners.
	if err := f.svc.UpdateRole(f.ctx, f.owner, owner.ID, RoleInput{PermissionIDs: &[]string{}}); !errors.Is(err, ErrProtectedRole) {
		t.Fatalf("owner role permissions changed: %v", err)
	}
	if err := f.svc.DeleteRole(f.ctx, f.owner, owner.ID, ""); !errors.Is(err, ErrProtectedRole) {
		t.Fatalf("owner role deleted: %v", err)
	}
	if err := f.svc.UpdateRole(f.ctx, f.organizer, owner.ID, RoleInput{Name: ptrS("Boss")}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-owner renamed the owner role: %v", err)
	}
	if err := f.svc.UpdateRole(f.ctx, f.owner, owner.ID, RoleInput{Name: ptrS("Inhaber")}); err != nil {
		t.Fatalf("owner could not rename the owner role: %v", err)
	}
	// The last owner cannot step down.
	if err := f.svc.ChangeMemberRole(f.ctx, f.owner, f.ws, f.owner, admin.ID); !errors.Is(err, ErrLastOwner) {
		t.Fatalf("last owner stepped down: %v", err)
	}
	// Members without roles.manage cannot change anything.
	if _, err := f.svc.CreateRole(f.ctx, f.member, f.ws, RoleInput{Name: ptrS("X")}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member created a role: %v", err)
	}
}

func TestRolesAdmin_DeleteMovesMembersAndBaseRolesFollow(t *testing.T) {
	f := setupRoles(t)
	member := f.roleBySeed(t, "member")
	viewer := f.roleBySeed(t, "viewer")
	// In use: refused without a role to move its members to.
	if err := f.svc.DeleteRole(f.ctx, f.owner, member.ID, ""); !errors.Is(err, ErrRoleInUse) {
		t.Fatalf("deleted a role in use: %v", err)
	}
	if err := f.svc.DeleteRole(f.ctx, f.owner, member.ID, viewer.ID); err != nil {
		t.Fatalf("delete with reassignment: %v", err)
	}
	if mr, _ := f.svc.EffectiveRole(f.ctx, f.member, f.ws); mr.RoleID != viewer.ID {
		t.Fatalf("member not moved to viewer: %+v", mr)
	}
	if f.legacy(t, f.member) != "VIEWER" {
		t.Fatalf("legacy enum not following: %s", f.legacy(t, f.member))
	}
	// Taking edit away from a role lowers its members' legacy rank too.
	admin := f.roleBySeed(t, "admin")
	if err := f.svc.UpdateRole(f.ctx, f.owner, admin.ID, RoleInput{PermissionIDs: &[]string{f.permBySeed(t, "download-comment")}}); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.ChangeMemberRole(f.ctx, f.owner, f.ws, f.member, admin.ID); err != nil {
		t.Fatal(err)
	}
	if f.legacy(t, f.member) != "VIEWER" {
		t.Fatalf("a role without edit or roles.manage is base viewer, got %s", f.legacy(t, f.member))
	}
	// Every change is logged.
	events, err := f.svc.RoleEvents(f.ctx, f.owner, f.ws, 50)
	if err != nil || len(events) < 4 {
		t.Fatalf("change log: %d events, %v", len(events), err)
	}
}

func TestRolesAdmin_InviteWithACustomRole(t *testing.T) {
	f := setupRoles(t)
	me, _ := f.svc.EffectiveRole(f.ctx, f.organizer, f.ws)
	inv, _, err := f.svc.Invite(f.ctx, f.owner, f.ws, "new+"+uuid.NewString()+"@example.com", me.RoleID)
	if err != nil {
		t.Fatalf("invite with a custom role: %v", err)
	}
	if inv.RoleID != me.RoleID || inv.Role != "admin" {
		t.Fatalf("invitation %+v", inv)
	}
	// The organizer may not invite at all (no members.invite).
	if _, _, err := f.svc.Invite(f.ctx, f.organizer, f.ws, "x+"+uuid.NewString()+"@example.com", "viewer"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("organizer invited: %v", err)
	}
}
