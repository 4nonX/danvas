package templates

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/persistence"
	"hycanvas/backend/internal/storage"
)

// Duplicate takes template.publish in the target workspace, needs a template
// the user can see, and leaves the original as it is.
func TestTemplates_Duplicate_DB(t *testing.T) {
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

	store, _ := storage.NewLocal(t.TempDir())
	acct := accounts.NewService(tx, "test-jwt-secret")
	owner, ws, _, err := acct.Signup(ctx, "tpl-dup+"+uuid.NewString()+"@example.com", "a-strong-password", "Owner")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	other, otherWs, _, err := acct.Signup(ctx, "tpl-dup-o+"+uuid.NewString()+"@example.com", "a-strong-password", "Other")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	member, _, _, _ := acct.Signup(ctx, "tpl-dup-m+"+uuid.NewString()+"@example.com", "a-strong-password", "Member")
	viewer, _, _, _ := acct.Signup(ctx, "tpl-dup-v+"+uuid.NewString()+"@example.com", "a-strong-password", "Viewer")
	for _, m := range []struct{ id, role string }{{member.ID, "MEMBER"}, {viewer.ID, "VIEWER"}} {
		if _, err := tx.Exec(ctx, `INSERT INTO "workspace_members" (id,"workspace_id","user_id",role,status,"joined_at","updated_at") VALUES ($1,$2,$3,$4,'ACTIVE',now(),now())`,
			uuid.NewString(), ws.ID, m.id, m.role); err != nil {
			t.Fatalf("add member: %v", err)
		}
	}
	svc := NewService(tx, acct, tPersist{persistence.NewService(tx).WithStorage(store)})

	file := map[string]any{"id": "f1", "title": "Original", "pages": []any{map[string]any{"id": "p1", "width": 100.0, "height": 50.0, "children": []any{map[string]any{"id": "n1", "type": "rect"}}}}}
	col, err := svc.CreateCollection(ctx, owner.ID, ws.ID, "Etiketten")
	if err != nil {
		t.Fatalf("collection: %v", err)
	}
	src, err := svc.SaveAsTemplate(ctx, owner.ID, SaveInput{WorkspaceID: ws.ID, File: file, Title: "Original", Category: "label", Tags: []string{"a", "b"}, Thumbnail: "thumb.png", Visibility: "workspace", CollectionID: col.ID})
	if err != nil {
		t.Fatalf("save: %v", err)
	}

	// A member duplicates in the workspace: their own, with everything kept.
	dup, err := svc.Duplicate(ctx, member.ID, src.ID, ws.ID, "  Original (Kopie) ")
	if err != nil {
		t.Fatalf("duplicate: %v", err)
	}
	if dup.ID == src.ID || dup.Title != "Original (Kopie)" || dup.OwnerID != member.ID || dup.Visibility != "team" {
		t.Fatalf("unexpected copy: %+v", dup)
	}
	row, err := svc.getRow(ctx, dup.ID)
	if err != nil {
		t.Fatalf("row: %v", err)
	}
	if row.CollectionID == nil || *row.CollectionID != col.ID || row.Category == nil || *row.Category != "label" || row.Thumbnail == nil || *row.Thumbnail != "thumb.png" || strings.Join(row.Tags, ",") != "a,b" {
		t.Fatalf("copy lost its data: %+v", row)
	}
	var copied map[string]any
	if err := json.Unmarshal(row.File, &copied); err != nil {
		t.Fatalf("file: %v", err)
	}
	if copied["title"] != "Original (Kopie)" || copied["id"] != "f1" {
		t.Fatalf("file of the copy: %v", copied)
	}
	// The copy is the member's to change, the original stays.
	if orig, err := svc.getRow(ctx, src.ID); err != nil || orig.Title != "Original" {
		t.Fatalf("original changed: %+v, %v", orig, err)
	}
	var origFile map[string]any
	origRow, _ := svc.getRow(ctx, src.ID)
	_ = json.Unmarshal(origRow.File, &origFile)
	if origFile["title"] != "Original" {
		t.Fatalf("original file changed: %v", origFile["title"])
	}

	// An unusable title falls back to the original's.
	if d, err := svc.Duplicate(ctx, owner.ID, src.ID, ws.ID, strings.Repeat("x", maxTitleRunes+1)); err != nil || d.Title != "Original" {
		t.Fatalf("long title: %+v, %v", d, err)
	}

	// Rights: viewers do not create templates; a non-member neither; an
	// invisible template does not exist.
	if _, err := svc.Duplicate(ctx, viewer.ID, src.ID, ws.ID, "x"); err != ErrForbidden {
		t.Fatalf("viewer: %v", err)
	}
	if _, err := svc.Duplicate(ctx, other.ID, src.ID, ws.ID, "x"); err != ErrForbidden {
		t.Fatalf("non-member: %v", err)
	}
	if _, err := svc.Duplicate(ctx, other.ID, src.ID, otherWs.ID, "x"); err != ErrNotFound {
		t.Fatalf("invisible template: %v", err)
	}
	if _, err := svc.Duplicate(ctx, owner.ID, src.ID, "", "x"); err != ErrBadRequest {
		t.Fatalf("no workspace: %v", err)
	}

	// A public template's copy is not public, and leaves its collection behind
	// in another workspace.
	pub, err := svc.SaveAsTemplate(ctx, owner.ID, SaveInput{WorkspaceID: ws.ID, File: file, Title: "Public", Visibility: "public", CollectionID: col.ID})
	if err != nil {
		t.Fatalf("save public: %v", err)
	}
	cp, err := svc.Duplicate(ctx, other.ID, pub.ID, otherWs.ID, "Public (copy)")
	if err != nil {
		t.Fatalf("duplicate public: %v", err)
	}
	if cp.Visibility != "team" || cp.OwnerID != other.ID {
		t.Fatalf("public copy: %+v", cp)
	}
	cpRow, _ := svc.getRow(ctx, cp.ID)
	if cpRow.CollectionID != nil {
		t.Fatalf("collection of another workspace kept: %v", *cpRow.CollectionID)
	}

	// A built-in template, when the catalog has any, becomes a stored one.
	if len(seedEntries) > 0 {
		seed := seedEntries[0].toTemplate()
		d, err := svc.Duplicate(ctx, owner.ID, seed.ID, ws.ID, "Built-in (copy)")
		if err != nil {
			t.Fatalf("duplicate built-in: %v", err)
		}
		if d.ID == seed.ID || d.OwnerID != owner.ID || d.Visibility != "team" {
			t.Fatalf("built-in copy: %+v", d)
		}
	}
}
