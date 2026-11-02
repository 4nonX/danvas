package accounts

import (
	"testing"

	"github.com/google/uuid"

	"hycanvas/backend/internal/authz"
	"hycanvas/backend/internal/migrations"
)

// template.rename split out as its own action: a workspace seeded before it
// gains the "rename-templates" permission on every role that may delete other
// people's templates, and only there. Running the migration again changes
// nothing.
func TestRoles_TemplateRenameMigration(t *testing.T) {
	ctx, tx := rolesTestTx(t)
	svc := NewService(tx, "test-jwt-secret")
	_, ws, _, err := svc.Signup(ctx, "roles-tr+"+uuid.NewString()+"@example.com", "a-strong-password", "Owner")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	// As seeded before the action existed.
	if _, err := tx.Exec(ctx, `DELETE FROM "workspace_permissions" WHERE "workspace_id"=$1 AND "seed_key"='rename-templates'`, ws.ID); err != nil {
		t.Fatalf("strip: %v", err)
	}
	sql, err := migrations.FS.ReadFile("sql/20261101000000_template_rename_action/migration.sql")
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	for i := 0; i < 2; i++ {
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("migrate (run %d): %v", i+1, err)
		}
	}
	var perms int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM "workspace_permissions" WHERE "workspace_id"=$1 AND "seed_key"='rename-templates'`, ws.ID).Scan(&perms)
	if perms != 1 {
		t.Fatalf("want one rename-templates permission, got %d", perms)
	}
	rows, err := tx.Query(ctx, `
		SELECT r."seed_key",
		       bool_or(p."actions" ? 'template.delete'),
		       bool_or(p."actions" ? 'template.rename')
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
		var del, ren *bool
		if err := rows.Scan(&key, &del, &ren); err != nil {
			t.Fatalf("scan: %v", err)
		}
		seen++
		if (del != nil && *del) != (ren != nil && *ren) {
			t.Errorf("role %s: template.delete=%v but template.rename=%v", key, del != nil && *del, ren != nil && *ren)
		}
	}
	if seen != len(authz.SeedRoles) {
		t.Fatalf("saw %d roles", seen)
	}
}
