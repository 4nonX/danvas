package designtransfer

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/home"
	"hycanvas/backend/internal/persistence"
	"hycanvas/backend/internal/storage"
	"hycanvas/backend/internal/uploads"
	"hycanvas/backend/internal/workspacefonts"
)

func TestFindsAndRewritesAssetReferences(t *testing.T) {
	a := "11111111-2222-3333-4444-555555555555"
	b := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	file := map[string]any{
		"assets": []any{map[string]any{"id": "asset-local", "url": "https://x/api/v1/assets/" + a + "/content"}},
		"pages": []any{map[string]any{"children": []any{
			map[string]any{"type": "video", "assetId": strings.ToUpper(b)},
			map[string]any{"type": "text", "content": []any{map[string]any{"runs": []any{map[string]any{"text": "Hi", "style": map[string]any{"fontFamily": "Brand Sans"}}}}}},
		}}},
		"fonts": []any{map[string]any{"url": "data:font/woff2;base64,AAAA" + a}},
	}
	ids := map[string]bool{}
	collectUUIDs(file, ids)
	if !ids[a] || !ids[b] || len(ids) != 2 {
		t.Fatalf("ids = %v", ids)
	}
	out := rewrite(file, map[string]string{a: "new-a", b: "new-b"}).(map[string]any)
	url := out["assets"].([]any)[0].(map[string]any)["url"].(string)
	if url != "https://x/api/v1/assets/new-a/content" {
		t.Fatalf("url = %s", url)
	}
	if got := out["pages"].([]any)[0].(map[string]any)["children"].([]any)[0].(map[string]any)["assetId"]; got != "new-b" {
		t.Fatalf("assetId = %v", got)
	}
	// Embedded data is left as it is, and the input is not changed.
	if !strings.HasSuffix(out["fonts"].([]any)[0].(map[string]any)["url"].(string), a) {
		t.Fatal("data URL was rewritten")
	}
	if !strings.Contains(file["assets"].([]any)[0].(map[string]any)["url"].(string), a) {
		t.Fatal("input was changed")
	}
	fam := map[string]bool{}
	collectFamilies(file, fam)
	if !fam["Brand Sans"] || len(fam) != 1 {
		t.Fatalf("families = %v", fam)
	}
}

// A 1x1 PNG.
const tinyPNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

func stripSchema(dsn string) string {
	if i := strings.Index(dsn, "?schema="); i >= 0 {
		return dsn[:i]
	}
	return dsn
}

func TestTransfer_DB(t *testing.T) {
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
	persist := persistence.NewService(tx).WithStorage(store)
	up := uploads.NewService(tx, store, acct)
	fonts := workspacefonts.NewService(tx, acct)
	folders := home.NewService(tx, persist, acct)
	svc := NewService(tx, acct, persist, up, fonts, folders)

	owner, mine, _, err := acct.Signup(ctx, "tr-owner+"+uuid.NewString()+"@example.com", "a-strong-password", "Owner")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	team, err := acct.CreateWorkspace(ctx, owner.ID, "Apotheke", "team")
	if err != nil {
		t.Fatalf("team: %v", err)
	}
	outsider, _, _, err := acct.Signup(ctx, "tr-out+"+uuid.NewString()+"@example.com", "a-strong-password", "Outsider")
	if err != nil {
		t.Fatalf("signup outsider: %v", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO "workspace_members" (id,"workspace_id","user_id",role,status,"joined_at","updated_at") VALUES ($1,$2,$3,'MEMBER','ACTIVE',now(),now())`, uuid.NewString(), team.ID, outsider.ID); err != nil {
		t.Fatalf("member: %v", err)
	}

	// In the personal workspace: an upload, a library font, a brand kit,
	// a folder with a subfolder, and designs using all of it.
	asset, err := up.Upload(ctx, owner.ID, mine.ID, "logo.png", tinyPNG, nil, "")
	if err != nil {
		t.Fatalf("upload: %v", err)
	}
	woff2 := append([]byte("wOF2"), make([]byte, 64)...)
	if _, err := fonts.Create(ctx, owner.ID, mine.ID, workspacefonts.Face{Family: "Brand Sans", Weight: 400, Style: "normal"}, "brand.woff2", woff2); err != nil {
		t.Fatalf("font: %v", err)
	}
	var kitID string
	if err := tx.QueryRow(ctx, `INSERT INTO "brand_kits" (id,"workspace_id",name,"updated_at") VALUES ($1,$2,'Kit',now()) RETURNING id::text`, uuid.NewString(), mine.ID).Scan(&kitID); err != nil {
		t.Fatalf("kit: %v", err)
	}
	design := func(title string) string {
		file := persistence.DesignFile{
			"format": "hycanvas.design", "schemaVersion": 28.0, "title": title, "unit": "px", "dpi": 96.0,
			"meta":   map[string]any{"brandKitId": kitID, "brandKitVersion": 1.0},
			"assets": []any{map[string]any{"id": "asset-1", "kind": "image", "mime": "image/png", "url": up.AssetURL(asset.ID)}},
			"fonts":  []any{},
			"pages": []any{map[string]any{"id": "p1", "width": 100.0, "height": 100.0, "children": []any{
				map[string]any{"id": "img", "type": "image", "source": map[string]any{"assetId": "asset-1"},
					"transform": map[string]any{"x": 0.0, "y": 0.0, "scaleX": 1.0, "scaleY": 1.0, "rotation": 0.0},
					"size": map[string]any{"width": 10.0, "height": 10.0}, "fit": "cover"},
				map[string]any{"id": "t", "type": "text", "style": map[string]any{"fontFamily": "Brand Sans"},
					"transform": map[string]any{"x": 0.0, "y": 0.0, "scaleX": 1.0, "scaleY": 1.0, "rotation": 0.0},
					"size": map[string]any{"width": 10.0, "height": 10.0}, "content": []any{}},
			}}},
		}
		rec, err := persist.Create(ctx, mine.ID, title, file, &owner.ID)
		if err != nil {
			t.Fatalf("create %s: %v", title, err)
		}
		return rec.ID
	}
	top := design("Etikett")
	labels, err := folders.CreateFolder(ctx, owner.ID, mine.ID, "Etiketten", nil)
	if err != nil {
		t.Fatalf("folder: %v", err)
	}
	hormones, err := folders.CreateFolder(ctx, owner.ID, mine.ID, "Hormone", &labels.ID)
	if err != nil {
		t.Fatalf("subfolder: %v", err)
	}
	inner := design("DHEA")
	if err := folders.Move(ctx, owner.ID, mine.ID, []string{inner}, nil, &hormones.ID); err != nil {
		t.Fatalf("move into folder: %v", err)
	}

	// Refusals: same workspace, and a user who cannot read the source.
	if _, err := svc.Prepare(ctx, owner.ID, Input{DesignIDs: []string{top}, TargetWorkspaceID: mine.ID}); err != ErrSameWorkspace {
		t.Fatalf("same workspace: %v", err)
	}
	if _, err := svc.Prepare(ctx, outsider.ID, Input{DesignIDs: []string{top}, TargetWorkspaceID: team.ID}); err != ErrForbidden {
		t.Fatalf("outsider: %v", err)
	}

	// Copy the design and the folder (with its subfolder) to the team.
	in := Input{DesignIDs: []string{top}, FolderIDs: []string{labels.ID}, TargetWorkspaceID: team.ID}
	src, err := svc.Prepare(ctx, owner.ID, in)
	if err != nil || src != mine.ID {
		t.Fatalf("prepare: %v %s", err, src)
	}
	steps := 0
	res, err := svc.Transfer(ctx, owner.ID, src, in, func(done, total int) { steps++ })
	if err != nil {
		t.Fatalf("transfer: %v", err)
	}
	if len(res.Designs) != 2 || res.Folders != 2 || res.Assets != 1 || steps != 2 || len(res.MissingFonts) != 0 {
		t.Fatalf("result = %+v (steps %d)", res, steps)
	}
	for _, it := range res.Designs {
		if it.Error != "" || it.NewID == "" {
			t.Fatalf("item = %+v", it)
		}
		loaded, err := persist.LoadFile(ctx, it.NewID, team.ID)
		if err != nil {
			t.Fatalf("load copy: %v", err)
		}
		url := loaded.File["assets"].([]any)[0].(map[string]any)["url"].(string)
		if strings.Contains(url, asset.ID) {
			t.Fatalf("copy still points at the source upload: %s", url)
		}
		owned, _ := up.InWorkspace(ctx, team.ID, []string{url[strings.Index(url, "/assets/")+8 : strings.Index(url, "/content")]})
		if len(owned) != 1 {
			t.Fatalf("copied upload is not the team's: %s", url)
		}
		if _, ok := loaded.File["meta"].(map[string]any)["brandKitId"]; ok {
			t.Fatal("foreign brand kit kept")
		}
	}
	// The folder structure came along, and the font.
	tf, _ := folders.ListFolders(ctx, owner.ID, team.ID)
	names := map[string]*string{}
	ids := map[string]string{}
	for _, f := range tf {
		names[f.Name] = f.ParentID
		ids[f.Name] = f.ID
	}
	if _, ok := names["Etiketten"]; !ok || names["Hormone"] == nil || *names["Hormone"] != ids["Etiketten"] {
		t.Fatalf("folders = %+v", tf)
	}
	if fl, _ := fonts.List(ctx, owner.ID, team.ID); len(fl) != 1 || fl[0].Family != "Brand Sans" {
		t.Fatalf("fonts = %+v", fl)
	}
	// A copy leaves the source as it was.
	if _, err := persist.LoadFile(ctx, top, mine.ID); err != nil {
		t.Fatalf("source gone after copy: %v", err)
	}

	// Moving the folder: copies, trashes the originals, removes the emptied
	// source folders.
	mv := Input{FolderIDs: []string{labels.ID}, TargetWorkspaceID: team.ID, Move: true}
	if _, err := svc.Prepare(ctx, owner.ID, mv); err != nil {
		t.Fatalf("prepare move: %v", err)
	}
	res, err = svc.Transfer(ctx, owner.ID, mine.ID, mv, func(int, int) {})
	if err != nil || len(res.Designs) != 1 || res.Designs[0].Error != "" || !res.Moved {
		t.Fatalf("move: %v %+v", err, res)
	}
	if _, err := persist.LoadFile(ctx, inner, mine.ID); err == nil {
		t.Fatal("moved design is still live in the source")
	}
	if _, err := persist.LoadFileIncludingTrashed(ctx, inner, mine.ID); err != nil {
		t.Fatalf("moved design is not in the trash: %v", err)
	}
	left, _ := folders.ListFolders(ctx, owner.ID, mine.ID)
	if len(left) != 0 {
		t.Fatalf("source folders left: %+v", left)
	}
}
