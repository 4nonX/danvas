// Package templatelock judges a design save against the template locks its
// nodes carry. A template lock (`node.templateLock`, schema v27) protects a node
// and everything inside it on behalf of the workspace that set it, wherever the
// design travels: a copy in a personal workspace keeps the lock and the origin
// workspace that alone may lift it.
//
// Levels:
//   - "content": the frame is fixed (the node stays, keeps its place, size and
//     parent), what it shows may change (text, picture, crop).
//   - "locked" (and any level this build does not know): nothing changes.
//
// The rule is deliberately narrow. It compares only what a template protects,
// against the design's previous file, by node id, and only for nodes whose lock
// the saver may not lift. Anything it cannot judge with certainty (a schema
// version change between the two files) is checked for presence and lock alone,
// so a legitimate save is never refused over a field a migration rewrote.
// The DesignFile is opaque JSON here, like everywhere at the write boundary.
package templatelock

import "math"

const (
	LevelLocked  = "locked"
	LevelContent = "content"
)

// Lock is a node's template lock.
type Lock struct {
	Level       string `json:"level"`
	WorkspaceID string `json:"workspaceId"`
}

// Violation is one protected node a save changed.
type Violation struct {
	NodeID      string
	WorkspaceID string
	Reason      string // "removed" | "unlocked" | "moved" | "changed"
}

// Of reads a node's own template lock. An unknown level reads as "locked", the
// strictest, so a lock written by a newer build never protects less here.
func Of(node map[string]any) (Lock, bool) {
	raw, ok := node["templateLock"].(map[string]any)
	if !ok {
		return Lock{}, false
	}
	ws, _ := raw["workspaceId"].(string)
	level, _ := raw["level"].(string)
	if level != LevelContent {
		level = LevelLocked
	}
	return Lock{Level: level, WorkspaceID: ws}, true
}

// Workspaces lists every workspace a template lock in the file names.
func Workspaces(file map[string]any) []string {
	seen := map[string]bool{}
	var out []string
	walk(file, func(n map[string]any, _ string, _ *Lock) {
		if l, ok := Of(n); ok && !seen[l.WorkspaceID] {
			seen[l.WorkspaceID] = true
			out = append(out, l.WorkspaceID)
		}
	})
	return out
}

// Keys a "locked" node may still change: labels and metadata that do not alter
// the artwork, and the plain layer lock. `children` is judged node by node.
var lockedIgnore = map[string]bool{
	"children": true, "name": true, "data": true, "altText": true, "alt": true,
	"decorative": true, "animations": true, "animation": true, "interaction": true,
	"link": true, "locked": true,
}

type entry struct {
	node   map[string]any
	parent string
}

// Check returns the protected nodes `next` changed relative to `prev`. `may`
// reports whether the saver may lift locks of a workspace; it is asked once per
// workspace. Locks added by the save are never violations: a lock only ever
// restricts, so a design created from a template carries its locks freely.
func Check(prev, next map[string]any, may func(workspaceID string) bool) []Violation {
	if prev == nil || next == nil {
		return nil
	}
	allowed := map[string]bool{}
	mayLift := func(ws string) bool {
		v, ok := allowed[ws]
		if !ok {
			v = may(ws)
			allowed[ws] = v
		}
		return v
	}
	idx := map[string]entry{}
	walk(next, func(n map[string]any, parent string, _ *Lock) {
		if id, _ := n["id"].(string); id != "" {
			idx[id] = entry{n, parent}
		}
	})
	sameVersion := num(prev["schemaVersion"]) == num(next["schemaVersion"])

	var out []Violation
	walk(prev, func(n map[string]any, parent string, eff *Lock) {
		id, _ := n["id"].(string)
		if eff == nil || id == "" || mayLift(eff.WorkspaceID) {
			return
		}
		bad := func(reason string) {
			out = append(out, Violation{NodeID: id, WorkspaceID: eff.WorkspaceID, Reason: reason})
		}
		got, ok := idx[id]
		if !ok {
			bad("removed")
			return
		}
		own, hadOwn := Of(n)
		if hadOwn {
			if now, has := Of(got.node); !has || now != own {
				bad("unlocked")
				return
			}
		}
		if got.parent != parent {
			bad("moved")
			return
		}
		if !sameVersion {
			return
		}
		if !equal(n["transform"], got.node["transform"]) || !equal(n["type"], got.node["type"]) {
			bad("moved")
			return
		}
		// A text box at content level grows with its text, so only its place
		// is fixed; every other protected node keeps its size too.
		if !(eff.Level == LevelContent && n["type"] == "text") && !equal(n["size"], got.node["size"]) {
			bad("moved")
			return
		}
		if eff.Level == LevelContent {
			return
		}
		keys := map[string]bool{}
		for k := range n {
			keys[k] = true
		}
		for k := range got.node {
			keys[k] = true
		}
		for k := range keys {
			if !lockedIgnore[k] && !equal(n[k], got.node[k]) {
				bad("changed")
				return
			}
		}
	})
	return out
}

// walk visits every node with its parent id ("" on a page or the page's own
// id) and its effective lock: its own, else the nearest locked ancestor's.
func walk(file map[string]any, visit func(n map[string]any, parent string, eff *Lock)) {
	var rec func(nodes []any, parent string, inherited *Lock)
	var one func(v any, parent string, inherited *Lock)
	one = func(v any, parent string, inherited *Lock) {
		n, ok := v.(map[string]any)
		if !ok {
			return
		}
		eff := inherited
		if l, ok := Of(n); ok {
			eff = &l
		}
		visit(n, parent, eff)
		id, _ := n["id"].(string)
		if kids, ok := n["children"].([]any); ok {
			rec(kids, id, eff)
		}
		if child, ok := n["child"].(map[string]any); ok {
			one(child, id, eff)
		}
	}
	rec = func(nodes []any, parent string, inherited *Lock) {
		for _, v := range nodes {
			one(v, parent, inherited)
		}
	}
	pages, _ := file["pages"].([]any)
	for _, p := range pages {
		page, _ := p.(map[string]any)
		if page == nil {
			continue
		}
		pid, _ := page["id"].(string)
		kids, _ := page["children"].([]any)
		rec(kids, "page:"+pid, nil)
	}
}

func num(v any) float64 { f, _ := v.(float64); return f }

// equal compares decoded JSON, numbers within a rounding tolerance (a value
// that only went through another float formatting is the same value).
func equal(a, b any) bool {
	switch x := a.(type) {
	case float64:
		y, ok := b.(float64)
		return ok && math.Abs(x-y) <= 1e-6*math.Max(1, math.Max(math.Abs(x), math.Abs(y)))
	case map[string]any:
		y, ok := b.(map[string]any)
		if !ok || len(x) != len(y) {
			return false
		}
		for k, v := range x {
			w, has := y[k]
			if !has || !equal(v, w) {
				return false
			}
		}
		return true
	case []any:
		y, ok := b.([]any)
		if !ok || len(x) != len(y) {
			return false
		}
		for i := range x {
			if !equal(x[i], y[i]) {
				return false
			}
		}
		return true
	default:
		return a == b
	}
}
