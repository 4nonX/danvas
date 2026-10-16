package accounts

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestSsoJoin_DB(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set; skipping DB integration test")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, stripSchema(dsn))
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	svc := NewService(tx, "test-jwt-secret")

	sso := func(name string) (string, string) {
		email := name + "+" + uuid.NewString() + "@example.com"
		sub := "sub-" + uuid.NewString()
		u, _, _, err := svc.LoginWithOidc(ctx, OidcProfile{Subject: sub, Email: email, EmailVerified: true, Name: name}, "d", "ip", true, true)
		if err != nil {
			t.Fatalf("sso %s: %v", name, err)
		}
		return u.ID, sub
	}
	again := func(id, sub string) {
		var email string
		_ = tx.QueryRow(ctx, `SELECT email FROM users WHERE id = $1`, id).Scan(&email)
		if _, _, _, err := svc.LoginWithOidc(ctx, OidcProfile{Subject: sub, Email: email, EmailVerified: true}, "d", "ip", true, true); err != nil {
			t.Fatalf("sso again: %v", err)
		}
	}
	role := func(user, ws string) string {
		r, ok := svc.memberRole(ctx, user, ws)
		if !ok {
			return ""
		}
		return r
	}

	owner, _ := sso("owner")
	ws, err := svc.CreateWorkspace(ctx, owner, "Apotheke", "team")
	if err != nil {
		t.Fatalf("workspace: %v", err)
	}
	early, earlySub := sso("early")
	pw, _, _, err := svc.Signup(ctx, "pw+"+uuid.NewString()+"@example.com", "a-strong-password", "PW")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}

	// Only owners and admins switch it, only to member or viewer, only on a
	// team workspace.
	if _, err := svc.SetSsoJoin(ctx, early, ws.ID, "member"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-member switched it: %v", err)
	}
	if _, err := svc.SetSsoJoin(ctx, owner, ws.ID, "admin"); !errors.Is(err, ErrBadRequest) {
		t.Fatalf("admin role accepted: %v", err)
	}
	var personal string
	_ = tx.QueryRow(ctx, `SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id WHERE m.user_id = $1 AND w.kind = 'PERSONAL'`, owner).Scan(&personal)
	if _, err := svc.SetSsoJoin(ctx, owner, personal, "member"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("personal workspace accepted: %v", err)
	}

	// Switching on adds everyone with an SSO account, nobody else, and keeps
	// the owner's role.
	added, err := svc.SetSsoJoin(ctx, owner, ws.ID, "member")
	if err != nil || added < 1 {
		t.Fatalf("enable: %d %v", added, err)
	}
	if role(early, ws.ID) != "member" || role(owner, ws.ID) != "owner" || role(pw.ID, ws.ID) != "" {
		t.Fatalf("roles early=%q owner=%q password=%q", role(early, ws.ID), role(owner, ws.ID), role(pw.ID, ws.ID))
	}
	if j, _ := svc.GetSsoJoin(ctx, early, ws.ID); j.Role != "member" {
		t.Fatalf("setting %+v", j)
	}

	// A first SSO sign-in after that joins too.
	late, _ := sso("late")
	if role(late, ws.ID) != "member" {
		t.Fatalf("late sign-in not added: %q", role(late, ws.ID))
	}

	// Removed: not added back by the next sign-in.
	if err := svc.RemoveMember(ctx, owner, ws.ID, early); err != nil {
		t.Fatalf("remove: %v", err)
	}
	again(early, earlySub)
	if role(early, ws.ID) != "" {
		t.Fatalf("removed member came back")
	}
	// An accepted invitation brings them back for good.
	var earlyEmail string
	_ = tx.QueryRow(ctx, `SELECT email FROM users WHERE id = $1`, early).Scan(&earlyEmail)
	_, token, err := svc.Invite(ctx, owner, ws.ID, earlyEmail, "viewer")
	if err != nil {
		t.Fatalf("invite: %v", err)
	}
	if _, err := svc.AcceptInvitation(ctx, early, token); err != nil {
		t.Fatalf("accept: %v", err)
	}
	var excluded int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM workspace_sso_join_exclusions WHERE workspace_id = $1 AND user_id = $2`, ws.ID, early).Scan(&excluded)
	if excluded != 0 || role(early, ws.ID) != "viewer" {
		t.Fatalf("after invite: excluded=%d role=%q", excluded, role(early, ws.ID))
	}

	// Switched off: new sign-ins no longer join; the members stay.
	if _, err := svc.SetSsoJoin(ctx, owner, ws.ID, ""); err != nil {
		t.Fatalf("disable: %v", err)
	}
	after, _ := sso("after")
	if role(after, ws.ID) != "" || role(late, ws.ID) != "member" {
		t.Fatalf("after disable: after=%q late=%q", role(after, ws.ID), role(late, ws.ID))
	}
}
