package templates

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/persistence"
	"hycanvas/backend/internal/storage"
)

func stripSchema(dsn string) string {
	for _, sep := range []string{"?schema=", "&schema="} {
		if i := strings.Index(dsn, sep); i >= 0 {
			return dsn[:i]
		}
	}
	return dsn
}

func TestSeedLoads(t *testing.T) {
	// The built-in catalog is intentionally empty by default. If seed templates
	// are present, they must be well-formed and findable by id.
	if len(seedEntries) == 0 {
		t.Skip("no built-in seed templates")
	}
	first := seedEntries[0].toTemplate()
	if first.ID == "" || first.Title == "" {
		t.Fatalf("seed template missing id/title: %+v", first)
	}
	if _, ok := findSeed(first.ID); !ok {
		t.Fatalf("findSeed should locate %q", first.ID)
	}
}

func TestSearchTemplates(t *testing.T) {
	pool := []Template{
		{ID: "1", Title: "Birthday Poster", Tags: []string{"party"}, Categories: []string{"poster"}},
		{ID: "2", Title: "Resume", Tags: []string{"cv"}, Categories: []string{"doc"}},
		{ID: "3", Title: "Birthday Card", Tags: []string{"birthday"}, Categories: []string{"card"}},
	}
	res := searchTemplates(pool, TemplateQuery{Text: "birthday"})
	if len(res) != 2 {
		t.Fatalf("text search should match 2, got %d", len(res))
	}
	// Category filter.
	res2 := searchTemplates(pool, TemplateQuery{Categories: []string{"doc"}})
	if len(res2) != 1 || res2[0].ID != "2" {
		t.Fatalf("category filter wrong: %+v", res2)
	}
}

func TestDeepCopyDesign(t *testing.T) {
	file := map[string]any{
		"id": "orig",
		"pages": []any{map[string]any{
			"id": "p1", "children": []any{
				map[string]any{"id": "a", "type": "shape"},
				map[string]any{"id": "c", "type": "connector", "start": map[string]any{"attach": map[string]any{"nodeId": "a"}}},
			},
		}},
	}
	copy, idMap := deepCopyDesign(file)
	if copy["id"] == "orig" {
		t.Fatal("design id should be regenerated")
	}
	// Source not mutated.
	if file["id"] != "orig" {
		t.Fatal("source design must not be mutated")
	}
	page := copy["pages"].([]any)[0].(map[string]any)
	if page["id"] == "p1" {
		t.Fatal("page id should be regenerated")
	}
	kids := page["children"].([]any)
	newA := kids[0].(map[string]any)["id"].(string)
	if newA == "a" {
		t.Fatal("node id should be regenerated")
	}
	// Connector attach remapped to the new node id.
	conn := kids[1].(map[string]any)
	attach := conn["start"].(map[string]any)["attach"].(map[string]any)
	if attach["nodeId"] != newA {
		t.Fatalf("connector attach should remap to %q, got %v (idMap %v)", newA, attach["nodeId"], idMap["a"])
	}
}

type tPersist struct{ p *persistence.Service }

func (a tPersist) CreateDesign(ctx context.Context, ws, title string, from map[string]any, author *string) (string, error) {
	rec, err := a.p.Create(ctx, ws, title, persistence.DesignFile(from), author)
	if err != nil {
		return "", err
	}
	return rec.ID, nil
}
func (a tPersist) GetWorkspaceID(ctx context.Context, id string) (string, error) {
	return a.p.GetWorkspaceID(ctx, id)
}
func (a tPersist) LoadDesignFile(ctx context.Context, id, ws string) (map[string]any, error) {
	l, err := a.p.LoadFile(ctx, id, ws)
	if err != nil {
		return nil, err
	}
	return l.File, nil
}

func TestTemplates_DB(t *testing.T) {
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
	owner, ws, _, err := acct.Signup(ctx, "tpl-owner+"+uuid.NewString()+"@example.com", "a-strong-password", "Owner")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	persist := persistence.NewService(tx).WithStorage(store)
	svc := NewService(tx, acct, tPersist{persist})

	// List includes the embedded seed catalog.
	list, err := svc.List(ctx, owner.ID, TemplateQuery{}, "", "")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) < len(seedEntries) {
		t.Fatalf("list should include seed templates: %d < %d", len(list), len(seedEntries))
	}

	// Obtain a design to save as a template. Prefer applying a seed template
	// (which also exercises Apply); fall back to a directly-created design when
	// the built-in catalog is empty (the default).
	var designID string
	if len(seedEntries) > 0 {
		seedID := seedEntries[0].toTemplate().ID
		designID, err = svc.Apply(ctx, owner.ID, seedID, ws.ID)
		if err != nil {
			t.Fatalf("Apply seed: %v", err)
		}
	} else {
		design := map[string]any{
			"id": uuid.NewString(), "schemaVersion": 10, "title": "Source",
			"format": map[string]any{"width": 100, "height": 100, "unit": "px"},
			"unit":   "px", "dpi": 96,
			"pages":  []any{map[string]any{"id": "p1", "name": "Page 1", "width": 100, "height": 100, "children": []any{}}},
			"assets": []any{}, "fonts": []any{}, "meta": map[string]any{},
		}
		rec, cerr := persist.Create(ctx, ws.ID, "Source", persistence.DesignFile(design), nil)
		if cerr != nil {
			t.Fatalf("create design: %v", cerr)
		}
		designID = rec.ID
	}
	if _, err := persist.LoadFile(ctx, designID, ws.ID); err != nil {
		t.Fatalf("design should load: %v", err)
	}

	// Save the design as a private template; it then appears in the list.
	loaded, _ := persist.LoadFile(ctx, designID, ws.ID)
	saved, err := svc.SaveAsTemplate(ctx, owner.ID, SaveInput{WorkspaceID: ws.ID, File: loaded.File, Title: "My Template", Visibility: "private"})
	if err != nil {
		t.Fatalf("SaveAsTemplate: %v", err)
	}
	if saved.Visibility != "personal" {
		t.Fatalf("private template should map to personal visibility: %s", saved.Visibility)
	}
	got, err := svc.Get(ctx, owner.ID, saved.ID)
	if err != nil || got.ID != saved.ID {
		t.Fatalf("Get saved: %+v err=%v", got, err)
	}
	// A different user cannot see the private template.
	other, _, _, _ := acct.Signup(ctx, "tpl-other+"+uuid.NewString()+"@example.com", "a-strong-password", "Other")
	if _, err := svc.Get(ctx, other.ID, saved.ID); err != ErrNotFound {
		t.Fatalf("private template should be hidden from others, got %v", err)
	}

	// Collections: create, assign, list, delete.
	col, err := svc.CreateCollection(ctx, owner.ID, ws.ID, "Brand")
	if err != nil {
		t.Fatalf("CreateCollection: %v", err)
	}
	// Re-save as a workspace template so it can be collected (private is owner-only but workspace-scoped column is set).
	wsTmpl, err := svc.SaveAsTemplate(ctx, owner.ID, SaveInput{WorkspaceID: ws.ID, File: loaded.File, Title: "WS Tmpl", Visibility: "workspace"})
	if err != nil {
		t.Fatalf("save workspace template: %v", err)
	}
	if _, err := svc.AssignCollection(ctx, owner.ID, wsTmpl.ID, col.ID); err != nil {
		t.Fatalf("AssignCollection: %v", err)
	}
	inCol, err := svc.List(ctx, owner.ID, TemplateQuery{}, ws.ID, col.ID)
	if err != nil || len(inCol) != 1 || inCol[0].ID != wsTmpl.ID {
		t.Fatalf("collection filter wrong: %+v err=%v", inCol, err)
	}
	if err := svc.DeleteCollection(ctx, owner.ID, col.ID); err != nil {
		t.Fatalf("DeleteCollection: %v", err)
	}

	// Delete: a plain member who did not create the template may not; an
	// admin of its workspace may; the creator may delete their own.
	member, _, _, _ := acct.Signup(ctx, "tpl-member+"+uuid.NewString()+"@example.com", "a-strong-password", "Member")
	admin, _, _, _ := acct.Signup(ctx, "tpl-admin+"+uuid.NewString()+"@example.com", "a-strong-password", "Admin")
	for _, m := range []struct{ id, role string }{{member.ID, "MEMBER"}, {admin.ID, "ADMIN"}} {
		if _, err := tx.Exec(ctx, `INSERT INTO "workspace_members" (id,"workspace_id","user_id",role,status,"joined_at","updated_at") VALUES ($1,$2,$3,$4,'ACTIVE',now(),now())`,
			uuid.NewString(), ws.ID, m.id, m.role); err != nil {
			t.Fatalf("add member: %v", err)
		}
	}
	flags := func(userID string) map[string][2]bool {
		l, err := svc.List(ctx, userID, TemplateQuery{}, ws.ID, "")
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		out := map[string][2]bool{}
		for _, x := range l {
			out[x.ID] = [2]bool{x.CanDelete, x.LastInWorkspace}
		}
		return out
	}
	if f := flags(member.ID); f[wsTmpl.ID][0] {
		t.Fatalf("a plain member must not see canDelete on someone else's template")
	}
	if f := flags(admin.ID); !f[wsTmpl.ID][0] || f[wsTmpl.ID][1] {
		t.Fatalf("admin should see canDelete, and it is not the last template (the private one counts): %v", f[wsTmpl.ID])
	}
	if err := svc.Delete(ctx, member.ID, wsTmpl.ID); err != ErrForbidden {
		t.Fatalf("member delete should be forbidden, got %v", err)
	}
	if err := svc.Delete(ctx, other.ID, wsTmpl.ID); err != ErrNotFound {
		t.Fatalf("a non-member should get not found, got %v", err)
	}
	if err := svc.Delete(ctx, admin.ID, wsTmpl.ID); err != nil {
		t.Fatalf("admin delete: %v", err)
	}
	if _, err := svc.Get(ctx, owner.ID, wsTmpl.ID); err != ErrNotFound {
		t.Fatalf("deleted template should be gone, got %v", err)
	}
	// The private template is now the workspace's last one.
	if f := flags(owner.ID); !f[saved.ID][0] || !f[saved.ID][1] {
		t.Fatalf("creator should see canDelete and lastInWorkspace on the last template: %v", f[saved.ID])
	}
	if err := svc.Delete(ctx, owner.ID, saved.ID); err != nil {
		t.Fatalf("creator delete: %v", err)
	}
	if err := svc.Delete(ctx, owner.ID, saved.ID); err != ErrNotFound {
		t.Fatalf("deleting twice should be not found, got %v", err)
	}
	if len(seedEntries) > 0 {
		if err := svc.Delete(ctx, owner.ID, seedEntries[0].toTemplate().ID); err != ErrForbidden {
			t.Fatalf("built-in template delete should be forbidden, got %v", err)
		}
	}
}
