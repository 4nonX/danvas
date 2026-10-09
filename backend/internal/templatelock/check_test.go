package templatelock

import (
	"encoding/json"
	"testing"
)

func file(t *testing.T, s string) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		t.Fatal(err)
	}
	return m
}

const base = `{"schemaVersion":27,"pages":[{"id":"p1","children":[
 {"id":"logo","type":"image","transform":{"x":10,"y":10,"scaleX":1,"scaleY":1,"rotation":0},"size":{"width":100,"height":50},"src":"a.png",
  "templateLock":{"level":"locked","workspaceId":"ws1"}},
 {"id":"title","type":"text","transform":{"x":0,"y":100,"scaleX":1,"scaleY":1,"rotation":0},"size":{"width":300,"height":40},"content":[{"runs":[{"text":"Hello"}]}],
  "templateLock":{"level":"content","workspaceId":"ws1"}},
 {"id":"box","type":"group","transform":{"x":0,"y":200,"scaleX":1,"scaleY":1,"rotation":0},"size":{"width":50,"height":50},
  "templateLock":{"level":"content","workspaceId":"ws1"},
  "children":[{"id":"inner","type":"text","transform":{"x":0,"y":0,"scaleX":1,"scaleY":1,"rotation":0},"size":{"width":50,"height":20},"content":[]}]},
 {"id":"free","type":"shape","transform":{"x":0,"y":0,"scaleX":1,"scaleY":1,"rotation":0},"size":{"width":5,"height":5}}
]}]}`

func nobody(string) bool { return false }

// pol judges saves to a design of workspace "dws"; the base file's locks
// belong to another workspace, "ws1", like a design made from its template.
func pol(may func(string) bool) Policy { return Policy{DesignWorkspace: "dws", MayLift: may} }

func edit(t *testing.T, f func(nodes []any)) map[string]any {
	t.Helper()
	m := file(t, base)
	f(m["pages"].([]any)[0].(map[string]any)["children"].([]any))
	return m
}

func node(nodes []any, i int) map[string]any { return nodes[i].(map[string]any) }

func reasons(v []Violation) map[string]string {
	out := map[string]string{}
	for _, x := range v {
		out[x.NodeID] = x.Reason
	}
	return out
}

func TestUnchangedAndFreeEditsPass(t *testing.T) {
	next := edit(t, func(n []any) {
		node(n, 3)["transform"].(map[string]any)["x"] = 99.0 // unprotected
		node(n, 0)["name"] = "Logo"                          // label only
	})
	if v := Check(file(t, base), next, pol(nobody)); len(v) != 0 {
		t.Fatalf("want no violations, got %+v", v)
	}
}

func TestContentLevelAllowsTextAndGrowth(t *testing.T) {
	next := edit(t, func(n []any) {
		node(n, 1)["content"] = []any{map[string]any{"runs": []any{map[string]any{"text": "Neuer Titel"}}}}
		node(n, 1)["size"].(map[string]any)["height"] = 80.0
		node(node(n, 2)["children"].([]any), 0)["content"] = []any{"x"} // inherited content lock
	})
	if v := Check(file(t, base), next, pol(nobody)); len(v) != 0 {
		t.Fatalf("want no violations, got %+v", v)
	}
}

func TestProtectedChangesAreRefused(t *testing.T) {
	next := edit(t, func(n []any) {
		node(n, 0)["src"] = "b.png"                           // locked: content change
		node(n, 1)["transform"].(map[string]any)["y"] = 120.0 // content: moved
		delete(node(n, 2), "templateLock")                    // lock stripped
		node(node(n, 2)["children"].([]any), 0)["transform"].(map[string]any)["x"] = 7.0
	})
	got := reasons(Check(file(t, base), next, pol(nobody)))
	want := map[string]string{"logo": "changed", "title": "moved", "box": "unlocked", "inner": "moved"}
	for id, r := range want {
		if got[id] != r {
			t.Errorf("%s: want %s, got %q (all: %v)", id, r, got[id], got)
		}
	}
}

func TestRemovalAndReparentingAreRefused(t *testing.T) {
	next := edit(t, func(n []any) {
		box := node(n, 2)
		inner := box["children"].([]any)[0]
		box["children"] = []any{}
		n[0] = inner // logo removed, inner moved to the page
	})
	got := reasons(Check(file(t, base), next, pol(nobody)))
	if got["logo"] != "removed" || got["inner"] != "moved" {
		t.Fatalf("got %v", got)
	}
}

func TestRightsHolderMayChangeAnything(t *testing.T) {
	next := edit(t, func(n []any) { n[0] = node(n, 3) })
	asked := 0
	may := func(ws string) bool { asked++; return ws == "ws1" }
	if v := Check(file(t, base), next, pol(may)); len(v) != 0 {
		t.Fatalf("want none, got %+v", v)
	}
	if asked != 1 {
		t.Fatalf("rights asked %d times, want once per workspace", asked)
	}
}

func TestUnknownLevelsReadAsLocked(t *testing.T) {
	m := file(t, base)
	node(m["pages"].([]any)[0].(map[string]any)["children"].([]any), 3)["templateLock"] = map[string]any{"level": "future", "workspaceId": "ws2"}
	l, _ := Of(node(m["pages"].([]any)[0].(map[string]any)["children"].([]any), 3))
	if l.Level != LevelLocked {
		t.Fatalf("unknown level must read as locked, got %q", l.Level)
	}
	if ws := Workspaces(m); len(ws) != 2 {
		t.Fatalf("workspaces %v", ws)
	}
}

// A version label is not a reason to look less closely: the caller migrates
// both files to one version, and the check compares them field by field.
func TestVersionLabelDoesNotSkipTheCheck(t *testing.T) {
	next := edit(t, func(n []any) {
		node(n, 1)["transform"].(map[string]any)["y"] = 500.0
		node(n, 0)["src"] = "other.png"
	})
	for _, v := range []any{26.0, nil} {
		if v == nil {
			delete(next, "schemaVersion")
		} else {
			next["schemaVersion"] = v
		}
		got := reasons(Check(file(t, base), next, pol(nobody)))
		if got["title"] != "moved" || got["logo"] != "changed" {
			t.Fatalf("schemaVersion %v: got %v", v, got)
		}
	}
}

func TestChildrenOfAProtectedContainerAreFixed(t *testing.T) {
	added := edit(t, func(n []any) {
		box := node(n, 2)
		box["children"] = append(box["children"].([]any), map[string]any{"id": "intruder", "type": "shape"})
	})
	if got := reasons(Check(file(t, base), added, pol(nobody))); got["box"] != "changed" {
		t.Fatalf("added child: %v", got)
	}
	locked := file(t, base)
	box := node(locked["pages"].([]any)[0].(map[string]any)["children"].([]any), 2)
	box["templateLock"] = map[string]any{"level": "locked", "workspaceId": "ws1"}
	box["children"] = append(box["children"].([]any), map[string]any{"id": "second", "type": "shape"})
	reordered := file(t, base)
	rbox := node(reordered["pages"].([]any)[0].(map[string]any)["children"].([]any), 2)
	rbox["templateLock"] = map[string]any{"level": "locked", "workspaceId": "ws1"}
	kids := box["children"].([]any)
	rbox["children"] = []any{kids[1], kids[0]}
	if got := reasons(Check(locked, reordered, pol(nobody))); got["box"] != "changed" {
		t.Fatalf("reordered children: %v", got)
	}
}

func TestContentFrameMayReplaceItsPicture(t *testing.T) {
	const frame = `{"schemaVersion":27,"pages":[{"id":"p1","children":[
 {"id":"f","type":"frame","transform":{"x":0,"y":0,"scaleX":1,"scaleY":1,"rotation":0},"size":{"width":10,"height":10},
  "templateLock":{"level":"content","workspaceId":"ws1"},"child":{"id":"pic1","type":"image","src":"a.png"}}]}]}`
	next := file(t, frame)
	node(next["pages"].([]any)[0].(map[string]any)["children"].([]any), 0)["child"] = map[string]any{"id": "pic2", "type": "image", "src": "b.png"}
	got := reasons(Check(file(t, frame), next, pol(nobody)))
	if got["f"] != "" {
		t.Fatalf("content frame picture swap must pass, got %v", got)
	}
}

func TestAddingLocks(t *testing.T) {
	setLock := func(n map[string]any, ws string) {
		n["templateLock"] = map[string]any{"level": "locked", "workspaceId": ws}
	}
	// On an object that already existed: only the design's own workspace, by
	// someone who may manage its locks.
	foreign := edit(t, func(n []any) { setLock(node(n, 3), "nobody-ws") })
	if got := reasons(Check(file(t, base), foreign, pol(func(string) bool { return true }))); got["free"] != "locked" {
		t.Fatalf("foreign lock on an existing object: %v", got)
	}
	ownLock := edit(t, func(n []any) { setLock(node(n, 3), "dws") })
	if got := reasons(Check(file(t, base), ownLock, pol(nobody))); got["free"] != "locked" {
		t.Fatalf("own lock by someone who may not set it: %v", got)
	}
	if v := Check(file(t, base), ownLock, pol(func(ws string) bool { return ws == "dws" })); len(v) != 0 {
		t.Fatalf("own lock by its manager: %+v", v)
	}
	// On new objects: the design's own locks freely, another workspace's when
	// it already protects something here or MayCarry allows it.
	withNew := func(id, ws string) map[string]any {
		m := file(t, base)
		p := m["pages"].([]any)[0].(map[string]any)
		c := map[string]any{"id": id, "type": "shape"}
		setLock(c, ws)
		p["children"] = append(p["children"].([]any), c)
		return m
	}
	for _, tc := range []struct {
		ws    string
		carry bool
		want  string
	}{
		{"dws", false, ""},       // the design's own
		{"ws1", false, ""},       // already protects objects here (a duplicated page)
		{"ws9", true, ""},        // allowed to be carried (a template's workspace)
		{"ws9", false, "locked"}, // nobody can act for it
	} {
		p := pol(nobody)
		p.MayCarry = func(string) bool { return tc.carry }
		if got := reasons(Check(file(t, base), withNew("new", tc.ws), p))["new"]; got != tc.want {
			t.Errorf("new object locked for %s (carry %v): got %q, want %q", tc.ws, tc.carry, got, tc.want)
		}
	}
}
