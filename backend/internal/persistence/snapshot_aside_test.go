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

// A version kept aside (F49: a browser's outdated offline changes) is in the
// history with its label and restorable, and the current file stays.
func TestSnapshotAside_DB(t *testing.T) {
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
	owner, ws, _, err := acct.Signup(ctx, "aside+"+uuid.NewString()+"@example.com", "a-strong-password", "Owner")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	svc := NewService(tx).WithStorage(store)
	rec, err := svc.Create(ctx, ws.ID, "Label", nil, &owner.ID)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	file := func(title string) DesignFile {
		return DesignFile{
			"id": rec.ID, "schemaVersion": float64(currentSchemaVersion), "title": title,
			"pages": []any{map[string]any{"id": "p1", "width": float64(400), "height": float64(200), "children": []any{}}},
		}
	}
	current, err := svc.Snapshot(ctx, rec.ID, ws.ID, file("newer"), KindCheckpoint, nil, &owner.ID)
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	label := "Offline changes"
	aside, err := svc.SnapshotAside(ctx, rec.ID, ws.ID, file("offline"), &label, &owner.ID)
	if err != nil {
		t.Fatalf("SnapshotAside: %v", err)
	}
	if aside.ID == current.ID {
		t.Fatal("aside version reused the current snapshot")
	}

	loaded, err := svc.LoadFile(ctx, rec.ID, ws.ID)
	if err != nil {
		t.Fatalf("LoadFile: %v", err)
	}
	if loaded.File["title"] != "newer" {
		t.Fatalf("current file moved to %v, want the newer one", loaded.File["title"])
	}
	if loaded.Record.CurrentSnapshot == nil || *loaded.Record.CurrentSnapshot != current.ID {
		t.Fatalf("current snapshot %v, want %s", loaded.Record.CurrentSnapshot, current.ID)
	}

	page, err := svc.ListVersions(ctx, rec.ID, ws.ID, "")
	if err != nil {
		t.Fatalf("ListVersions: %v", err)
	}
	found := false
	for _, v := range page.Items {
		if v.Label == nil || *v.Label != label {
			continue
		}
		f, err := svc.VersionFile(ctx, rec.ID, ws.ID, v.ID)
		if err != nil || f["title"] != "offline" {
			t.Fatalf("aside version file: %v %v", f["title"], err)
		}
		found = true
	}
	if !found {
		t.Fatal("aside version not in the history")
	}
}
