package httpapi

import (
	"encoding/json"
	"testing"

	"hycanvas/backend/internal/brand"
)

// The grounding mirrors the editor's derivations: the voice clause word for
// word, every swatch as hex, fonts by role, the first logo with its URL.
func TestBrandGroundingFromKitMirrorsTheEditor(t *testing.T) {
	kit := brand.BrandKit{
		Voice:    json.RawMessage(`{"tone":["warm"," direct ",""],"doSay":["we","together"],"dontSay":["synergy"]}`),
		Palettes: json.RawMessage(`[{"colors":[{"value":{"srgb":{"r":0.0549,"g":0.4784,"b":0.3725,"a":1}}},{"value":{"srgb":{"r":0.9569,"g":0.7255,"b":0.2588,"a":1}}}]},{"colors":[{"value":{"srgb":{"r":1,"g":1,"b":1,"a":1}}}]}]`),
		Fonts:    json.RawMessage(`[{"role":"Body text","fontFamily":"Nunito"},{"role":"Headline","fontFamily":"Fraunces"}]`),
		Logos:    json.RawMessage(`[{"id":"l1","label":"Primary","assetId":"asset-1","minSizePx":120},{"id":"l2","assetId":"asset-2"}]`),
	}
	g := brandGroundingFromKit(kit, func(id string) string { return "/api/v1/assets/" + id + "/content" }, func(id string) float64 { return 3 })
	if g.Clause != "Write in this brand voice. Tone: warm,  direct . Do: we; together. Don't: synergy." {
		t.Fatalf("clause = %q", g.Clause)
	}
	if len(g.Palette) != 3 || g.Palette[0] != "#0e7a5f" || g.Palette[1] != "#f4b942" || g.Palette[2] != "#ffffff" {
		t.Fatalf("palette = %v", g.Palette)
	}
	if g.Fonts == nil || g.Fonts.Heading != "Fraunces" || g.Fonts.Body != "Nunito" {
		t.Fatalf("fonts = %+v", g.Fonts)
	}
	if g.Logo == nil || g.Logo.AssetID != "asset-1" || g.Logo.URL != "/api/v1/assets/asset-1/content" || g.Logo.Aspect != 3 || g.Logo.MinSizePx != 120 {
		t.Fatalf("logo = %+v", g.Logo)
	}
}

// A kit with nothing in it grounds nothing, and malformed JSON never fails
// a generation.
func TestBrandGroundingFromKitToleratesEmptyAndBadKits(t *testing.T) {
	if g := brandGroundingFromKit(brand.BrandKit{}, func(string) string { return "" }, func(string) float64 { return 0 }); g.Clause != "" || g.Palette != nil || g.Fonts != nil || g.Logo != nil {
		t.Fatalf("empty kit grounded something: %+v", g)
	}
	bad := brand.BrandKit{Voice: json.RawMessage(`{"tone":"not a list"}`), Palettes: json.RawMessage(`nope`), Fonts: json.RawMessage(`[]`), Logos: json.RawMessage(`[{"assetId":""}]`)}
	if g := brandGroundingFromKit(bad, func(string) string { return "" }, func(string) float64 { return 0 }); g.Clause != "" || g.Palette != nil || g.Fonts != nil || g.Logo != nil {
		t.Fatalf("bad kit grounded something: %+v", g)
	}
	// A voice with only blank entries produces no clause.
	blank := brand.BrandKit{Voice: json.RawMessage(`{"tone":[" "],"doSay":[],"dontSay":[""]}`)}
	if g := brandGroundingFromKit(blank, func(string) string { return "" }, func(string) float64 { return 0 }); g.Clause != "" {
		t.Fatalf("blank voice produced %q", g.Clause)
	}
}
