package accounts

import (
	"testing"

	"github.com/google/uuid"

	"hycanvas/backend/internal/authz"
	"hycanvas/backend/internal/migrations"
)

// template.edit and the scoped template.rename and template.delete: a workspace
// seeded before them gains "edit-templates" where all templates may be deleted,
// and "edit-own-templates" and "delete-own-templates" where templates may be
// created. Running the migration again changes nothing, and delete on own does
// not turn into editing everything.
func TestRoles_TemplateEditMigration(t *testing.T) {
	ctx, tx := rolesTestTx(t)
	svc := NewService(tx, "test-jwt-secret")
	_, ws, _, err := svc.Signup(ctx, "roles-te+"+uuid.NewString()+"@example.com", "a-strong-password", "Owner")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	// As seeded before the actions existed.
	if _, err := tx.Exec(ctx, `DELETE FROM "workspace_permissions" WHERE "workspace_id"=$1 AND "seed_key" IN ('edit-templates','edit-own-templates','delete-own-templates')`, ws.ID); err != nil {
		t.Fatalf("strip: %v", err)
	}
	sql, err := migrations.FS.ReadFile("sql/20261102000000_template_edit_action/migration.sql")
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	for i := 0; i < 2; i++ {
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("migrate (run %d): %v", i+1, err)
		}
	}
	var perms int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM "workspace_permissions" WHERE "workspace_id"=$1 AND "seed_key" IN ('edit-templates','edit-own-templates','delete-own-templates')`, ws.ID).Scan(&perms)
	if perms != 3 {
		t.Fatalf("want three permissions, got %d", perms)
	}
	rows, err := tx.Query(ctx, `
		SELECT r."seed_key",
		       COALESCE(bool_or(p."actions"->>'template.delete' = 'all'), false),
		       COALESCE(bool_or(p."actions" ? 'template.publish'), false),
		       COALESCE(bool_or(p."seed_key" = 'edit-templates'), false),
		       COALESCE(bool_or(p."seed_key" = 'edit-own-templates'), false),
		       COALESCE(bool_or(p."seed_key" = 'delete-own-templates'), false)
		FROM "workspace_roles" r
		LEFT JOIN "workspace_role_permissions" rp ON rp."role_id" = r.id
		LEFT JOIN "workspace_permissions" p ON p.id = rp."permission_id"
		WHERE r."workspace_id" = $1 GROUP BY r."seed_key"`, ws.ID)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer rows.Close()
	seen := 0
	for rows.Next() {
		var key string
		var del, pub, all, own, delOwn bool
		if err := rows.Scan(&key, &del, &pub, &all, &own, &delOwn); err != nil {
			t.Fatalf("scan: %v", err)
		}
		seen++
		if del != all || pub != own || pub != delOwn {
			t.Errorf("role %s: delete all=%v edit-templates=%v publish=%v edit-own-templates=%v delete-own-templates=%v", key, del, all, pub, own, delOwn)
		}
		if key == "member" && all {
			t.Errorf("a member must not gain editing everything")
		}
	}
	if seen != len(authz.SeedRoles) {
		t.Fatalf("saw %d roles", seen)
	}
}
