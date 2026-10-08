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
	if v := Check(file(t, base), next, nobody); len(v) != 0 {
		t.Fatalf("want no violations, got %+v", v)
	}
}

func TestContentLevelAllowsTextAndGrowth(t *testing.T) {
	next := edit(t, func(n []any) {
		node(n, 1)["content"] = []any{map[string]any{"runs": []any{map[string]any{"text": "Neuer Titel"}}}}
		node(n, 1)["size"].(map[string]any)["height"] = 80.0
		node(node(n, 2)["children"].([]any), 0)["content"] = []any{"x"} // inherited content lock
	})
	if v := Check(file(t, base), next, nobody); len(v) != 0 {
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
	got := reasons(Check(file(t, base), next, nobody))
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
	got := reasons(Check(file(t, base), next, nobody))
	if got["logo"] != "removed" || got["inner"] != "moved" {
		t.Fatalf("got %v", got)
	}
}

func TestRightsHolderMayChangeAnything(t *testing.T) {
	next := edit(t, func(n []any) { n[0] = node(n, 3) })
	asked := 0
	may := func(ws string) bool { asked++; return ws == "ws1" }
	if v := Check(file(t, base), next, may); len(v) != 0 {
		t.Fatalf("want none, got %+v", v)
	}
	if asked != 1 {
		t.Fatalf("rights asked %d times, want once per workspace", asked)
	}
}

func TestNewLocksAndUnknownLevels(t *testing.T) {
	prev := file(t, `{"schemaVersion":27,"pages":[{"id":"p1","children":[]}]}`)
	if v := Check(prev, file(t, base), nobody); len(v) != 0 {
		t.Fatalf("adding locked nodes must pass, got %+v", v)
	}
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

func TestSchemaChangeChecksPresenceOnly(t *testing.T) {
	next := edit(t, func(n []any) { node(n, 0)["src"] = "migrated.png" })
	next["schemaVersion"] = 28.0
	if v := Check(file(t, base), next, nobody); len(v) != 0 {
		t.Fatalf("a migrated file must not be judged field by field, got %+v", v)
	}
}
