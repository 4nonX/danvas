package persistence

// The v28 write boundary: print marks. `printMarks` is an optional object on
// a page and `bleed` a number; persistence treats both as opaque, so what
// matters here is that they survive a round trip and that every older version
// still validates.

import (
	"testing"
)

func pageWithMarks() DesignFile {
	d := designAtVersion(28, lockedText())
	page := d["pages"].([]any)[0].(map[string]any)
	page["bleed"] = 11.34
	page["printMarks"] = map[string]any{
		"crop": true, "style": "some-future-style", "weight": 0.25, "length": 18.9, "offset": 11.34,
		"color": map[string]any{"srgb": map[string]any{"r": 0.0, "g": 0.0, "b": 0.0, "a": 1.0}},
	}
	return d
}

func TestWriteBoundaryAcceptsV28(t *testing.T) {
	if err := validateForWrite(pageWithMarks()); err != nil {
		t.Fatalf("a current-version document was rejected: %v", err)
	}
}

// Every older version must still be writable: a self-hoster upgrading a binary
// keeps designs made by every version before it.
func TestWriteBoundaryStillAcceptsEveryOlderVersionAtV28(t *testing.T) {
	for v := 1.0; v <= 28; v++ {
		if err := validateForWrite(designAtVersion(v, maskedImage())); err != nil {
			t.Fatalf("v%.0f rejected: %v", v, err)
		}
	}
}

// The backend never rewrites the marks, so they come back exactly as written,
// including a style this build does not know.
func TestPrintMarksAreOpaqueToTheBackend(t *testing.T) {
	d := pageWithMarks()
	if err := validateForWrite(d); err != nil {
		t.Fatalf("validate: %v", err)
	}
	page := d["pages"].([]any)[0].(map[string]any)
	marks, ok := page["printMarks"].(map[string]any)
	if !ok || marks["style"] != "some-future-style" || marks["crop"] != true || page["bleed"] != 11.34 {
		t.Fatalf("print marks did not survive the write boundary: %#v", page)
	}
}
