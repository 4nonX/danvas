package home

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/persistence"
)

// Folder print defaults (F44): set by folder.defaults only, workspace
// profiles of the right kind only, inherited by subfolders, gone with the
// profile or the folder.
func TestFolderDefaults_DB(t *testing.T) {
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

	acct := accounts.NewService(tx, "test-jwt-secret")
	signup := func(tag string) string {
		u, _, _, err := acct.Signup(ctx, tag+"+"+uuid.NewString()+"@example.com", "a-strong-password", tag)
		if err != nil {
			t.Fatal(err)
		}
		return u.ID
	}
	owner, member := signup("owner"), signup("member")
	team, err := acct.CreateWorkspace(ctx, owner, "Team", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO "workspace_members" (id,"workspace_id","user_id",role,status,"joined_at","updated_at")
		VALUES ($1,$2,$3,'MEMBER','ACTIVE',now(),now())`, uuid.NewString(), team.ID, member); err != nil {
		t.Fatal(err)
	}
	if err := acct.EnsureRoles(ctx, tx, team.ID); err != nil {
		t.Fatal(err)
	}
	h := NewService(tx, persistence.NewService(tx), acct)

	labels, err := h.CreateFolder(ctx, owner, team.ID, "Labels", nil)
	if err != nil {
		t.Fatal(err)
	}
	small, err := h.CreateFolder(ctx, owner, team.ID, "Small labels", &labels.ID)
	if err != nil {
		t.Fatal(err)
	}
	profile := func(kind string, ws, user *string, name string) string {
		id := uuid.NewString()
		if _, err := tx.Exec(ctx, `INSERT INTO "export_profiles" (id, kind, "workspace_id", "user_id", name, settings) VALUES ($1,$2,$3,$4,$5,'{}')`, id, kind, ws, user, name); err != nil {
			t.Fatal(err)
		}
		return id
	}
	labelExport := profile("export", &team.ID, nil, "Label 50x100")
	labelPrint := profile("print", &team.ID, nil, "Label printer")
	personal := profile("export", nil, &owner, "Mine")
	other, err := acct.CreateWorkspace(ctx, owner, "Other", "")
	if err != nil {
		t.Fatal(err)
	}
	foreign := profile("export", &other.ID, nil, "Elsewhere")

	// Members may see the defaults, not set them.
	if _, err := h.SetFolderDefault(ctx, member, labels.ID, "export", &labelExport); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member set: want forbidden, got %v", err)
	}
	// Only the workspace's own profiles of the matching kind.
	for _, bad := range []string{personal, foreign, labelPrint} {
		if _, err := h.SetFolderDefault(ctx, owner, labels.ID, "export", &bad); !errors.Is(err, ErrInvalid) {
			t.Fatalf("profile %s: want invalid, got %v", bad, err)
		}
	}
	if _, err := h.SetFolderDefault(ctx, owner, labels.ID, "label", &labelExport); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unknown kind: want invalid, got %v", err)
	}

	if _, err := h.SetFolderDefault(ctx, owner, labels.ID, "export", &labelExport); err != nil {
		t.Fatal(err)
	}
	if _, err := h.SetFolderDefault(ctx, owner, small.ID, "print", &labelPrint); err != nil {
		t.Fatal(err)
	}
	// The subfolder inherits the export profile and has its own print preset.
	d, err := h.GetFolderDefaults(ctx, member, small.ID)
	if err != nil {
		t.Fatal(err)
	}
	if d.CanEdit || d.Own["print"] != labelPrint || d.Own["export"] != "" {
		t.Fatalf("own: %+v canEdit=%v", d.Own, d.CanEdit)
	}
	if e := d.Effective["export"]; e == nil || e.ProfileID != labelExport || e.FolderID != labels.ID || e.FolderName != "Labels" {
		t.Fatalf("inherited export: %+v", e)
	}
	if e := d.Effective["print"]; e == nil || e.ProfileID != labelPrint || e.FolderID != small.ID {
		t.Fatalf("own print: %+v", e)
	}
	// Clearing it on the parent clears it for the subfolder too.
	if _, err := h.SetFolderDefault(ctx, owner, labels.ID, "export", nil); err != nil {
		t.Fatal(err)
	}
	if d, _ := h.GetFolderDefaults(ctx, owner, small.ID); d.Effective["export"] != nil || !d.CanEdit {
		t.Fatalf("after clearing: %+v", d)
	}
	// Deleting the profile removes the default with it.
	if _, err := tx.Exec(ctx, `DELETE FROM "export_profiles" WHERE id = $1`, labelPrint); err != nil {
		t.Fatal(err)
	}
	if d, _ := h.GetFolderDefaults(ctx, owner, small.ID); len(d.Own) != 0 || len(d.Effective) != 0 {
		t.Fatalf("after deleting the profile: %+v", d)
	}
	// A non-member sees nothing.
	if _, err := h.GetFolderDefaults(ctx, uuid.NewString(), small.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-member: %v", err)
	}
}
