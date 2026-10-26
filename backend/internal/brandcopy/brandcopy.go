// Package brandcopy copies brand kits (one, several or all of a workspace)
// into other workspaces, and into a new one as it is created.
//
// A kit points at workspace data: the uploads of its logos, graphics and
// font files, and the workspace's font library by family name. A copy that
// kept pointing at the source would break the day the source deletes an
// upload, so every upload the kit uses is copied into the target and the
// references are rewritten, and the font families come along (when the user
// may add fonts there), as when designs are copied to another workspace.
//
// Copying takes brand.copy in the source and brand.kits in every target. A
// kit whose name the target already uses is either replaced (its earlier
// state stays in its version history) or copied under a free name. The
// source is never changed.
package brandcopy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"hycanvas/backend/internal/authz"
	"hycanvas/backend/internal/brand"
	"hycanvas/backend/internal/uploads"
)

var (
	ErrForbidden  = errors.New("brandcopy: forbidden")
	ErrBadRequest = errors.New("brandcopy: bad request")
)

// MaxTargets bounds one copy.
const MaxTargets = 20

type Access interface {
	Require(ctx context.Context, userID, workspaceID string, a authz.Action, creatorID string) error
}

type Brands interface {
	ListKits(ctx context.Context, workspaceID, userID string) ([]brand.BrandKit, error)
	CreateKit(ctx context.Context, workspaceID, userID, name string, isDefault *bool) (brand.BrandKit, error)
	UpdateKit(ctx context.Context, kitID, userID string, in brand.UpdateInput) (brand.BrandKit, error)
}

type Assets interface {
	InWorkspace(ctx context.Context, workspaceID string, ids []string) (map[string]bool, error)
	CopyToWorkspace(ctx context.Context, userID, srcWS, assetID, dstWS string) (uploads.UploadedAsset, error)
}

type Fonts interface {
	CopyFamilies(ctx context.Context, userID, srcWS, dstWS string, families []string) ([]string, error)
}

type Service struct {
	access Access
	brands Brands
	assets Assets
	fonts  Fonts
}

func NewService(access Access, brands Brands, assets Assets, fonts Fonts) *Service {
	return &Service{access: access, brands: brands, assets: assets, fonts: fonts}
}

// Input is one copy request.
type Input struct {
	SourceWorkspaceID string `json:"sourceWorkspaceId"`
	// All copies every kit of the source; otherwise KitIDs names them.
	All                bool     `json:"all"`
	KitIDs             []string `json:"kitIds"`
	TargetWorkspaceIDs []string `json:"targetWorkspaceIds"`
	// Replace replaces a kit of the same name in a target; otherwise the copy
	// gets a free name ("Brand (2)").
	Replace bool `json:"replace"`
}

// Item is the outcome for one kit in one target.
type Item struct {
	KitID       string `json:"kitId"`
	Kit         string `json:"kit"`
	WorkspaceID string `json:"workspaceId"`
	NewID       string `json:"newId,omitempty"`
	Name        string `json:"name,omitempty"`
	Replaced    bool   `json:"replaced,omitempty"`
	Error       string `json:"error,omitempty"`
}

// Result is what the job reports.
type Result struct {
	Kits   []Item `json:"kits"`
	Assets int    `json:"assets"`
	// MissingFonts are font families the kits use that a target still lacks
	// (the user may not add fonts there).
	MissingFonts []string `json:"missingFonts"`
}

// Progress reports done of total kit copies.
type Progress func(done, total int)

// Prepare checks the request and returns the kits to copy, the source's
// standard kit first, so the handler can refuse at once.
func (s *Service) Prepare(ctx context.Context, userID string, in Input) ([]brand.BrandKit, error) {
	if in.SourceWorkspaceID == "" || len(in.TargetWorkspaceIDs) == 0 || len(in.TargetWorkspaceIDs) > MaxTargets || (!in.All && len(in.KitIDs) == 0) {
		return nil, ErrBadRequest
	}
	seen := map[string]bool{}
	for _, t := range in.TargetWorkspaceIDs {
		if t == "" || t == in.SourceWorkspaceID || seen[t] {
			return nil, ErrBadRequest
		}
		seen[t] = true
	}
	if err := s.access.Require(ctx, userID, in.SourceWorkspaceID, authz.BrandCopy, ""); err != nil {
		return nil, ErrForbidden
	}
	for _, t := range in.TargetWorkspaceIDs {
		if err := s.access.Require(ctx, userID, t, authz.BrandKits, ""); err != nil {
			return nil, ErrForbidden
		}
	}
	all, err := s.brands.ListKits(ctx, in.SourceWorkspaceID, userID)
	if err != nil {
		return nil, ErrForbidden
	}
	want := map[string]bool{}
	for _, id := range in.KitIDs {
		want[id] = true
	}
	var kits []brand.BrandKit
	for _, k := range all {
		if in.All || want[k.ID] {
			kits = append(kits, k)
			delete(want, k.ID)
		}
	}
	if len(want) > 0 || len(kits) == 0 {
		return nil, ErrBadRequest
	}
	// The standard kit first: in a target without kits it becomes the
	// target's standard, as it is the source's.
	for i, k := range kits {
		if k.IsDefault && i > 0 {
			kits[0], kits[i] = kits[i], kits[0]
			break
		}
	}
	return kits, nil
}

// Copy copies the prepared kits into every target. A kit that fails is
// reported and the others go on.
func (s *Service) Copy(ctx context.Context, userID string, in Input, kits []brand.BrandKit, progress Progress) (Result, error) {
	res := Result{Kits: []Item{}, MissingFonts: []string{}}
	missing := map[string]bool{}
	total, done := len(kits)*len(in.TargetWorkspaceIDs), 0
	for _, dst := range in.TargetWorkspaceIDs {
		existing, err := s.brands.ListKits(ctx, dst, userID)
		if err != nil {
			for _, k := range kits {
				res.Kits = append(res.Kits, Item{KitID: k.ID, Kit: k.Name, WorkspaceID: dst, Error: "forbidden"})
			}
			done += len(kits)
			if progress != nil {
				progress(done, total)
			}
			continue
		}
		copied := map[string]string{} // source asset -> target asset, per target
		hasDefault := false
		names := map[string]brand.BrandKit{}
		for _, e := range existing {
			hasDefault = hasDefault || e.IsDefault
			names[strings.ToLower(strings.TrimSpace(e.Name))] = e
		}
		for _, k := range kits {
			item := Item{KitID: k.ID, Kit: k.Name, WorkspaceID: dst}
			out, n, lacking, err := s.copyOne(ctx, userID, in, k, dst, copied, names, &hasDefault)
			res.Assets += n
			for _, f := range lacking {
				missing[f] = true
			}
			if err != nil {
				item.Error = errorCode(err)
			} else {
				item.NewID, item.Name, item.Replaced = out.kit.ID, out.kit.Name, out.replaced
				names[strings.ToLower(strings.TrimSpace(out.kit.Name))] = out.kit
			}
			res.Kits = append(res.Kits, item)
			done++
			if progress != nil {
				progress(done, total)
			}
		}
	}
	for f := range missing {
		res.MissingFonts = append(res.MissingFonts, f)
	}
	return res, nil
}

type copied struct {
	kit      brand.BrandKit
	replaced bool
}

func (s *Service) copyOne(ctx context.Context, userID string, in Input, k brand.BrandKit, dst string, done map[string]string, names map[string]brand.BrandKit, hasDefault *bool) (copied, int, []string, error) {
	// The uploads the kit uses (logo files and versions, graphics, font
	// files) that belong to the source.
	ids := map[string]bool{}
	for _, raw := range []json.RawMessage{k.Logos, k.Collections, k.Fonts} {
		collectUUIDs(decode(raw), ids)
	}
	cand := make([]string, 0, len(ids))
	for id := range ids {
		cand = append(cand, id)
	}
	owned, err := s.assets.InWorkspace(ctx, in.SourceWorkspaceID, cand)
	if err != nil {
		return copied{}, 0, nil, err
	}
	n := 0
	mapping := map[string]string{}
	for id := range owned {
		if to, ok := done[id]; ok {
			mapping[id] = to
			continue
		}
		a, err := s.assets.CopyToWorkspace(ctx, userID, in.SourceWorkspaceID, id, dst)
		if err != nil {
			return copied{}, n, nil, err
		}
		done[id], mapping[id] = a.ID, a.ID
		n++
	}
	lacking, err := s.fonts.CopyFamilies(ctx, userID, in.SourceWorkspaceID, dst, fontFamilies(k.Fonts))
	if err != nil {
		return copied{}, n, nil, err
	}
	controls, _ := json.Marshal(k.Controls)
	patch := brand.UpdateInput{
		Palettes:     k.Palettes,
		Fonts:        rewriteRaw(k.Fonts, mapping),
		Logos:        rewriteRaw(k.Logos, mapping),
		Voice:        k.Voice,
		VoiceSet:     true,
		Collections:  rewriteRaw(k.Collections, mapping),
		ControlsRaw:  controls,
		LogoVersions: k.LogoVersions,
	}
	if same, ok := names[strings.ToLower(strings.TrimSpace(k.Name))]; ok && in.Replace {
		out, err := s.brands.UpdateKit(ctx, same.ID, userID, patch)
		return copied{kit: out, replaced: true}, n, lacking, err
	}
	name := k.Name
	if _, taken := names[strings.ToLower(strings.TrimSpace(name))]; taken {
		name = freeName(k.Name, names)
	}
	makeDefault := k.IsDefault && !*hasDefault
	created, err := s.brands.CreateKit(ctx, dst, userID, name, &makeDefault)
	if err != nil {
		return copied{}, n, lacking, err
	}
	*hasDefault = *hasDefault || makeDefault
	out, err := s.brands.UpdateKit(ctx, created.ID, userID, patch)
	return copied{kit: out}, n, lacking, err
}

// freeName is the name with the lowest free " (n)" suffix.
func freeName(name string, taken map[string]brand.BrandKit) string {
	base := strings.TrimSpace(name)
	for i := 2; ; i++ {
		c := fmt.Sprintf("%s (%d)", base, i)
		if _, ok := taken[strings.ToLower(c)]; !ok {
			return c
		}
	}
}

func errorCode(err error) string {
	switch {
	case errors.Is(err, brand.ErrForbidden), errors.Is(err, ErrForbidden):
		return "forbidden"
	default:
		return "failed"
	}
}

func decode(raw json.RawMessage) any {
	var v any
	if len(raw) == 0 || json.Unmarshal(raw, &v) != nil {
		return nil
	}
	return v
}

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// collectUUIDs gathers every string value that is a UUID (upload ids among
// them; the caller keeps those that are the source's uploads).
func collectUUIDs(v any, out map[string]bool) {
	switch t := v.(type) {
	case string:
		if uuidRe.MatchString(t) {
			out[t] = true
		}
	case []any:
		for _, x := range t {
			collectUUIDs(x, out)
		}
	case map[string]any:
		for _, x := range t {
			collectUUIDs(x, out)
		}
	}
}

func rewrite(v any, mapping map[string]string) any {
	switch t := v.(type) {
	case string:
		if to, ok := mapping[t]; ok {
			return to
		}
		return t
	case []any:
		for i, x := range t {
			t[i] = rewrite(x, mapping)
		}
		return t
	case map[string]any:
		for k, x := range t {
			t[k] = rewrite(x, mapping)
		}
		return t
	}
	return v
}

// rewriteRaw rewrites upload ids in a JSON column; an empty column stays nil
// (left as it is by the update).
func rewriteRaw(raw json.RawMessage, mapping map[string]string) json.RawMessage {
	v := decode(raw)
	if v == nil {
		return raw
	}
	b, err := json.Marshal(rewrite(v, mapping))
	if err != nil {
		return raw
	}
	return b
}

// fontFamilies are the families a kit's fonts name.
func fontFamilies(raw json.RawMessage) []string {
	var fonts []struct {
		FontFamily string `json:"fontFamily"`
	}
	_ = json.Unmarshal(raw, &fonts)
	seen := map[string]bool{}
	var out []string
	for _, f := range fonts {
		if f.FontFamily != "" && !seen[f.FontFamily] {
			seen[f.FontFamily] = true
			out = append(out, f.FontFamily)
		}
	}
	return out
}
