package brand

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
)

func stripSchema(dsn string) string {
	for _, sep := range []string{"?schema=", "&schema="} {
		if i := strings.Index(dsn, sep); i >= 0 {
			return dsn[:i]
		}
	}
	return dsn
}

func addMember(ctx context.Context, t *testing.T, tx pgx.Tx, workspaceID, userID, role string) {
	t.Helper()
	if _, err := tx.Exec(ctx,
		`INSERT INTO "workspace_members" (id,"workspace_id","user_id",role,status,"joined_at","updated_at")
		 VALUES ($1,$2,$3,$4,'ACTIVE',now(),now())`,
		uuid.NewString(), workspaceID, userID, role); err != nil {
		t.Fatalf("addMember(%s): %v", role, err)
	}
}

func TestBrand_DB(t *testing.T) {
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
	owner, ws, _, err := acct.Signup(ctx, "brand-owner+"+uuid.NewString()+"@example.com", "a-strong-password", "Owner")
	if err != nil {
		t.Fatalf("signup owner: %v", err)
	}
	// A plain member lacks manage-brand.
	member, _, _, err := acct.Signup(ctx, "brand-member+"+uuid.NewString()+"@example.com", "a-strong-password", "Member")
	if err != nil {
		t.Fatalf("signup member: %v", err)
	}
	addMember(ctx, t, tx, ws.ID, member.ID, "MEMBER")
	outsider, _, _, err := acct.Signup(ctx, "brand-out+"+uuid.NewString()+"@example.com", "a-strong-password", "Outsider")
	if err != nil {
		t.Fatalf("signup outsider: %v", err)
	}

	svc := NewService(tx)

	// A member cannot create a kit (no manage-brand).
	if _, err := svc.CreateKit(ctx, ws.ID, member.ID, "Nope", nil); err != ErrForbidden {
		t.Fatalf("member create should be Forbidden, got %v", err)
	}
	// An outsider is not even a member.
	if _, err := svc.ListKits(ctx, ws.ID, outsider.ID); err != ErrForbidden {
		t.Fatalf("outsider list should be Forbidden, got %v", err)
	}

	// Owner creates the first kit -> becomes default at v1.
	kit, err := svc.CreateKit(ctx, ws.ID, owner.ID, "Primary", nil)
	if err != nil {
		t.Fatalf("CreateKit: %v", err)
	}
	if !kit.IsDefault || kit.Version != 1 || kit.Controls.LintPolicy != "warn" {
		t.Fatalf("first kit defaults wrong: %+v", kit)
	}
	if string(kit.Palettes) != "[]" || string(kit.Voice) != "null" {
		t.Fatalf("content defaults wrong: palettes=%s voice=%s", kit.Palettes, kit.Voice)
	}

	// Update contents + lock controls -> version advances to 2.
	palettes := json.RawMessage(`[{"id":"p1","name":"Brand","colors":[{"hex":"#ff0000"}]}]`)
	controls := json.RawMessage(`{"lockColors":true}`)
	updated, err := svc.UpdateKit(ctx, kit.ID, owner.ID, UpdateInput{Palettes: palettes, ControlsRaw: controls})
	if err != nil {
		t.Fatalf("UpdateKit: %v", err)
	}
	if updated.Version != 2 || !updated.Controls.LockColors || updated.Controls.LintPolicy != "warn" {
		t.Fatalf("update wrong: %+v", updated.Controls)
	}
	if !json.Valid(updated.Palettes) || string(updated.Palettes) == "[]" {
		t.Fatalf("palettes not stored: %s", updated.Palettes)
	}

	// A member still cannot update.
	if _, err := svc.UpdateKit(ctx, kit.ID, member.ID, UpdateInput{Name: ptr("Hijack")}); err != ErrForbidden {
		t.Fatalf("member update should be Forbidden, got %v", err)
	}
	// But a member CAN read (membership-gated).
	if _, err := svc.GetKit(ctx, kit.ID, member.ID); err != nil {
		t.Fatalf("member read should succeed: %v", err)
	}

	// Versions: v1 and v2 recorded, newest first.
	versions, err := svc.ListVersions(ctx, kit.ID, owner.ID)
	if err != nil || len(versions) != 2 || versions[0].Version != 2 || versions[1].Version != 1 {
		t.Fatalf("versions wrong: %+v err=%v", versions, err)
	}

	// Restore to v1 -> contents revert (palettes empty again), version advances to 3.
	restored, err := svc.RestoreVersion(ctx, kit.ID, owner.ID, 1)
	if err != nil {
		t.Fatalf("RestoreVersion: %v", err)
	}
	if restored.Version != 3 || restored.Controls.LockColors {
		t.Fatalf("restore wrong: version=%d lockColors=%v", restored.Version, restored.Controls.LockColors)
	}
	if string(restored.Palettes) != "[]" {
		t.Fatalf("restore should revert palettes, got %s", restored.Palettes)
	}

	// Second kit, made default -> first kit loses default.
	kit2, err := svc.CreateKit(ctx, ws.ID, owner.ID, "Secondary", ptrBool(true))
	if err != nil {
		t.Fatalf("CreateKit 2: %v", err)
	}
	if !kit2.IsDefault {
		t.Fatalf("kit2 should be default")
	}
	again, _ := svc.GetKit(ctx, kit.ID, owner.ID)
	if again.IsDefault {
		t.Fatalf("first kit should no longer be default")
	}

	// Set first kit default again -> kit2 loses it.
	if _, err := svc.SetDefault(ctx, kit.ID, owner.ID); err != nil {
		t.Fatalf("SetDefault: %v", err)
	}
	k2, _ := svc.GetKit(ctx, kit2.ID, owner.ID)
	if k2.IsDefault {
		t.Fatalf("kit2 should lose default after SetDefault(kit1)")
	}

	// Delete kit2.
	if err := svc.DeleteKit(ctx, kit2.ID, owner.ID); err != nil {
		t.Fatalf("DeleteKit: %v", err)
	}
	if _, err := svc.GetKit(ctx, kit2.ID, owner.ID); err != ErrNotFound {
		t.Fatalf("deleted kit should be NotFound, got %v", err)
	}

	// Workspace list now has one kit (the default Primary).
	kits, err := svc.ListKits(ctx, ws.ID, owner.ID)
	if err != nil || len(kits) != 1 || !kits[0].IsDefault {
		t.Fatalf("final list wrong: %+v err=%v", kits, err)
	}
}

func ptr(s string) *string { return &s }
func ptrBool(b bool) *bool { return &b }

// fakeStarterAssets stands in for the uploads service: it records what the
// seeding stores and hands back one id per file.
type fakeStarterAssets struct {
	stored []string
}

func (f *fakeStarterAssets) StoreStarterAsset(_ context.Context, workspaceID, ownerID, filename string, data []byte) (string, error) {
	if workspaceID == "" || ownerID == "" || len(data) == 0 {
		return "", errors.New("bad store call")
	}
	f.stored = append(f.stored, filename)
	return "asset-" + strings.TrimSuffix(filename, ".png"), nil
}

// brand.library (F50) maintains a kit's collections and nothing else; a role
// with brand.kits changes everything.
func TestBrandLibraryRight_DB(t *testing.T) {
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
	owner, ws, _, err := acct.Signup(ctx, "blib-owner+"+uuid.NewString()+"@example.com", "a-strong-password", "Owner")
	if err != nil {
		t.Fatalf("signup owner: %v", err)
	}
	member, _, _, err := acct.Signup(ctx, "blib-member+"+uuid.NewString()+"@example.com", "a-strong-password", "Member")
	if err != nil {
		t.Fatalf("signup member: %v", err)
	}
	addMember(ctx, t, tx, ws.ID, member.ID, "MEMBER")
	if err := acct.EnsureRoles(ctx, tx, ws.ID); err != nil {
		t.Fatalf("roles: %v", err)
	}
	svc := NewService(tx)
	kit, err := svc.CreateKit(ctx, ws.ID, owner.ID, "Acme", nil)
	if err != nil {
		t.Fatalf("create kit: %v", err)
	}
	collections := json.RawMessage(`[{"id":"c1","kind":"graphics","name":"Silhouetten","assetIds":[]}]`)

	// A plain member: neither.
	if _, err := svc.UpdateKit(ctx, kit.ID, member.ID, UpdateInput{Collections: collections}); err != ErrForbidden {
		t.Fatalf("member without brand.library: want Forbidden, got %v", err)
	}

	// Give the member role the seeded brand-library permission.
	if _, err := tx.Exec(ctx, `INSERT INTO "workspace_role_permissions" ("role_id","permission_id")
		SELECT r.id, p.id FROM "workspace_roles" r, "workspace_permissions" p
		WHERE r."workspace_id"=$1 AND r."seed_key"='member' AND p."workspace_id"=$1 AND p."seed_key"='brand-library'`, ws.ID); err != nil {
		t.Fatalf("grant: %v", err)
	}
	updated, err := svc.UpdateKit(ctx, kit.ID, member.ID, UpdateInput{Collections: collections})
	if err != nil {
		t.Fatalf("collections with brand.library: %v", err)
	}
	if string(updated.Collections) == "[]" {
		t.Fatal("collections not stored")
	}
	// Anything beyond the collections still needs brand.kits.
	palettes := json.RawMessage(`[{"id":"p1","name":"x","colors":[]}]`)
	if _, err := svc.UpdateKit(ctx, kit.ID, member.ID, UpdateInput{Collections: collections, Palettes: palettes}); err != ErrForbidden {
		t.Fatalf("palettes with brand.library only: want Forbidden, got %v", err)
	}
	if _, err := svc.UpdateKit(ctx, kit.ID, member.ID, UpdateInput{Name: ptr("Hijack")}); err != ErrForbidden {
		t.Fatalf("rename with brand.library only: want Forbidden, got %v", err)
	}
	if _, err := svc.UpdateKit(ctx, kit.ID, member.ID, UpdateInput{LogoVersions: json.RawMessage(`[]`)}); err != ErrForbidden {
		t.Fatalf("logo versions with brand.library only: want Forbidden, got %v", err)
	}
	if _, err := svc.CreateKit(ctx, ws.ID, member.ID, "Second", nil); err != ErrForbidden {
		t.Fatalf("create with brand.library only: want Forbidden, got %v", err)
	}
	if err := svc.DeleteKit(ctx, kit.ID, member.ID); err != ErrForbidden {
		t.Fatalf("delete with brand.library only: want Forbidden, got %v", err)
	}
	// brand.kits covers the collections too.
	if _, err := svc.UpdateKit(ctx, kit.ID, owner.ID, UpdateInput{Collections: collections, Palettes: palettes}); err != nil {
		t.Fatalf("owner: %v", err)
	}
}

// Logo versions (F50): a kit names the versions its logos come in; they are
// stored, kept in the version history, and a restore to a version from before
// them clears them again. Every version of a logo counts as the logo.
func TestBrandLogoVersions_DB(t *testing.T) {
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
	owner, ws, _, err := acct.Signup(ctx, "blv-owner+"+uuid.NewString()+"@example.com", "a-strong-password", "Owner")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	svc := NewService(tx)
	kit, err := svc.CreateKit(ctx, ws.ID, owner.ID, "Acme", nil)
	if err != nil {
		t.Fatalf("create kit: %v", err)
	}
	if string(kit.LogoVersions) != "[]" {
		t.Fatalf("a new kit has no logo versions, got %s", kit.LogoVersions)
	}
	versions := json.RawMessage(`[{"id":"colour","name":"Farbe","ground":"light"},{"id":"black","name":"Schwarz","ground":"light"},{"id":"white","name":"Weiß","ground":"dark"}]`)
	logos := json.RawMessage(`[{"id":"l1","label":"Wortmarke","assetId":"a-colour","variants":{"dark":"a-white"},"versions":{"colour":"a-colour","black":"a-black","white":"a-white"}}]`)
	updated, err := svc.UpdateKit(ctx, kit.ID, owner.ID, UpdateInput{LogoVersions: versions, Logos: logos})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	var got []map[string]any
	if err := json.Unmarshal(updated.LogoVersions, &got); err != nil || len(got) != 3 || got[2]["ground"] != "dark" {
		t.Fatalf("logo versions not stored: %s", updated.LogoVersions)
	}
	var stored []struct {
		Versions map[string]string `json:"versions"`
	}
	if err := json.Unmarshal(updated.Logos, &stored); err != nil || len(stored) != 1 || stored[0].Versions["black"] != "a-black" {
		t.Fatalf("a logo's versions are kept: %s", updated.Logos)
	}
	// The brand check knows every version as the logo.
	row, err := svc.requireKit(ctx, kit.ID)
	if err != nil {
		t.Fatalf("kit row: %v", err)
	}
	lk := parseLintKit(&row)
	for _, id := range []string{"a-colour", "a-black", "a-white"} {
		if !lk.logoIDs[id] {
			t.Errorf("%s should count as the logo", id)
		}
	}
	// Back to version 1, from before the versions: they are cleared.
	restored, err := svc.RestoreVersion(ctx, kit.ID, owner.ID, 1)
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if string(restored.LogoVersions) != "[]" {
		t.Fatalf("restore to a version without logo versions clears them, got %s", restored.LogoVersions)
	}
}
