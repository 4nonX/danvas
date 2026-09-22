// Brand grounding for API and MCP decks.
//
// The editor grounds every generation in the workspace's brand kit: the voice
// goes into the outline prompt, the palette seeds the theme, the fonts set the
// type, and the logo is a placement away. A deck made through the API or MCP
// got none of that unless the caller retyped the palette. This resolves the
// workspace's default kit into the same four things, with the same rules the
// editor applies (brandVoiceClause and the palette and font derivations in the
// AI panel), so the two doors produce the same deck for the same brief.

package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"hycanvas/backend/internal/brand"
	"hycanvas/backend/internal/composer"
	"hycanvas/backend/internal/uploads"
)

// brandGrounding is what a kit contributes to a generation.
type brandGrounding struct {
	// Clause is the voice instruction for the outline prompt; empty when the
	// kit has no voice.
	Clause string
	// Palette is every approved color across the kit's palettes, as hex.
	Palette []string
	Fonts   *composer.BrandFonts
	Logo    *composer.Logo
}

// groundInBrand resolves the workspace's default kit (the first kit when none
// is marked default). Any failure, including a workspace with no kit, is an
// empty grounding: the deck still generates, unbranded, as it did before.
func groundInBrand(ctx context.Context, br *brand.Service, up *uploads.Service, workspaceID, userID string) brandGrounding {
	if br == nil {
		return brandGrounding{}
	}
	kits, err := br.ListKits(ctx, workspaceID, userID)
	if err != nil || len(kits) == 0 {
		return brandGrounding{}
	}
	kit := kits[0]
	for _, k := range kits {
		if k.IsDefault {
			kit = k
			break
		}
	}
	assetURL := func(string) string { return "" }
	if up != nil {
		assetURL = up.AssetURL
	}
	return brandGroundingFromKit(kit, assetURL)
}

// brandGroundingFromKit derives the grounding from one kit. Pure, so the
// derivations can be checked against the editor's.
func brandGroundingFromKit(kit brand.BrandKit, assetURL func(id string) string) brandGrounding {
	var g brandGrounding

	// Voice, word for word with the editor's brandVoiceClause.
	var voice struct {
		Tone    []string `json:"tone"`
		DoSay   []string `json:"doSay"`
		DontSay []string `json:"dontSay"`
	}
	if len(kit.Voice) > 0 && json.Unmarshal(kit.Voice, &voice) == nil {
		var parts []string
		if tone := nonBlank(voice.Tone); len(tone) > 0 {
			parts = append(parts, "Tone: "+strings.Join(tone, ", ")+".")
		}
		if dos := nonBlank(voice.DoSay); len(dos) > 0 {
			parts = append(parts, "Do: "+strings.Join(dos, "; ")+".")
		}
		if donts := nonBlank(voice.DontSay); len(donts) > 0 {
			parts = append(parts, "Don't: "+strings.Join(donts, "; ")+".")
		}
		if len(parts) > 0 {
			g.Clause = "Write in this brand voice. " + strings.Join(parts, " ")
		}
	}

	// Palette: every swatch across every palette, flattened in order.
	var palettes []struct {
		Colors []struct {
			Value struct {
				SRGB struct{ R, G, B float64 } `json:"srgb"`
			} `json:"value"`
		} `json:"colors"`
	}
	if len(kit.Palettes) > 0 && json.Unmarshal(kit.Palettes, &palettes) == nil {
		for _, p := range palettes {
			for _, c := range p.Colors {
				g.Palette = append(g.Palette, hexOf(c.Value.SRGB.R, c.Value.SRGB.G, c.Value.SRGB.B))
			}
		}
	}

	// Fonts by role, the editor's rules: a role containing "head" or
	// "title" leads, else the first font; "body", "text" or "para" for body,
	// else the last.
	var fonts []struct {
		Role       string `json:"role"`
		FontFamily string `json:"fontFamily"`
	}
	if len(kit.Fonts) > 0 && json.Unmarshal(kit.Fonts, &fonts) == nil && len(fonts) > 0 {
		byRole := func(m string) string {
			for _, f := range fonts {
				if strings.Contains(strings.ToLower(f.Role), m) {
					return f.FontFamily
				}
			}
			return ""
		}
		heading := firstNonEmpty(byRole("head"), byRole("title"), fonts[0].FontFamily)
		body := firstNonEmpty(byRole("body"), byRole("text"), byRole("para"), fonts[len(fonts)-1].FontFamily)
		if heading != "" || body != "" {
			g.Fonts = &composer.BrandFonts{Heading: heading, Body: body}
		}
	}

	// The primary logo: the first one the kit lists.
	var logos []struct {
		AssetID string `json:"assetId"`
	}
	if len(kit.Logos) > 0 && json.Unmarshal(kit.Logos, &logos) == nil {
		for _, l := range logos {
			if id := strings.TrimSpace(l.AssetID); id != "" {
				if url := assetURL(id); url != "" {
					g.Logo = &composer.Logo{AssetID: id, URL: url}
				}
				break
			}
		}
	}
	return g
}

func nonBlank(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		if strings.TrimSpace(s) != "" {
			out = append(out, s)
		}
	}
	return out
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// hexOf formats a unit-range sRGB color as the editor's toHex does: each
// channel scaled to 0..255 and rounded.
func hexOf(r, g, b float64) string {
	ch := func(v float64) int {
		return int(math.Round(math.Max(0, math.Min(1, v)) * 255))
	}
	return fmt.Sprintf("#%02x%02x%02x", ch(r), ch(g), ch(b))
}
