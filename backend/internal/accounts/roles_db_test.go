package accounts

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"hycanvas/backend/internal/authz"
)

func rolesTestTx(t *testing.T) (context.Context, pgx.Tx) {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set; skipping DB integration test")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, wsStripSchema(dsn))
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { conn.Close(ctx) })
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	t.Cleanup(func() { _ = tx.Rollback(ctx) })
	return ctx, tx
}

// A new workspace has the seeded roles and its creator holds the owner role
// (F42 AC-5), on a fresh instance's first sign-up too.
func TestRoles_NewWorkspacesAreSeeded(t *testing.T) {
	ctx, tx := rolesTestTx(t)
	svc := NewService(tx, "test-jwt-secret")
	user, personal, _, err := svc.Signup(ctx, "roles+"+uuid.NewString()+"@example.com", "a-strong-password", "Owner")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	team, err := svc.CreateWorkspace(ctx, user.ID, "Team", "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	for _, ws := range []string{personal.ID, team.ID} {
		var roles, perms int
		_ = tx.QueryRow(ctx, `SELECT count(*) FROM "workspace_roles" WHERE "workspace_id"=$1`, ws).Scan(&roles)
		_ = tx.QueryRow(ctx, `SELECT count(*) FROM "workspace_permissions" WHERE "workspace_id"=$1`, ws).Scan(&perms)
		if roles != len(authz.SeedRoles) || perms != len(authz.SeedPermissions) {
			t.Fatalf("workspace %s: %d roles, %d permissions", ws, roles, perms)
		}
		mr, err := svc.EffectiveRole(ctx, user.ID, ws)
		if err != nil {
			t.Fatalf("effective role: %v", err)
		}
		if mr.RoleID == "" || !mr.Protected || mr.SeedKey != "owner" {
			t.Fatalf("creator should hold the reconciled owner role, got %+v", mr)
		}
		if err := svc.Require(ctx, user.ID, ws, authz.RolesManage, ""); err != nil {
			t.Fatalf("owner lacks roles.manage: %v", err)
		}
	}
}

// Members written before F42 (no role_id) get the role of their legacy value,
// both before and after the backfill; the rights equal the legacy rank.
func TestRoles_LegacyMembersAreReconciled(t *testing.T) {
	ctx, tx := rolesTestTx(t)
	svc := NewService(tx, "test-jwt-secret")
	owner, _, _, err := svc.Signup(ctx, "o+"+uuid.NewString()+"@example.com", "a-strong-password", "O")
	if err != nil {
		t.Fatal(err)
	}
	other, _, _, err := svc.Signup(ctx, "m+"+uuid.NewString()+"@example.com", "a-strong-password", "M")
	if err != nil {
		t.Fatal(err)
	}
	team, err := svc.CreateWorkspace(ctx, owner.ID, "Team", "")
	if err != nil {
		t.Fatal(err)
	}
	// As a release from before F42 would write it.
	if _, err := tx.Exec(ctx, `INSERT INTO "workspace_members" (id,"workspace_id","user_id",role,status,"joined_at","updated_at")
		VALUES ($1,$2,$3,'VIEWER','ACTIVE',now(),now())`, uuid.NewString(), team.ID, other.ID); err != nil {
		t.Fatal(err)
	}
	check := func(stage string) {
		if svc.Can(ctx, other.ID, team.ID, authz.DesignEdit, "") {
			t.Errorf("%s: a viewer must not edit", stage)
		}
		if !svc.Can(ctx, other.ID, team.ID, authz.DesignComment, "") {
			t.Errorf("%s: a viewer comments", stage)
		}
	}
	check("before backfill")
	if err := svc.EnsureRoles(ctx, tx, team.ID); err != nil {
		t.Fatal(err)
	}
	mr, _ := svc.EffectiveRole(ctx, other.ID, team.ID)
	if mr.SeedKey != "viewer" || mr.RoleID == "" {
		t.Fatalf("expected the viewer role, got %+v", mr)
	}
	check("after backfill")

	// A rollback demotes to VIEWER by enum while the role says member: the
	// enum (the newer change) wins on the next reconcile.
	if _, err := tx.Exec(ctx, `UPDATE "workspace_members" SET role='MEMBER' WHERE "workspace_id"=$1 AND "user_id"=$2`, team.ID, other.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.EnsureRoles(ctx, tx, team.ID); err != nil {
		t.Fatal(err)
	}
	if mr, _ := svc.EffectiveRole(ctx, other.ID, team.ID); mr.SeedKey != "member" {
		t.Fatalf("enum change should win, got %+v", mr)
	}
	// Idempotent: a second run changes nothing.
	if err := svc.EnsureRoles(ctx, tx, team.ID); err != nil {
		t.Fatal(err)
	}
	var roles int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM "workspace_roles" WHERE "workspace_id"=$1`, team.ID).Scan(&roles)
	if roles != len(authz.SeedRoles) {
		t.Fatalf("seeded twice: %d roles", roles)
	}
}

func TestRoles_RequireNamesTheAction(t *testing.T) {
	ctx, tx := rolesTestTx(t)
	svc := NewService(tx, "test-jwt-secret")
	owner, _, _, _ := svc.Signup(ctx, "o+"+uuid.NewString()+"@example.com", "a-strong-password", "O")
	other, _, _, _ := svc.Signup(ctx, "v+"+uuid.NewString()+"@example.com", "a-strong-password", "V")
	team, _ := svc.CreateWorkspace(ctx, owner.ID, "Team", "")
	_, _ = tx.Exec(ctx, `INSERT INTO "workspace_members" (id,"workspace_id","user_id",role,status,"joined_at","updated_at")
		VALUES ($1,$2,$3,'MEMBER','ACTIVE',now(),now())`, uuid.NewString(), team.ID, other.ID)
	err := svc.Require(ctx, other.ID, team.ID, authz.FontsManage, "")
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("want forbidden, got %v", err)
	}
	if a, ok := IsActionError(err); !ok || a != authz.FontsManage {
		t.Fatalf("error should name fonts.manage, got %v", err)
	}
	if err := svc.Require(ctx, uuid.NewString(), team.ID, authz.DesignComment, ""); !errors.Is(err, ErrForbidden) {
		t.Fatalf("a non-member is forbidden, got %v", err)
	}
}
