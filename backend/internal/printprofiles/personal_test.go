package printprofiles

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"hycanvas/backend/internal/accounts"
)

func TestPersonalProfiles_DB(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set; skipping DB integration test")
	}
	if i := strings.Index(dsn, "?schema="); i >= 0 {
		dsn = dsn[:i]
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	acct := accounts.NewService(tx, "test-jwt-secret")
	svc := NewService(tx, acct)
	me, ws, _, err := acct.Signup(ctx, "pp-me+"+uuid.NewString()+"@example.com", "a-strong-password", "Me")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	other, _, _, err := acct.Signup(ctx, "pp-other+"+uuid.NewString()+"@example.com", "a-strong-password", "Other")
	if err != nil {
		t.Fatalf("signup other: %v", err)
	}

	icc := profile("prtr", "CMYK", "Lab ", 2, "Druckerei Coated")
	p, err := svc.CreatePersonal(ctx, me.ID, "", icc)
	if err != nil || p.Owner != "user" || p.Name != "Druckerei Coated" || p.IsDefault || p.WorkspaceID != "" {
		t.Fatalf("create: %v %+v", err, p)
	}
	if _, err := svc.CreatePersonal(ctx, me.ID, "again", icc); err != ErrDuplicate {
		t.Fatalf("duplicate: %v", err)
	}
	if _, err := svc.CreatePersonal(ctx, me.ID, "", []byte("not a profile")); err == nil {
		t.Fatal("accepted a non-profile")
	}
	// The same file may also be a workspace profile: the tables are apart.
	if wp, err := svc.Create(ctx, me.ID, ws.ID, "", icc); err != nil || wp.Owner != "workspace" {
		t.Fatalf("workspace copy: %v %+v", err, wp)
	}

	// Rename, make default, clear default; only the owner can.
	name := "Etiketten"
	if err := svc.Update(ctx, me.ID, p.ID, &name, true, false); err != nil {
		t.Fatalf("update: %v", err)
	}
	list, err := svc.ListPersonal(ctx, me.ID)
	if err != nil || len(list) != 1 || list[0].Name != "Etiketten" || !list[0].IsDefault {
		t.Fatalf("list: %v %+v", err, list)
	}
	if err := svc.Update(ctx, me.ID, p.ID, nil, false, true); err != nil {
		t.Fatalf("clear default: %v", err)
	}
	if list, _ := svc.ListPersonal(ctx, me.ID); list[0].IsDefault {
		t.Fatal("default not cleared")
	}
	if err := svc.Update(ctx, other.ID, p.ID, &name, false, false); err != ErrNotFound {
		t.Fatalf("other user renamed it: %v", err)
	}
	if list, _ := svc.ListPersonal(ctx, other.ID); len(list) != 0 {
		t.Fatalf("other user sees it: %+v", list)
	}

	// The bytes: the owner gets them, nobody else.
	data, sum, err := svc.Data(ctx, me.ID, p.ID)
	if err != nil || len(data) != len(icc) || sum == "" {
		t.Fatalf("data: %v %d", err, len(data))
	}
	if _, _, err := svc.Data(ctx, other.ID, p.ID); err != ErrNotFound {
		t.Fatalf("other user read it: %v", err)
	}

	if err := svc.Delete(ctx, other.ID, p.ID); err != ErrNotFound {
		t.Fatalf("other user deleted it: %v", err)
	}
	if err := svc.Delete(ctx, me.ID, p.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if list, _ := svc.ListPersonal(ctx, me.ID); len(list) != 0 {
		t.Fatalf("still listed: %+v", list)
	}
}
