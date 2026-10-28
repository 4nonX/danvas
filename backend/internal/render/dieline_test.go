package render

import "testing"

func TestIsDieLine(t *testing.T) {
	cases := []struct {
		node map[string]any
		want bool
	}{
		{map[string]any{"data": map[string]any{"print": map[string]any{"dieLine": true}}}, true},
		{map[string]any{"data": map[string]any{"print": map[string]any{"dieLine": "yes"}}}, false},
		{map[string]any{"data": map[string]any{"print": map[string]any{"overprint": true}}}, false},
		{map[string]any{"data": map[string]any{}}, false},
		{map[string]any{}, false},
	}
	for i, c := range cases {
		if got := isDieLine(c.node); got != c.want {
			t.Errorf("case %d: isDieLine = %v, want %v", i, got, c.want)
		}
	}
}
