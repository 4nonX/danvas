package brand

import (
	"encoding/json"
	"testing"
)

// kitRow builds a BrandKitRow from JSON fragments for the pure lint test.
func kitRow(palettes, fonts, logos, controls string) *BrandKitRow {
	return &BrandKitRow{
		Palettes: json.RawMessage(palettes),
		Fonts:    json.RawMessage(fonts),
		Logos:    json.RawMessage(logos),
		Controls: json.RawMessage(controls),
	}
}

func solidFill(r, g, b float64) map[string]any {
	return map[string]any{"type": "solid", "color": map[string]any{"srgb": map[string]any{"r": r, "g": g, "b": b, "a": 1.0}}}
}

func TestLintFile_OffBrandColorAndFont(t *testing.T) {
	// Brand: one swatch (pure red), one approved font, both locks on.
	kit := parseLintKit(kitRow(
		`[{"colors":[{"value":{"srgb":{"r":1,"g":0,"b":0,"a":1}}}]}]`,
		`[{"fontFamily":"Brand Sans","role":"body"}]`,
		`[]`,
		`{"lockColors":true,"lockFonts":true,"lintPolicy":"block"}`,
	))

	file := map[string]any{
		"meta": map[string]any{},
		"pages": []any{map[string]any{"id": "pg", "width": 800.0, "height": 600.0, "children": []any{
			// Off-brand blue fill.
			map[string]any{"id": "rect", "type": "shape", "fills": []any{solidFill(0, 0, 1)}},
			// Off-brand font.
			map[string]any{"id": "txt", "type": "text", "content": []any{
				map[string]any{"runs": []any{map[string]any{"text": "Hi", "style": map[string]any{"fontFamily": "Comic Sans"}}}},
			}},
		}}},
	}

	v := lintFile(file, kit)
	kinds := map[string]int{}
	for _, x := range v {
		kinds[x.Kind]++
	}
	if kinds["off-brand-color"] == 0 {
		t.Fatalf("expected off-brand-color, got %+v", v)
	}
	if kinds["off-brand-font"] == 0 {
		t.Fatalf("expected off-brand-font, got %+v", v)
	}

	// An on-brand color (matching swatch) is not flagged.
	file2 := map[string]any{"meta": map[string]any{}, "pages": []any{map[string]any{"id": "pg", "children": []any{
		map[string]any{"id": "rect", "type": "shape", "fills": []any{solidFill(1, 0, 0)}},
	}}}}
	for _, x := range lintFile(file2, kit) {
		if x.Kind == "off-brand-color" {
			t.Fatalf("on-brand color should not be flagged: %+v", x)
		}
	}
}

func TestLintFile_PolicyOffAndLocksOff(t *testing.T) {
	file := map[string]any{"meta": map[string]any{}, "pages": []any{map[string]any{"id": "pg", "children": []any{
		map[string]any{"id": "rect", "type": "shape", "fills": []any{solidFill(0, 0, 1)}},
	}}}}

	// policy off -> no violations at all.
	off := parseLintKit(kitRow(`[{"colors":[{"value":{"srgb":{"r":1,"g":0,"b":0,"a":1}}}]}]`, `[]`, `[]`, `{"lockColors":true,"lintPolicy":"off"}`))
	if len(lintFile(file, off)) != 0 {
		t.Fatal("policy off should produce no violations")
	}

	// Locks off: the brand check still reports a colour that is not the
	// brand's (the locks only add enforcement on save).
	warn := parseLintKit(kitRow(`[{"colors":[{"value":{"srgb":{"r":1,"g":0,"b":0,"a":1}}}]}]`, `[]`, `[]`, `{"lockColors":false,"lintPolicy":"warn"}`))
	found := false
	for _, x := range lintFile(file, warn) {
		found = found || (x.Kind == "off-brand-color" && x.Params["hex"] == "#0000ff")
	}
	if !found {
		t.Fatal("an off-brand colour is reported without the lock, with its hex as a param")
	}
}

// text at (x, y) of w x h in a colour.
func textAt(id string, x, y, w, h, r, g, b float64) map[string]any {
	return map[string]any{"id": id, "type": "text",
		"transform": map[string]any{"x": x, "y": y, "scaleX": 1.0, "scaleY": 1.0, "rotation": 0.0},
		"size":      map[string]any{"width": w, "height": h},
		"content":   []any{map[string]any{"runs": []any{map[string]any{"text": "Hi", "style": map[string]any{"fill": solidFill(r, g, b)}}}}}}
}

func rectAt(id string, x, y, w, h float64, fill map[string]any) map[string]any {
	return map[string]any{"id": id, "type": "shape", "shape": "rect", "fills": []any{fill},
		"transform": map[string]any{"x": x, "y": y, "scaleX": 1.0, "scaleY": 1.0, "rotation": 0.0},
		"size":      map[string]any{"width": w, "height": h}}
}

func contrastIDs(file map[string]any, controls string) map[string]string {
	kit := parseLintKit(kitRow(`[]`, `[]`, `[]`, controls))
	out := map[string]string{}
	for _, v := range lintFile(file, kit) {
		if v.Kind == "low-contrast" {
			out[v.NodeID] = v.Params["ratio"]
		}
	}
	return out
}

// The contrast check is optional, and measures a text against what is really
// behind it: a white text on a blue panel is fine, on the white page it is
// not; over a picture or a pattern it is left alone.
func TestLintFile_ContrastAgainstWhatIsBehind(t *testing.T) {
	blue := solidFill(0.2, 0.3, 0.6)
	group := map[string]any{"id": "g", "type": "group",
		// A panel turned a quarter, as on a label turned by Change format.
		"transform": map[string]any{"x": 0.0, "y": 400.0, "scaleX": 1.0, "scaleY": 1.0, "rotation": -90.0},
		"size":      map[string]any{"width": 200.0, "height": 300.0},
		"children":  []any{rectAt("panel", 0, 0, 200, 300, blue)}}
	pattern := map[string]any{"id": "leaves", "type": "path", "fills": []any{solidFill(0.66, 0.78, 0.85)},
		"transform": map[string]any{"x": 500.0, "y": 0.0, "scaleX": 1.0, "scaleY": 1.0, "rotation": 0.0},
		"size":      map[string]any{"width": 200.0, "height": 200.0}}
	photo := map[string]any{"id": "photo", "type": "image",
		"transform": map[string]any{"x": 500.0, "y": 300.0, "scaleX": 1.0, "scaleY": 1.0, "rotation": 0.0},
		"size":      map[string]any{"width": 200.0, "height": 200.0}}
	file := map[string]any{"meta": map[string]any{}, "pages": []any{map[string]any{"id": "pg", "width": 800.0, "height": 600.0,
		"background": solidFill(1, 1, 1),
		"children": []any{group, pattern, photo,
			textAt("onPanel", 50, 250, 100, 40, 1, 1, 1),  // inside the turned panel (x 0..300, y 200..400)
			textAt("onPage", 400, 500, 100, 40, 1, 1, 1),  // white on the white page
			textAt("onLeaves", 550, 50, 100, 40, 1, 1, 1), // over a pattern: unknown
			textAt("onPhoto", 550, 350, 100, 40, 1, 1, 1), // over a picture: unknown
			textAt("black", 400, 450, 100, 40, 0, 0, 0),   // black on white
		}}}}

	if got := contrastIDs(file, `{"lintPolicy":"warn"}`); len(got) != 0 {
		t.Fatalf("contrast is off unless the kit asks for it, got %v", got)
	}
	got := contrastIDs(file, `{"lintPolicy":"warn","checkContrast":true}`)
	if len(got) != 1 || got["onPage"] != "1.0" {
		t.Fatalf("only the white text on the white page is too faint, got %v", got)
	}
}
