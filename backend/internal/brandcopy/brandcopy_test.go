package brandcopy

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/brand"
	"hycanvas/backend/internal/uploads"
)

// fakeAssets: the source's uploads are known ids; a copy gets a fresh id.
type fakeAssets struct {
	owned  map[string]string // asset -> workspace
	copied []string
}

func (f *fakeAssets) InWorkspace(_ context.Context, ws string, ids []string) (map[string]bool, error) {
	out := map[string]bool{}
	for _, id := range ids {
		if f.owned[id] == ws {
			out[id] = true
		}
	}
	return out, nil
}

func (f *fakeAssets) CopyToWorkspace(_ context.Context, _, _, id, dst string) (uploads.UploadedAsset, error) {
	n := uuid.NewString()
	f.owned[n] = dst
	f.copied = append(f.copied, id)
	return uploads.UploadedAsset{ID: n, WorkspaceID: dst}, nil
}

type fakeFonts struct{ families []string }

func (f *fakeFonts) CopyFamilies(_ context.Context, _, _, _ string, fams []string) ([]string, error) {
	f.families = append(f.families, fams...)
	return nil, nil
}

func TestBrandCopy_DB(t *testing.T) {
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
	brands := brand.NewService(tx)
	me, src, _, err := acct.Signup(ctx, "bc-me+"+uuid.NewString()+"@example.com", "a-strong-password", "Me")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	dst, err := acct.CreateWorkspace(ctx, me.ID, "Ziel", "team")
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	other, foreign, _, err := acct.Signup(ctx, "bc-other+"+uuid.NewString()+"@example.com", "a-strong-password", "Other")
	if err != nil {
		t.Fatalf("signup other: %v", err)
	}

	logo, graphic, fontFile := uuid.NewString(), uuid.NewString(), uuid.NewString()
	assets := &fakeAssets{owned: map[string]string{logo: src.ID, graphic: src.ID, fontFile: src.ID}}
	fonts := &fakeFonts{}
	svc := NewService(acct, brands, assets, fonts)

	def := true
	house, err := brands.CreateKit(ctx, src.ID, me.ID, "Hausmarke", &def)
	if err != nil {
		t.Fatalf("create kit: %v", err)
	}
	raw := func(s string) json.RawMessage { return json.RawMessage(s) }
	if _, err := brands.UpdateKit(ctx, house.ID, me.ID, brand.UpdateInput{
		Palettes:    raw(`[{"id":"p1","name":"Main brand","colors":[{"id":"s1","role":"primary","value":{"srgb":{"r":0.12,"g":0.3,"b":0.2,"a":1}}}]}]`),
		Fonts:       raw(`[{"id":"f1","role":"heading","fontFamily":"Sample Serif","fontAssetId":"` + fontFile + `"}]`),
		Logos:       raw(`[{"id":"l1","label":"Logo","assetId":"` + logo + `"}]`),
		Collections: raw(`[{"id":"c1","kind":"graphics","name":"Silhouetten","assetIds":["` + graphic + `"]}]`),
	}); err != nil {
		t.Fatalf("fill kit: %v", err)
	}
	notDef := false
	if _, err := brands.CreateKit(ctx, src.ID, me.ID, "Zweitmarke", &notDef); err != nil {
		t.Fatalf("second kit: %v", err)
	}

	// All kits into the new workspace: the standard kit first and standard
	// there too, the uploads copied and the references rewritten.
	in := Input{SourceWorkspaceID: src.ID, All: true, TargetWorkspaceIDs: []string{dst.ID}}
	kits, err := svc.Prepare(ctx, me.ID, in)
	if err != nil || len(kits) != 2 || kits[0].Name != "Hausmarke" {
		t.Fatalf("prepare: %v %d", err, len(kits))
	}
	res, err := svc.Copy(ctx, me.ID, in, kits, nil)
	if err != nil || len(res.Kits) != 2 || res.Assets != 3 {
		t.Fatalf("copy: %v %+v", err, res)
	}
	for _, it := range res.Kits {
		if it.Error != "" || it.NewID == "" {
			t.Fatalf("copy item: %+v", it)
		}
	}
	got, _ := brands.ListKits(ctx, dst.ID, me.ID)
	byName := map[string]brand.BrandKit{}
	for _, k := range got {
		byName[k.Name] = k
	}
	h := byName["Hausmarke"]
	if !h.IsDefault || byName["Zweitmarke"].IsDefault {
		t.Fatalf("standard kit: %+v", got)
	}
	if strings.Contains(string(h.Logos), logo) || strings.Contains(string(h.Collections), graphic) || strings.Contains(string(h.Fonts), fontFile) {
		t.Fatalf("references not rewritten: %s %s %s", h.Logos, h.Collections, h.Fonts)
	}
	if !strings.Contains(string(h.Palettes), "Main brand") || !strings.Contains(string(h.Fonts), "Sample Serif") {
		t.Fatalf("content not copied: %s %s", h.Palettes, h.Fonts)
	}
	if len(fonts.families) == 0 || fonts.families[0] != "Sample Serif" {
		t.Fatalf("font families: %v", fonts.families)
	}
	// The source is unchanged.
	srcKits, _ := brands.ListKits(ctx, src.ID, me.ID)
	for _, k := range srcKits {
		if k.Name == "Hausmarke" && !strings.Contains(string(k.Logos), logo) {
			t.Fatalf("source changed: %s", k.Logos)
		}
	}

	// Again, one kit: the name is taken, so the copy gets a free one.
	one := Input{SourceWorkspaceID: src.ID, KitIDs: []string{house.ID}, TargetWorkspaceIDs: []string{dst.ID}}
	kits, _ = svc.Prepare(ctx, me.ID, one)
	res, _ = svc.Copy(ctx, me.ID, one, kits, nil)
	if len(res.Kits) != 1 || res.Kits[0].Name != "Hausmarke (2)" || res.Kits[0].Replaced {
		t.Fatalf("rename: %+v", res.Kits)
	}
	// With replace: the existing kit takes the content, no new kit.
	one.Replace = true
	kits, _ = svc.Prepare(ctx, me.ID, one)
	res, _ = svc.Copy(ctx, me.ID, one, kits, nil)
	if len(res.Kits) != 1 || !res.Kits[0].Replaced || res.Kits[0].NewID != h.ID {
		t.Fatalf("replace: %+v (want %s)", res.Kits, h.ID)
	}
	if after, _ := brands.ListKits(ctx, dst.ID, me.ID); len(after) != 3 {
		t.Fatalf("kits after replace: %d", len(after))
	}

	// Refused: a workspace the user is not in, the source as target, a kit
	// of another workspace, and someone without the right in the source.
	if _, err := svc.Prepare(ctx, me.ID, Input{SourceWorkspaceID: src.ID, All: true, TargetWorkspaceIDs: []string{foreign.ID}}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("foreign target: %v", err)
	}
	if _, err := svc.Prepare(ctx, me.ID, Input{SourceWorkspaceID: src.ID, All: true, TargetWorkspaceIDs: []string{src.ID}}); !errors.Is(err, ErrBadRequest) {
		t.Fatalf("source as target: %v", err)
	}
	if _, err := svc.Prepare(ctx, me.ID, Input{SourceWorkspaceID: src.ID, KitIDs: []string{uuid.NewString()}, TargetWorkspaceIDs: []string{dst.ID}}); !errors.Is(err, ErrBadRequest) {
		t.Fatalf("unknown kit: %v", err)
	}
	if _, err := svc.Prepare(ctx, other.ID, Input{SourceWorkspaceID: src.ID, All: true, TargetWorkspaceIDs: []string{foreign.ID}}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider: %v", err)
	}
}
