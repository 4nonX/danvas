package persistence

// The v29 write boundary: measurement unit. `measureUnit` is an optional
// string on the file, and a page size may be any (fractional) number of
// design px; persistence treats both as opaque, so what matters here is that
// they survive a round trip and that every older version still validates.

import (
	"testing"
)

// The paired EXACT pins are the cross-language drift alarm: a future bump
// must update this line, the TS twin (measureUnit.test.ts), and both
// currentSchemaVersion mirrors in the SAME change (CLAUDE.md bump protocol).
func TestV29PinsTheVersionPair(t *testing.T) {
	if currentSchemaVersion != 29 {
		t.Fatalf("currentSchemaVersion = %d: update this pin and the TS twin as part of the bump", currentSchemaVersion)
	}
}

func TestWriteBoundaryKeepsMeasureUnitAndExactSizes(t *testing.T) {
	d := designAtVersion(29, lockedText())
	d["measureUnit"] = "some-future-unit"
	page := d["pages"].([]any)[0].(map[string]any)
	page["width"] = 188.97637795275591
	page["height"] = 377.95275590551182
	if err := validateForWrite(d); err != nil {
		t.Fatalf("a current-version document was rejected: %v", err)
	}
	if d["measureUnit"] != "some-future-unit" || page["width"] != 188.97637795275591 {
		t.Fatalf("the unit or the exact size did not survive the write boundary: %#v", d)
	}
}

// Every older version must still be writable: a self-hoster upgrading a binary
// keeps designs made by every version before it.
func TestWriteBoundaryStillAcceptsEveryOlderVersionAtV29(t *testing.T) {
	for v := 1.0; v <= 29; v++ {
		if err := validateForWrite(designAtVersion(v, maskedImage())); err != nil {
			t.Fatalf("v%.0f rejected: %v", v, err)
		}
	}
}
