package accounts

import (
	"testing"

	"github.com/google/uuid"

	"hycanvas/backend/internal/authz"
	"hycanvas/backend/internal/migrations"
)

// The export rights: a workspace seeded before them gains one permission per
// kind, on the roles that may manage roles and no others. Running the migration
// again changes nothing, and each right can be taken alone.
func TestRoles_SettingsExportMigration(t *testing.T) {
	ctx, tx := rolesTestTx(t)
	svc := NewService(tx, "test-jwt-secret")
	_, ws, _, err := svc.Signup(ctx, "roles-se+"+uuid.NewString()+"@example.com", "a-strong-password", "Owner")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM "workspace_permissions" WHERE "workspace_id"=$1 AND "seed_key" LIKE 'export-%' AND "seed_key" NOT LIKE 'export-profiles%'`, ws.ID); err != nil {
		t.Fatalf("strip: %v", err)
	}
	sql, err := migrations.FS.ReadFile("sql/20261103000000_settings_export_actions/migration.sql")
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	for i := 0; i < 2; i++ {
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("migrate (run %d): %v", i+1, err)
		}
	}
	rows, err := tx.Query(ctx, `
		SELECT r."seed_key",
		       COALESCE(bool_or(p."actions" ? 'roles.manage'), false),
		       count(*) FILTER (WHERE p."seed_key" IN ('export-export-profiles', 'export-print-presets', 'export-color-profiles', 'export-color-libraries', 'export-roles', 'export-workspace-rules', 'export-folder-defaults', 'export-member-emails'))
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
		var manages bool
		var exports int
		if err := rows.Scan(&key, &manages, &exports); err != nil {
			t.Fatalf("scan: %v", err)
		}
		seen++
		want := 0
		if manages {
			want = 8
		}
		if exports != want {
			t.Errorf("role %s: manages roles=%v, export permissions=%d, want %d", key, manages, exports, want)
		}
	}
	if seen != len(authz.SeedRoles) {
		t.Fatalf("saw %d roles", seen)
	}
}
