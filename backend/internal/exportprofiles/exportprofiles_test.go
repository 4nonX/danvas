package exportprofiles

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

// fixture: a workspace with an owner and a plain member, in a transaction
// that is rolled back.
type fixture struct {
	ctx           context.Context
	svc           *Service
	tx            pgx.Tx
	ws            string
	owner, member string
	stranger      string
}

func setup(t *testing.T) fixture {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set; skipping DB integration test")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, stripSchema(dsn))
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { conn.Close(ctx) })
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	t.Cleanup(func() { _ = tx.Rollback(ctx) })
	acct := accounts.NewService(tx, "test-jwt-secret")
	owner, ws, _, err := acct.Signup(ctx, "ep+"+uuid.NewString()+"@example.com", "a-strong-password", "Owner")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	member, _, _, err := acct.Signup(ctx, "ep+"+uuid.NewString()+"@example.com", "a-strong-password", "Member")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	stranger, _, _, err := acct.Signup(ctx, "ep+"+uuid.NewString()+"@example.com", "a-strong-password", "Stranger")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO "workspace_members" (id,"workspace_id","user_id",role,status,"joined_at","updated_at") VALUES ($1,$2,$3,'MEMBER','ACTIVE',now(),now())`,
		uuid.NewString(), ws.ID, member.ID); err != nil {
		t.Fatalf("add member: %v", err)
	}
	return fixture{ctx: ctx, svc: NewService(tx, acct), tx: tx, ws: ws.ID, owner: owner.ID, member: member.ID, stranger: stranger.ID}
}

var settings = json.RawMessage(`{"v":1,"format":"pdf","pdfMode":"vector"}`)

func TestWorkspaceProfilesFollowTheManagedBySetting(t *testing.T) {
	f := setup(t)
	// Default: only owners and admins manage the workspace's profiles.
	if _, err := f.svc.Create(f.ctx, f.member, f.ws, Input{Scope: ScopeWorkspace, Name: "Druckerei", Settings: settings}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member created a workspace profile: %v", err)
	}
	p, err := f.svc.Create(f.ctx, f.owner, f.ws, Input{Scope: ScopeWorkspace, Name: "Druckerei", Description: "1,5 mm", Settings: settings, IsDefault: true})
	if err != nil {
		t.Fatalf("owner create: %v", err)
	}
	if p.Scope != ScopeWorkspace || !p.IsDefault || p.UpdatedByName != "Owner" {
		t.Fatalf("unexpected profile %+v", p)
	}
	// Every member sees and uses it, but may not change it.
	v, err := f.svc.List(f.ctx, f.member, f.ws, KindExport)
	if err != nil || len(v.Profiles) != 1 || v.CanManageWorkspace || v.CanConfigure || v.ManagedBy != ManagedByAdmins {
		t.Fatalf("member view %+v %v", v, err)
	}
	if _, err := f.svc.Update(f.ctx, f.member, p.ID, Patch{Name: ptr("Mine")}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member renamed a workspace profile: %v", err)
	}
	// Members may not change the setting itself; owners may.
	if err := f.svc.SetManagedBy(f.ctx, f.member, f.ws, KindExport, ManagedByMembers); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member changed the setting: %v", err)
	}
	if err := f.svc.SetManagedBy(f.ctx, f.owner, f.ws, KindExport, ManagedByMembers); err != nil {
		t.Fatalf("owner set: %v", err)
	}
	if v, _ := f.svc.List(f.ctx, f.member, f.ws, KindExport); !v.CanManageWorkspace || v.ManagedBy != ManagedByMembers {
		t.Fatalf("member cannot manage after the switch: %+v", v)
	}
	if _, err := f.svc.Update(f.ctx, f.member, p.ID, Patch{Description: ptr("2 mm")}); err != nil {
		t.Fatalf("member update after switch: %v", err)
	}
	// Someone outside the workspace sees nothing.
	if _, err := f.svc.List(f.ctx, f.stranger, f.ws, KindExport); !errors.Is(err, ErrForbidden) {
		t.Fatalf("stranger listed: %v", err)
	}
	if err := f.svc.Delete(f.ctx, f.stranger, p.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stranger delete: %v", err)
	}
	if err := f.svc.Delete(f.ctx, f.member, p.ID); err != nil {
		t.Fatalf("member delete: %v", err)
	}
}

func TestPersonalProfilesArePrivateAndNamedUniquely(t *testing.T) {
	f := setup(t)
	mine, err := f.svc.Create(f.ctx, f.member, f.ws, Input{Scope: ScopePersonal, Name: "Meine PNG", Settings: settings})
	if err != nil {
		t.Fatalf("personal create: %v", err)
	}
	if mine.Scope != ScopePersonal || mine.WorkspaceID != nil {
		t.Fatalf("not personal: %+v", mine)
	}
	// Names are unique per owner, ignoring case and surrounding spaces.
	if err := f.expectConflict(t, func() error {
		_, err := f.svc.Create(f.ctx, f.member, f.ws, Input{Scope: ScopePersonal, Name: "  meine png ", Settings: settings})
		return err
	}); !errors.Is(err, ErrNameTaken) {
		t.Fatalf("duplicate name: %v", err)
	}
	// ...but another owner may use the same name.
	if _, err := f.svc.Create(f.ctx, f.owner, f.ws, Input{Scope: ScopePersonal, Name: "Meine PNG", Settings: settings}); err != nil {
		t.Fatalf("same name, other owner: %v", err)
	}
	// Nobody else sees, changes or deletes it.
	if v, _ := f.svc.List(f.ctx, f.owner, f.ws, KindExport); len(v.Profiles) != 1 {
		t.Fatalf("owner sees others' personal profiles: %+v", v.Profiles)
	}
	if _, err := f.svc.Update(f.ctx, f.owner, mine.ID, Patch{Name: ptr("x")}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("owner changed a member's personal profile: %v", err)
	}
	// Rename into a taken name fails cleanly.
	other, _ := f.svc.Create(f.ctx, f.member, f.ws, Input{Scope: ScopePersonal, Name: "Zweites", Settings: settings})
	if err := f.expectConflict(t, func() error {
		_, err := f.svc.Update(f.ctx, f.member, other.ID, Patch{Name: ptr("MEINE PNG")})
		return err
	}); !errors.Is(err, ErrNameTaken) {
		t.Fatalf("rename into taken name: %v", err)
	}
}

func TestPersonalProfilesWithoutAWorkspace(t *testing.T) {
	f := setup(t)
	p, err := f.svc.Create(f.ctx, f.stranger, "", Input{Scope: ScopePersonal, Name: "Überall", Settings: settings})
	if err != nil {
		t.Fatalf("create without workspace: %v", err)
	}
	if list, _ := f.svc.ListPersonal(f.ctx, f.stranger, KindExport); len(list) != 1 || list[0].ID != p.ID {
		t.Fatalf("personal list %+v", list)
	}
	// A workspace profile always needs its workspace.
	if _, err := f.svc.Create(f.ctx, f.stranger, "", Input{Scope: ScopeWorkspace, Name: "x", Settings: settings}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("workspace profile without workspace: %v", err)
	}
	if list, _ := f.svc.ListPersonal(f.ctx, f.owner, KindExport); len(list) != 0 {
		t.Fatalf("someone else's personal profiles listed: %+v", list)
	}
}

func TestOneDefaultPerOwner(t *testing.T) {
	f := setup(t)
	a, _ := f.svc.Create(f.ctx, f.member, f.ws, Input{Scope: ScopePersonal, Name: "A", Settings: settings, IsDefault: true})
	b, err := f.svc.Create(f.ctx, f.member, f.ws, Input{Scope: ScopePersonal, Name: "B", Settings: settings, IsDefault: true})
	if err != nil {
		t.Fatalf("second default: %v", err)
	}
	v, _ := f.svc.List(f.ctx, f.member, f.ws, KindExport)
	defaults := 0
	for _, p := range v.Profiles {
		if p.IsDefault {
			defaults++
			if p.ID != b.ID {
				t.Fatalf("wrong default %s", p.Name)
			}
		}
	}
	if defaults != 1 {
		t.Fatalf("%d defaults", defaults)
	}
	if _, err := f.svc.Update(f.ctx, f.member, a.ID, Patch{IsDefault: ptrB(true)}); err != nil {
		t.Fatalf("move default: %v", err)
	}
	if p, _ := f.svc.Update(f.ctx, f.member, a.ID, Patch{IsDefault: ptrB(false)}); p.IsDefault {
		t.Fatal("default not cleared")
	}
}

func TestSettingsAreValidatedButKeptAsSent(t *testing.T) {
	f := setup(t)
	for _, bad := range []string{``, `[]`, `{"format":"png"}`, `{"v":0}`, `"x"`, `{"v":1,` + strings.Repeat(" ", maxSettings) + `}`} {
		if _, err := f.svc.Create(f.ctx, f.owner, f.ws, Input{Scope: ScopePersonal, Name: "x" + uuid.NewString(), Settings: json.RawMessage(bad)}); !errors.Is(err, ErrInvalid) {
			t.Fatalf("%q accepted: %v", bad, err)
		}
	}
	// Options this server does not know (a newer client's) survive.
	p, err := f.svc.Create(f.ctx, f.owner, f.ws, Input{Scope: ScopePersonal, Name: "Neu", Settings: json.RawMessage(`{"v":2,"futureOption":{"a":1}}`)})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	var back map[string]any
	if err := json.Unmarshal(p.Settings, &back); err != nil || back["futureOption"] == nil {
		t.Fatalf("unknown option dropped: %s", p.Settings)
	}
	if _, err := f.svc.Create(f.ctx, f.owner, f.ws, Input{Scope: "team", Name: "x", Settings: settings}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("bad scope: %v", err)
	}
	if _, err := f.svc.Create(f.ctx, f.owner, f.ws, Input{Scope: ScopePersonal, Name: "   ", Settings: settings}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("blank name: %v", err)
	}
}

// expectConflict runs a call expected to hit a unique index inside a
// savepoint: the violation aborts the surrounding test transaction otherwise.
func (f fixture) expectConflict(t *testing.T, fn func() error) error {
	t.Helper()
	if _, err := f.tx.Exec(f.ctx, `SAVEPOINT conflict`); err != nil {
		t.Fatalf("savepoint: %v", err)
	}
	err := fn()
	if _, rerr := f.tx.Exec(f.ctx, `ROLLBACK TO SAVEPOINT conflict`); rerr != nil {
		t.Fatalf("rollback to savepoint: %v", rerr)
	}
	return err
}

func TestPrintPresetsAreKeptApartFromExportProfiles(t *testing.T) {
	f := setup(t)
	exp, err := f.svc.Create(f.ctx, f.owner, f.ws, Input{Scope: ScopeWorkspace, Name: "Etikett", Settings: settings, IsDefault: true})
	if err != nil || exp.Kind != KindExport {
		t.Fatalf("export profile %+v %v", exp, err)
	}
	// The same name and a default of its own in the other kind.
	pr, err := f.svc.Create(f.ctx, f.owner, f.ws, Input{Kind: KindPrint, Scope: ScopeWorkspace, Name: "Etikett", Settings: settings, IsDefault: true})
	if err != nil || pr.Kind != KindPrint || !pr.IsDefault {
		t.Fatalf("print preset %+v %v", pr, err)
	}
	if v, _ := f.svc.List(f.ctx, f.member, f.ws, KindPrint); len(v.Profiles) != 1 || v.Profiles[0].ID != pr.ID {
		t.Fatalf("print list %+v", v.Profiles)
	}
	if v, _ := f.svc.List(f.ctx, f.member, f.ws, KindExport); len(v.Profiles) != 1 || !v.Profiles[0].IsDefault {
		t.Fatalf("export default lost to the print preset: %+v", v.Profiles)
	}
	// Who manages them is set per kind.
	if err := f.svc.SetManagedBy(f.ctx, f.owner, f.ws, KindPrint, ManagedByMembers); err != nil {
		t.Fatalf("set print managed by: %v", err)
	}
	if v, _ := f.svc.List(f.ctx, f.member, f.ws, KindPrint); !v.CanManageWorkspace {
		t.Fatal("member cannot manage print presets after the switch")
	}
	if v, _ := f.svc.List(f.ctx, f.member, f.ws, KindExport); v.CanManageWorkspace {
		t.Fatal("the print setting changed who manages export profiles")
	}
	if _, err := f.svc.Create(f.ctx, f.owner, f.ws, Input{Kind: "poster", Scope: ScopePersonal, Name: "x", Settings: settings}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unknown kind: %v", err)
	}
}

func ptr(s string) *string { return &s }
func ptrB(b bool) *bool    { return &b }
