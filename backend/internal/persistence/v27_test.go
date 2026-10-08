package persistence

// The v27 write boundary: template locks. `templateLock` is an optional object
// on any node; persistence treats it as opaque (the save gate in
// internal/templatelock reads it, the write boundary does not), so what matters
// here is that it survives a round trip and that every older version still
// validates.

import (
	"testing"
)

func lockedText() map[string]any {
	return map[string]any{
		"id": "t1", "type": "text",
		"transform":    map[string]any{"x": 0.0, "y": 0.0, "scaleX": 1.0, "scaleY": 1.0, "rotation": 0.0},
		"size":         map[string]any{"width": 200.0, "height": 40.0},
		"content":      []any{},
		"templateLock": map[string]any{"level": "content", "workspaceId": "ws1"},
	}
}

// The paired EXACT pins are the cross-language drift alarm: a future bump
// must update this line, the TS twin (templateLock.test.ts), and both
// currentSchemaVersion mirrors in the SAME change (CLAUDE.md bump protocol).
func TestV27PinsTheVersionPair(t *testing.T) {
	if currentSchemaVersion != 27 {
		t.Fatalf("currentSchemaVersion = %d: update this pin and the TS twin as part of the bump", currentSchemaVersion)
	}
}

func TestWriteBoundaryAcceptsV27(t *testing.T) {
	if err := validateForWrite(designAtVersion(27, lockedText())); err != nil {
		t.Fatalf("a current-version document was rejected: %v", err)
	}
}

// Every older version must still be writable: a self-hoster upgrading a binary
// keeps designs made by every version before it.
func TestWriteBoundaryStillAcceptsEveryOlderVersionAtV27(t *testing.T) {
	for v := 1.0; v <= 27; v++ {
		if err := validateForWrite(designAtVersion(v, maskedImage())); err != nil {
			t.Fatalf("v%.0f rejected: %v", v, err)
		}
	}
}

// The backend never rewrites the lock, so it must come back exactly as written,
// including a level this build does not know.
func TestTemplateLockIsOpaqueToTheBackend(t *testing.T) {
	n := lockedText()
	n["templateLock"] = map[string]any{"level": "some-future-level", "workspaceId": "ws1", "extra": true}
	d := designAtVersion(27, n)
	if err := validateForWrite(d); err != nil {
		t.Fatalf("validate: %v", err)
	}
	node := d["pages"].([]any)[0].(map[string]any)["children"].([]any)[0].(map[string]any)
	lock, ok := node["templateLock"].(map[string]any)
	if !ok || lock["level"] != "some-future-level" || lock["workspaceId"] != "ws1" || lock["extra"] != true {
		t.Fatalf("templateLock did not survive the write boundary: %#v", node["templateLock"])
	}
}
