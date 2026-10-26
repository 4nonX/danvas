package accounts

import (
	"testing"

	"github.com/google/uuid"

	"hycanvas/backend/internal/authz"
	"hycanvas/backend/internal/migrations"
)

// brand.copy split from brand.kits: a workspace seeded before it gains the
// "brand-copy" permission on every role that may manage brand kits, and only
// there, so nobody gains a right. Running the migration again changes
// nothing.
func TestRoles_BrandCopyMigrationKeepsEveryRight(t *testing.T) {
	ctx, tx := rolesTestTx(t)
	svc := NewService(tx, "test-jwt-secret")
	_, ws, _, err := svc.Signup(ctx, "roles-bc+"+uuid.NewString()+"@example.com", "a-strong-password", "Owner")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	// As seeded before the action existed.
	if _, err := tx.Exec(ctx, `DELETE FROM "workspace_permissions" WHERE "workspace_id"=$1 AND "seed_key"='brand-copy'`, ws.ID); err != nil {
		t.Fatalf("strip: %v", err)
	}
	sql, err := migrations.FS.ReadFile("sql/20261031000000_brand_copy_action/migration.sql")
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	for i := 0; i < 2; i++ {
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("migrate (run %d): %v", i+1, err)
		}
	}
	var perms int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM "workspace_permissions" WHERE "workspace_id"=$1 AND "seed_key"='brand-copy'`, ws.ID).Scan(&perms)
	if perms != 1 {
		t.Fatalf("want one brand-copy permission, got %d", perms)
	}
	rows, err := tx.Query(ctx, `
		SELECT r."seed_key",
		       bool_or(p."actions" ? 'brand.kits'),
		       bool_or(p."actions" ? 'brand.copy')
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
		var kits, lib *bool
		if err := rows.Scan(&key, &kits, &lib); err != nil {
			t.Fatalf("scan: %v", err)
		}
		seen++
		if (kits != nil && *kits) != (lib != nil && *lib) {
			t.Errorf("role %s: brand.kits=%v but brand.copy=%v", key, kits != nil && *kits, lib != nil && *lib)
		}
	}
	if seen != len(authz.SeedRoles) {
		t.Fatalf("saw %d roles", seen)
	}
}
