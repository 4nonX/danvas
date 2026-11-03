package accounts

import (
	"testing"

	"github.com/google/uuid"

	"hycanvas/backend/internal/migrations"
)

// design.emptyTrash: a workspace seeded before it gains "empty-trash" on the
// roles that may manage roles, not on members or viewers, and running the
// migration again changes nothing.
func TestRoles_EmptyTrashMigration(t *testing.T) {
	ctx, tx := rolesTestTx(t)
	svc := NewService(tx, "test-jwt-secret")
	_, ws, _, err := svc.Signup(ctx, "roles-et+"+uuid.NewString()+"@example.com", "a-strong-password", "Owner")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	// As seeded before the action existed.
	if _, err := tx.Exec(ctx, `DELETE FROM "workspace_permissions" WHERE "workspace_id"=$1 AND "seed_key"='empty-trash'`, ws.ID); err != nil {
		t.Fatalf("strip: %v", err)
	}
	sql, err := migrations.FS.ReadFile("sql/20261104000000_empty_trash_action/migration.sql")
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	for i := 0; i < 2; i++ {
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("migrate (run %d): %v", i+1, err)
		}
	}
	var perms int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM "workspace_permissions" WHERE "workspace_id"=$1 AND "seed_key"='empty-trash'`, ws.ID).Scan(&perms)
	if perms != 1 {
		t.Fatalf("want one permission, got %d", perms)
	}
	rows, err := tx.Query(ctx, `
		SELECT r."seed_key", COALESCE(bool_or(p."seed_key" = 'empty-trash'), false)
		FROM "workspace_roles" r
		LEFT JOIN "workspace_role_permissions" rp ON rp."role_id" = r.id
		LEFT JOIN "workspace_permissions" p ON p.id = rp."permission_id"
		WHERE r."workspace_id" = $1
		GROUP BY r."seed_key"`, ws.ID)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer rows.Close()
	want := map[string]bool{"owner": true, "admin": true, "member": false, "viewer": false}
	seen := 0
	for rows.Next() {
		var role string
		var has bool
		if err := rows.Scan(&role, &has); err != nil {
			t.Fatalf("scan: %v", err)
		}
		if has != want[role] {
			t.Fatalf("role %s: empty-trash = %v, want %v", role, has, want[role])
		}
		seen++
	}
	if seen != len(want) {
		t.Fatalf("want %d roles, got %d", len(want), seen)
	}
}
