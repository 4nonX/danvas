package persistence

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/storage"
)

// EmptyTrash removes only what was confirmed, is still in this workspace's
// trash and is the caller's to remove; a design restored or trashed meanwhile
// stays as it is.
func TestEmptyTrash_DB(t *testing.T) {
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

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatalf("storage: %v", err)
	}
	acct := accounts.NewService(tx, "test-jwt-secret")
	owner, ws, _, err := acct.Signup(ctx, "trash-owner+"+uuid.NewString()+"@example.com", "a-strong-password", "Owner")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	_, otherWs, _, err := acct.Signup(ctx, "trash-other+"+uuid.NewString()+"@example.com", "a-strong-password", "Other")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	svc := NewService(tx).WithStorage(store)

	create := func(workspaceID, title string, creator *string, trashed bool) string {
		t.Helper()
		rec, err := svc.Create(ctx, workspaceID, title, nil, creator)
		if err != nil {
			t.Fatalf("create %s: %v", title, err)
		}
		if trashed {
			if err := svc.SoftDelete(ctx, rec.ID, workspaceID); err != nil {
				t.Fatalf("trash %s: %v", title, err)
			}
		}
		return rec.ID
	}
	mine := create(ws.ID, "mine", &owner.ID, true)
	theirs := create(ws.ID, "theirs", nil, true)
	unconfirmed := create(ws.ID, "trashed after the confirmation", &owner.ID, true)
	live := create(ws.ID, "live", &owner.ID, false)
	elsewhere := create(otherWs.ID, "other workspace", nil, true)

	// The trash list says who created what.
	trash, err := svc.ListTrash(ctx, ws.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	for _, d := range trash {
		if d.ID == mine && (d.CreatedByID == nil || *d.CreatedByID != owner.ID) {
			t.Fatalf("creator missing on the trash list: %+v", d)
		}
	}

	// Scope own: only the caller's own design goes.
	own := func(creatorID string) bool { return creatorID == owner.ID }
	res, err := svc.EmptyTrash(ctx, ws.ID, []string{mine, mine, theirs, live, elsewhere, uuid.NewString()}, own)
	if err != nil {
		t.Fatalf("empty: %v", err)
	}
	if res.Deleted != 1 || res.Failed != 0 || res.Skipped != 4 {
		t.Fatalf("want 1 deleted, 4 skipped, got %+v", res)
	}
	exists := func(id string) bool {
		t.Helper()
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM "designs" WHERE id = $1`, id).Scan(&n); err != nil {
			t.Fatalf("count: %v", err)
		}
		return n == 1
	}
	if exists(mine) {
		t.Fatal("own trashed design should be gone")
	}
	for name, id := range map[string]string{"other's design": theirs, "live design": live, "other workspace": elsewhere, "unconfirmed design": unconfirmed} {
		if !exists(id) {
			t.Fatalf("%s must stay", name)
		}
	}
	if _, err := svc.LoadFile(ctx, live, ws.ID); err != nil {
		t.Fatalf("live design should still load: %v", err)
	}

	// Scope all: the rest of what was confirmed goes, nothing else.
	all := func(string) bool { return true }
	res, err = svc.EmptyTrash(ctx, ws.ID, []string{theirs}, all)
	if err != nil || res.Deleted != 1 {
		t.Fatalf("empty all: %+v, %v", res, err)
	}
	if exists(theirs) || !exists(unconfirmed) {
		t.Fatal("scope all should remove exactly the confirmed design")
	}

	// Without storage nothing can be removed.
	if _, err := NewService(tx).EmptyTrash(ctx, ws.ID, []string{unconfirmed}, all); err != ErrNoStorage {
		t.Fatalf("want ErrNoStorage, got %v", err)
	}
}
