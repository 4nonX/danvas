package accounts

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"hycanvas/backend/internal/authz"
)

// TestRoles_UpgradeKeepsEveryDecision runs the F42 backfill on a copy of a
// real database (F42_UPGRADE_DATABASE_URL, never a live one: it writes) and
// proves every active member is allowed exactly what their pre-F42 role
// allowed, action by action (AC-1 on real data).
func TestRoles_UpgradeKeepsEveryDecision(t *testing.T) {
	dsn := os.Getenv("F42_UPGRADE_DATABASE_URL")
	if dsn == "" {
		t.Skip("F42_UPGRADE_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, wsStripSchema(dsn))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	// The decisions before: every member's legacy role and the switches.
	type member struct{ user, ws, legacy string }
	var members []member
	rows, err := pool.Query(ctx, `SELECT "user_id"::text, "workspace_id"::text, lower(role::text) FROM "workspace_members" WHERE status = 'ACTIVE'`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var m member
		if err := rows.Scan(&m.user, &m.ws, &m.legacy); err != nil {
			t.Fatal(err)
		}
		members = append(members, m)
	}
	rows.Close()
	switches := map[string][2]bool{}
	rows, err = pool.Query(ctx, `SELECT "workspace_id"::text, "profiles_managed_by" = 'members', "print_presets_managed_by" = 'members' FROM "workspace_export_settings"`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var ws string
		var e, p bool
		if err := rows.Scan(&ws, &e, &p); err != nil {
			t.Fatal(err)
		}
		switches[ws] = [2]bool{e, p}
	}
	rows.Close()

	svc := NewService(pool, "test-jwt-secret")
	n, err := svc.BackfillRoles(ctx)
	if err != nil {
		t.Fatalf("backfill: %v", err)
	}
	t.Logf("backfilled %d workspaces, checking %d memberships x %d actions", n, len(members), len(authz.Actions))

	for _, m := range members {
		mr, err := svc.EffectiveRole(ctx, m.user, m.ws)
		if err != nil {
			t.Fatalf("%s in %s: %v", m.user, m.ws, err)
		}
		if mr.RoleID == "" {
			t.Errorf("%s in %s: no role after the backfill", m.user, m.ws)
		}
		for _, a := range authz.Actions {
			want := roleRank[m.legacy] >= roleRank[a.LegacyRole]
			sw := switches[m.ws]
			if m.legacy == "member" && ((a.Key == authz.PrintExportProfiles && sw[0]) || (a.Key == authz.PrintPrintPresets && sw[1])) {
				want = true
			}
			if got := mr.Actions.Allows(a.Key, false); got != want {
				t.Errorf("%s (%s) in %s: %s allowed=%v, was %v", m.user, m.legacy, m.ws, a.Key, got, want)
			}
		}
		if base := strings.ToLower(mr.Legacy); base != m.legacy {
			t.Errorf("%s in %s: legacy role changed %s -> %s", m.user, m.ws, m.legacy, base)
		}
	}
}
