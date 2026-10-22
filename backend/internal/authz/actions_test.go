package authz

import (
	"reflect"
	"sort"
	"testing"
)

var legacyRank = map[string]int{"viewer": 1, "member": 2, "admin": 3, "owner": 4}

// The seeded roles decide every action exactly as the fixed roles did
// (F42 AC-1 at the level of the catalog).
func TestSeededRolesMatchLegacyRoles(t *testing.T) {
	plan := PlanSeed(SeedOptions{})
	for _, role := range []string{"owner", "admin", "member", "viewer"} {
		got := plan.RoleActions(role)
		for _, a := range Actions {
			want := legacyRank[role] >= legacyRank[a.LegacyRole]
			if got.Allows(a.Key, false) != want {
				t.Errorf("%s: %s allowed=%v, want %v", role, a.Key, got.Allows(a.Key, false), want)
			}
		}
	}
}

func TestSeededRolesGiveTheLegacyDesignAccess(t *testing.T) {
	plan := PlanSeed(SeedOptions{})
	for _, role := range []WorkspaceRole{"owner", "admin", "member", "viewer"} {
		got := DesignAccessFor(plan.RoleActions(string(role)))
		want := append([]Capability{}, builtinRoleCapabilities[role]...)
		sort.Slice(want, func(i, j int) bool { return want[i] < want[j] })
		if !reflect.DeepEqual(got.Capabilities, want) {
			t.Errorf("%s: capabilities %v, want %v", role, got.Capabilities, want)
		}
		if got.BaseMode != roleBaseMode[role] {
			t.Errorf("%s: base mode %s, want %s", role, got.BaseMode, roleBaseMode[role])
		}
	}
}

func TestSeededRolesKeepTheirBaseRole(t *testing.T) {
	plan := PlanSeed(SeedOptions{})
	for _, r := range plan.Roles {
		if got := BaseRole(r.Protected, plan.RoleActions(r.Key)); got != r.LegacyRole {
			t.Errorf("%s: base role %s, want %s", r.Key, got, r.LegacyRole)
		}
	}
}

func TestManagedByMembersSwitchesCarryOver(t *testing.T) {
	plan := PlanSeed(SeedOptions{ExportProfilesByMembers: true})
	m := plan.RoleActions("member")
	if !m.Has(PrintExportProfiles) || m.Has(PrintPrintPresets) || m.Has(PrintColorProfiles) {
		t.Fatalf("export profiles by members: member got %v", m.Keys())
	}
	plan = PlanSeed(SeedOptions{PrintPresetsByMembers: true})
	m = plan.RoleActions("member")
	if m.Has(PrintExportProfiles) || !m.Has(PrintPrintPresets) {
		t.Fatalf("print presets by members: member got %v", m.Keys())
	}
	// The plain seed is not changed by an earlier call.
	if PlanSeed(SeedOptions{}).RoleActions("member").Has(PrintExportProfiles) {
		t.Fatal("seed leaked between plans")
	}
}

func TestEveryActionIsInSomeSeededPermissionAndOwnerHasAll(t *testing.T) {
	in := ActionSet{}
	for _, p := range SeedPermissions {
		for a := range p.Actions {
			if _, ok := LookupAction(a); !ok {
				t.Errorf("seed %s names unknown action %s", p.Key, a)
			}
			in[a] = ScopeAll
		}
	}
	for _, a := range Actions {
		if !in.Has(a.Key) {
			t.Errorf("action %s is in no seeded permission", a.Key)
		}
		if !Everything().Allows(a.Key, false) {
			t.Errorf("owner lacks %s", a.Key)
		}
	}
}

func TestUnionScopesAndUnknownKeys(t *testing.T) {
	a := ActionSet{DesignTrash: ScopeOwn, "future.action": ScopeAll, DesignCreate: ScopeOwn}
	b := ActionSet{DesignTrash: ScopeAll}
	u := Union(a, b)
	if u[DesignTrash] != ScopeAll {
		t.Errorf("all should beat own, got %s", u[DesignTrash])
	}
	if u.Has("future.action") {
		t.Error("unknown actions must be ignored")
	}
	if u[DesignCreate] != ScopeAll {
		t.Errorf("unscoped actions read as all, got %s", u[DesignCreate])
	}
	own := Union(a)
	if !own.Allows(DesignTrash, true) || own.Allows(DesignTrash, false) {
		t.Error("own scope: only one's own")
	}
}

func TestCoversIsTheNoEscalationRule(t *testing.T) {
	mine := ActionSet{DesignTrash: ScopeOwn, FolderCreate: ScopeAll}
	if !mine.Covers(ActionSet{DesignTrash: ScopeOwn}) {
		t.Error("own covers own")
	}
	if mine.Covers(ActionSet{DesignTrash: ScopeAll}) {
		t.Error("own must not cover all")
	}
	if mine.Covers(ActionSet{RolesManage: ScopeAll}) {
		t.Error("an action not held must not be covered")
	}
	if !Everything().Covers(PlanSeed(SeedOptions{}).RoleActions("admin")) {
		t.Error("owner covers admin")
	}
}
