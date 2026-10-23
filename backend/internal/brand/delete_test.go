package brand

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/persistence"
	"hycanvas/backend/internal/sharing"
	"hycanvas/backend/internal/storage"
)

// A brand kit is where designs take their colours, fonts, logos and graphics
// from; a design made with it must not change when the kit goes away. Deleting
// a kit leaves the design file byte for byte as it was, and the uploads its
// logos and graphics point to stay.
func TestDeleteKitLeavesDesignsUnchanged_DB(t *testing.T) {
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
	owner, ws, _, err := acct.Signup(ctx, "bdel-owner+"+uuid.NewString()+"@example.com", "a-strong-password", "Owner")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	persist := persistence.NewService(tx).WithStorage(store)
	sh := sharing.NewService(tx, persist, nil, nil)
	svc := NewService(tx).WithDesignScope(sh, persist)

	// An uploaded logo and a kit holding it, a colour and a font.
	logoID := uuid.NewString()
	if _, err := tx.Exec(ctx, `INSERT INTO "assets" (id,"workspace_id",kind,"storage_key",filename,"mime_type","byte_size","uploaded_by_id","updated_at")
		VALUES ($1,$2,'IMAGE','k/logo.svg','Logo.svg','image/svg+xml',10,$3,now())`, logoID, ws.ID, owner.ID); err != nil {
		t.Fatalf("asset: %v", err)
	}
	kit, err := svc.CreateKit(ctx, ws.ID, owner.ID, "Acme", nil)
	if err != nil {
		t.Fatalf("create kit: %v", err)
	}
	green := map[string]any{"srgb": map[string]any{"r": 0, "g": 0.4, "b": 0.2, "a": 1}}
	palettes, _ := json.Marshal([]any{map[string]any{"id": "p1", "name": "Hausfarben", "colors": []any{map[string]any{"id": "s1", "role": "primary", "value": green}}}})
	fonts, _ := json.Marshal([]any{map[string]any{"id": "f1", "role": "heading", "fontFamily": "Inter"}})
	logos, _ := json.Marshal([]any{map[string]any{"id": "l1", "label": "Logo", "assetId": logoID}})
	if _, err := svc.UpdateKit(ctx, kit.ID, owner.ID, UpdateInput{Palettes: palettes, Fonts: fonts, Logos: logos}); err != nil {
		t.Fatalf("fill kit: %v", err)
	}

	// A design made with it: the kit's colour, the logo placed, the kit assigned.
	rec, err := persist.Create(ctx, ws.ID, "Plakat", nil, &owner.ID)
	if err != nil {
		t.Fatalf("create design: %v", err)
	}
	loaded, err := persist.LoadFile(ctx, rec.ID, ws.ID)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	file := loaded.File
	page := file["pages"].([]any)[0].(map[string]any)
	page["background"] = map[string]any{"type": "solid", "color": green}
	page["children"] = []any{map[string]any{
		"id": "logo", "type": "image", "name": "Logo",
		"transform": map[string]any{"x": 10, "y": 10, "scaleX": 1, "scaleY": 1, "rotation": 0},
		"size":      map[string]any{"width": 200, "height": 100},
		"source":    map[string]any{"assetId": logoID, "naturalWidth": 200, "naturalHeight": 100},
	}}
	if _, err := persist.Snapshot(ctx, rec.ID, ws.ID, file, persistence.KindCheckpoint, nil, &owner.ID); err != nil {
		t.Fatalf("save design: %v", err)
	}
	if _, err := svc.AssignDesignBrand(ctx, rec.ID, owner.ID, kit.ID); err != nil {
		t.Fatalf("assign: %v", err)
	}
	before, err := persist.LoadFile(ctx, rec.ID, ws.ID)
	if err != nil {
		t.Fatalf("load before: %v", err)
	}
	beforeJSON, _ := json.Marshal(before.File)

	if err := svc.DeleteKit(ctx, kit.ID, owner.ID); err != nil {
		t.Fatalf("delete kit: %v", err)
	}

	after, err := persist.LoadFile(ctx, rec.ID, ws.ID)
	if err != nil {
		t.Fatalf("load after: %v", err)
	}
	afterJSON, _ := json.Marshal(after.File)
	if !bytes.Equal(beforeJSON, afterJSON) {
		t.Fatalf("deleting the kit changed the design:\nbefore %s\nafter  %s", beforeJSON, afterJSON)
	}
	if *after.Record.CurrentSnapshot != *before.Record.CurrentSnapshot || after.Record.UpdatedAt != before.Record.UpdatedAt {
		t.Fatalf("deleting the kit wrote to the design: snapshot %s -> %s", *before.Record.CurrentSnapshot, *after.Record.CurrentSnapshot)
	}
	var n int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM "assets" WHERE id = $1`, logoID).Scan(&n); err != nil || n != 1 {
		t.Fatalf("the logo upload must stay (count %d, err %v)", n, err)
	}
}
