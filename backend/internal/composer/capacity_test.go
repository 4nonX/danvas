package composer

import (
	"context"
	"encoding/json"
	"testing"

	"hycanvas/backend/internal/aistudio"
)

// The Go door builds the outline prompt natively; its capacity clause must
// say exactly what the composer's own arithmetic says, for every page size.
func TestCapacityClauseMatchesTheComposer(t *testing.T) {
	for _, dt := range []string{"deck", "doc", "poster", "social"} {
		want := aistudio.CapacityClause(dt)
		var size struct{ W, H int }
		json.Unmarshal([]byte(`{}`), &size)
		arg, _ := json.Marshal(map[string]any{"designType": dt, "width": sizeFor(dt)[0], "height": sizeFor(dt)[1]})
		got, err := callString(context.Background(), "__capacityClause", string(arg))
		if err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Fatalf("%s:\n  bundle: %s\n  go:     %s", dt, got, want)
		}
	}
}

func sizeFor(dt string) [2]int {
	switch dt {
	case "doc":
		return [2]int{1240, 1754}
	case "poster":
		return [2]int{1080, 1350}
	case "social":
		return [2]int{1080, 1080}
	}
	return [2]int{1920, 1080}
}
