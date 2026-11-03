// Package templates ports the NestJS templates module (doc 14): the template
// catalog (built-in seed + DB-backed), apply-to-new (deep copy + id regen),
// save-as-template (style extraction), and collections. Search/relevance and the
// deep-copy id remap are pure ports of @hc/templates; the built-in seed catalog
// is embedded as JSON, compiled from scripts/templates/*.json by
// scripts/build-templates.mjs (never hand-edit seed.json). The DesignFile is
// opaque JSON.
//
// Deferred vs the Node original: marketplace review/publish, AI template
// matching, and apply-into-existing (apply-to-new is the path the UI uses).
package templates

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"hycanvas/backend/internal/authz"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

//go:embed seed.json
var seedJSON []byte

// Errors map to RFC 7807 statuses at the HTTP layer.
var (
	ErrForbidden  = errors.New("forbidden")
	ErrNotFound   = errors.New("not found")
	ErrBadRequest = errors.New("bad request")
)

// StyleDescriptor is the extracted style for search/swap (doc 14).
type StyleDescriptor struct {
	Palette    []string         `json:"palette"`
	Typography []map[string]any `json:"typography"`
	StyleTags  []string         `json:"styleTags,omitempty"`
	Effects    []string         `json:"effects,omitempty"`
}

// Template is the catalog view (mirrors @hc/templates Template).
type Template struct {
	ID             string          `json:"id"`
	Title          string          `json:"title"`
	Visibility     string          `json:"visibility"` // personal|team|public
	OwnerID        string          `json:"ownerId"`
	WorkspaceID    *string         `json:"workspaceId"`
	Categories     []string        `json:"categories"`
	Tags           []string        `json:"tags"`
	Style          StyleDescriptor `json:"style"`
	Format         map[string]any  `json:"format"`
	PageCount      int             `json:"pageCount"`
	PreviewURLs    []string        `json:"previewUrls"`
	DesignFileKey  string          `json:"designFileKey"`
	FillableFields []any           `json:"fillableFields"`
	Attributions   []any           `json:"attributions"`
	Version        int             `json:"version"`
	CreatedAt      string          `json:"createdAt"`
	UpdatedAt      string          `json:"updatedAt"`
	// CanDelete: the caller's role holds template.delete for it (on all, or on
	// own when they created it). Built-in templates are never deletable.
	CanDelete bool `json:"canDelete,omitempty"`
	// CanRename and CanEdit: the caller's role holds template.rename or
	// template.edit for this template (on all, or on own when they created
	// it). Never on built-ins.
	CanRename bool `json:"canRename,omitempty"`
	CanEdit   bool `json:"canEdit,omitempty"`
	// LastInWorkspace: deleting it leaves its workspace without any template,
	// which ends that workspace's "publishes templates" standing for template
	// protection. Set only together with CanDelete.
	LastInWorkspace bool `json:"lastInWorkspace,omitempty"`
}

// TemplateQuery is the search query.
type TemplateQuery struct {
	Text        string
	Color       string
	Categories  []string
	Scope       string // personal|team|public|all
	WorkspaceID *string
}

// seedEntry is one embedded seed template (template + its design file).
type seedEntry struct {
	Template json.RawMessage `json:"template"`
	File     json.RawMessage `json:"file"`
}

var seedEntries = func() []seedEntry {
	var out []seedEntry
	_ = json.Unmarshal(seedJSON, &out)
	return out
}()

// seedTemplate returns the parsed Template view for a seed entry.
func (e seedEntry) toTemplate() Template {
	var t Template
	_ = json.Unmarshal(e.Template, &t)
	return t
}

func findSeed(id string) (*seedEntry, bool) {
	for i := range seedEntries {
		var meta struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(seedEntries[i].Template, &meta)
		if meta.ID == id {
			return &seedEntries[i], true
		}
	}
	return nil, false
}

// Access enforces workspace membership + lists the caller's workspaces.
type Access interface {
	AssertMember(ctx context.Context, userID, workspaceID, minRole string) error
	Require(ctx context.Context, userID, workspaceID string, a authz.Action, creatorID string) error
	MemberWorkspaceIDs(ctx context.Context, userID string) ([]string, error)
}

// Persistence creates designs (apply) and loads files (save-as). It returns
// primitives so a thin adapter over the persistence service can satisfy it.
type Persistence interface {
	CreateDesign(ctx context.Context, workspaceID, title string, from map[string]any, authorID *string) (designID string, err error)
	GetWorkspaceID(ctx context.Context, designID string) (string, error)
	LoadDesignFile(ctx context.Context, designID, workspaceID string) (file map[string]any, err error)
}

// Service is the templates module.
type Service struct {
	db      DBTX
	access  Access
	persist Persistence
	// noBuiltins hides the embedded starter templates from listings
	// (BUILTIN_TEMPLATES=off), for instances that only want their own.
	noBuiltins bool
}

// HideBuiltins removes the embedded starter templates from template listings.
// They stay resolvable by id, so designs and links made from one still work.
func (s *Service) HideBuiltins() { s.noBuiltins = true }

// NewService wires the templates service.
func NewService(db DBTX, access Access, persist Persistence) *Service {
	return &Service{db: db, access: access, persist: persist}
}

// --- visibility mapping --------------------------------------------------

// toOcVisibility maps the DB scope (private|workspace|public) to the search
// scope (personal|team|public).
func toOcVisibility(v string) string {
	switch v {
	case "workspace":
		return "team"
	case "private":
		return "personal"
	default:
		return "public"
	}
}

func rowToTemplate(r TemplateRow) Template {
	var style StyleDescriptor
	if len(r.Style) > 0 {
		_ = json.Unmarshal(r.Style, &style)
	}
	if style.Palette == nil {
		style.Palette = []string{}
	}
	var file map[string]any
	_ = json.Unmarshal(r.File, &file)
	pages := asArr(file["pages"])
	w, h := 0.0, 0.0
	if len(pages) > 0 {
		p := asObj(pages[0])
		w, h = asNum(p["width"]), asNum(p["height"])
	}
	cats := []string{}
	if r.Category != nil && *r.Category != "" {
		cats = []string{*r.Category}
	}
	previews := []string{}
	if r.Thumbnail != nil && *r.Thumbnail != "" {
		previews = []string{*r.Thumbnail}
	}
	fillable := []any{}
	if len(r.FillableFields) > 0 {
		_ = json.Unmarshal(r.FillableFields, &fillable)
	}
	attrs := []any{}
	if len(r.Attributions) > 0 {
		_ = json.Unmarshal(r.Attributions, &attrs)
	}
	return Template{
		ID: r.ID, Title: r.Title, Visibility: toOcVisibility(r.Visibility), OwnerID: r.OwnerID,
		WorkspaceID: r.WorkspaceID, Categories: cats, Tags: r.Tags, Style: style,
		Format:    map[string]any{"width": w, "height": h, "unit": "px"},
		PageCount: len(pages), PreviewURLs: previews, DesignFileKey: "db:" + r.ID,
		FillableFields: fillable, Attributions: attrs, Version: 1,
		CreatedAt: r.CreatedAt.UTC().Format(isoFmt), UpdatedAt: r.UpdatedAt.UTC().Format(isoFmt),
	}
}

// --- list / get (FR-2) ---------------------------------------------------

// List returns built-in + DB templates the caller may see, filtered/ranked.
func (s *Service) List(ctx context.Context, userID string, q TemplateQuery, workspaceID, collectionID string) ([]Template, error) {
	memberWS, err := s.access.MemberWorkspaceIDs(ctx, userID)
	if err != nil {
		return nil, err
	}
	if workspaceID != "" && !contains(memberWS, workspaceID) {
		if err := s.access.AssertMember(ctx, userID, workspaceID, "viewer"); err != nil {
			return nil, ErrForbidden
		}
		memberWS = append(memberWS, workspaceID)
	}
	rows, err := s.listRows(ctx, userID, memberWS, workspaceID, collectionID)
	if err != nil {
		return nil, err
	}
	// Present DB rows as public to the ranker (the repo already enforced scope),
	// then restore their true visibility in the response.
	var pool []Template
	trueVis := map[string]string{}
	deletable := s.deletableFlags(ctx, userID, rows)
	rights := map[string]bool{}
	for _, r := range rows {
		t := rowToTemplate(r)
		t.CanRename = s.mayChange(ctx, userID, r, authz.TemplateRename, rights)
		t.CanEdit = s.mayChange(ctx, userID, r, authz.TemplateEdit, rights)
		trueVis[t.ID] = t.Visibility
		t.Visibility = "public"
		t.WorkspaceID = nil
		if d, ok := deletable[t.ID]; ok {
			t.CanDelete, t.LastInWorkspace = true, d
		}
		pool = append(pool, t)
	}
	if collectionID == "" && !s.noBuiltins {
		for _, e := range seedEntries {
			pool = append(pool, e.toTemplate())
		}
	}
	q.Scope = "public"
	ranked := searchTemplates(pool, q)
	out := make([]Template, 0, len(ranked))
	for _, t := range ranked {
		if v, ok := trueVis[t.ID]; ok {
			t.Visibility = v
		}
		out = append(out, t)
	}
	return out, nil
}

// Get returns one template (seed or DB), membership-gated for DB rows.
func (s *Service) Get(ctx context.Context, userID, id string) (Template, error) {
	if seed, ok := findSeed(id); ok {
		return seed.toTemplate(), nil
	}
	row, err := s.getRow(ctx, id)
	if err != nil {
		return Template{}, err
	}
	if !s.canSee(ctx, userID, row) {
		return Template{}, ErrNotFound
	}
	return rowToTemplate(row), nil
}

// GetFile returns a template's design file (seed or DB).
func (s *Service) GetFile(ctx context.Context, userID, id string) (map[string]any, error) {
	if seed, ok := findSeed(id); ok {
		var f map[string]any
		_ = json.Unmarshal(seed.File, &f)
		return f, nil
	}
	row, err := s.getRow(ctx, id)
	if err != nil {
		return nil, err
	}
	if !s.canSee(ctx, userID, row) {
		return nil, ErrNotFound
	}
	var f map[string]any
	_ = json.Unmarshal(row.File, &f)
	return f, nil
}

// GetFillableFields returns a template's fillable fields (for bulk create).
func (s *Service) GetFillableFields(ctx context.Context, userID, id string) ([]any, error) {
	if seed, ok := findSeed(id); ok {
		return seed.toTemplate().FillableFields, nil
	}
	row, err := s.getRow(ctx, id)
	if err != nil {
		return nil, err
	}
	if !s.canSee(ctx, userID, row) {
		return nil, ErrNotFound
	}
	out := []any{}
	if len(row.FillableFields) > 0 {
		_ = json.Unmarshal(row.FillableFields, &out)
	}
	return out, nil
}

func (s *Service) canSee(ctx context.Context, userID string, row TemplateRow) bool {
	switch row.Visibility {
	case "public":
		return true
	case "private":
		return row.OwnerID == userID
	default: // workspace
		if row.WorkspaceID == nil {
			return false
		}
		ids, err := s.access.MemberWorkspaceIDs(ctx, userID)
		return err == nil && contains(ids, *row.WorkspaceID)
	}
}

// --- apply (FR-5) --------------------------------------------------------

// Apply deep-copies a template into a new design in the workspace.
func (s *Service) Apply(ctx context.Context, userID, templateID, workspaceID string) (string, error) {
	if err := s.access.Require(ctx, userID, workspaceID, authz.DesignCreate, ""); err != nil {
		return "", ErrForbidden
	}
	var file map[string]any
	var title string
	if seed, ok := findSeed(templateID); ok {
		_ = json.Unmarshal(seed.File, &file)
		title = seed.toTemplate().Title
	} else {
		row, err := s.getRow(ctx, templateID)
		if err != nil {
			return "", err
		}
		if !s.canSee(ctx, userID, row) {
			return "", ErrNotFound
		}
		_ = json.Unmarshal(row.File, &file)
		title = row.Title
	}
	applied, _ := deepCopyDesign(file)
	return s.persist.CreateDesign(ctx, workspaceID, title, applied, &userID)
}

// --- save-as-template (FR-9) ---------------------------------------------

// SaveInput is the save-as-template payload.
type SaveInput struct {
	WorkspaceID  string
	DesignID     string
	File         map[string]any
	Title        string
	Category     string
	Tags         []string
	Thumbnail    string
	Visibility   string // private|workspace|public
	CollectionID string
}

func (s *Service) SaveAsTemplate(ctx context.Context, userID string, in SaveInput) (Template, error) {
	if err := s.access.Require(ctx, userID, in.WorkspaceID, authz.TemplatePublish, ""); err != nil {
		return Template{}, ErrForbidden
	}
	var file map[string]any
	if in.DesignID != "" {
		dws, err := s.persist.GetWorkspaceID(ctx, in.DesignID)
		if err != nil {
			return Template{}, ErrNotFound
		}
		if err := s.access.AssertMember(ctx, userID, dws, "viewer"); err != nil {
			return Template{}, ErrForbidden
		}
		loaded, err := s.persist.LoadDesignFile(ctx, in.DesignID, dws)
		if err != nil {
			return Template{}, ErrNotFound
		}
		file = loaded
	} else if in.File != nil {
		file = in.File
	} else {
		return Template{}, ErrBadRequest
	}
	if in.CollectionID != "" {
		col, err := s.getCollection(ctx, in.CollectionID)
		if err != nil || col.WorkspaceID != in.WorkspaceID {
			return Template{}, ErrBadRequest
		}
	}
	visibility := in.Visibility
	if visibility == "" {
		visibility = "private"
	}
	if visibility == "public" {
		// Visible to every user of the instance: its own action (F42).
		if err := s.access.Require(ctx, userID, in.WorkspaceID, authz.TemplatePublishPublic, ""); err != nil {
			return Template{}, ErrForbidden
		}
	}
	style, _ := json.Marshal(extractStyle(file))
	fileRaw, _ := json.Marshal(file)
	tags := in.Tags
	if tags == nil {
		if in.Category != "" {
			tags = []string{in.Category}
		} else {
			tags = []string{}
		}
	}
	// The workspace it was saved from, public ones too: its gallery lists it,
	// and the workspace's admins may file and delete it.
	ws := in.WorkspaceID
	wsPtr := &ws
	row, err := s.createRow(ctx, createTemplateInput{
		ownerID: userID, workspaceID: wsPtr, title: in.Title, category: nilIfEmpty(in.Category),
		tags: tags, file: fileRaw, thumbnail: nilIfEmpty(in.Thumbnail), visibility: visibility,
		collectionID: nilIfEmpty(in.CollectionID), style: style,
	})
	if err != nil {
		return Template{}, err
	}
	return rowToTemplate(row), nil
}

// --- duplicate -----------------------------------------------------------

// Duplicate makes a new template in the workspace from one the user can see,
// built-in ones too, and takes template.publish there: it creates a template.
// The copy is the user's. It keeps the design, category, tags, preview and
// credits, and the collection when it stays in the same workspace. A public
// template's copy is for the workspace, since going public has its own right.
func (s *Service) Duplicate(ctx context.Context, userID, id, workspaceID, title string) (Template, error) {
	if workspaceID == "" {
		return Template{}, ErrBadRequest
	}
	if err := s.access.Require(ctx, userID, workspaceID, authz.TemplatePublish, ""); err != nil {
		return Template{}, ErrForbidden
	}
	in := createTemplateInput{ownerID: userID, workspaceID: &workspaceID}
	var raw json.RawMessage
	var fallbackTitle string
	if seed, ok := findSeed(id); ok {
		t := seed.toTemplate()
		raw, fallbackTitle = seed.File, t.Title
		if len(t.Categories) > 0 {
			in.category = nilIfEmpty(t.Categories[0])
		}
		in.tags = t.Tags
		if len(t.PreviewURLs) > 0 {
			in.thumbnail = nilIfEmpty(t.PreviewURLs[0])
		}
		in.visibility = "workspace"
		if len(t.Attributions) > 0 {
			in.attribution, _ = json.Marshal(t.Attributions)
		}
	} else {
		row, err := s.getRow(ctx, id)
		if err != nil {
			return Template{}, err
		}
		if !s.canSee(ctx, userID, row) {
			return Template{}, ErrNotFound
		}
		raw, fallbackTitle = row.File, row.Title
		in.category, in.tags, in.thumbnail = row.Category, row.Tags, row.Thumbnail
		in.visibility = strings.ToLower(row.Visibility)
		if in.visibility == "public" {
			in.visibility = "workspace"
		}
		if row.WorkspaceID != nil && *row.WorkspaceID == workspaceID {
			in.collectionID = row.CollectionID
		}
		in.attribution = row.Attributions
	}
	title = strings.TrimSpace(title)
	if title == "" || utf8.RuneCountInString(title) > maxTitleRunes {
		title = fallbackTitle
	}
	in.title = title
	// Using a template regenerates its ids, so the copy keeps the file as it is
	// apart from the title, as a rename does.
	var file map[string]any
	if err := json.Unmarshal(raw, &file); err != nil {
		return Template{}, err
	}
	file["title"] = title
	var err error
	if in.file, err = json.Marshal(file); err != nil {
		return Template{}, err
	}
	in.style, _ = json.Marshal(extractStyle(file))
	row, err := s.createRow(ctx, in)
	if err != nil {
		return Template{}, err
	}
	return rowToTemplate(row), nil
}

// --- delete --------------------------------------------------------------

// mayChange reports whether a user's role in the template's workspace holds a
// scoped template action for this template: on all, or on own when they created
// it. Nothing is built in for the creator, so the right can be granted, taken
// or passed on in the roles like any other. A template without a workspace (no
// role can apply) stays its creator's. `seen` caches per workspace and scope.
func (s *Service) mayChange(ctx context.Context, userID string, row TemplateRow, a authz.Action, seen map[string]bool) bool {
	own := row.OwnerID == userID
	if row.WorkspaceID == nil {
		return own
	}
	key := string(a) + "|" + *row.WorkspaceID + "|" + strconv.FormatBool(own)
	ok, known := seen[key]
	if !known {
		ok = s.access.Require(ctx, userID, *row.WorkspaceID, a, row.OwnerID) == nil
		seen[key] = ok
	}
	return ok
}

// deletableFlags maps each row the caller may delete to whether it is the last
// template of its workspace.
func (s *Service) deletableFlags(ctx context.Context, userID string, rows []TemplateRow) map[string]bool {
	out := map[string]bool{}
	rights := map[string]bool{}
	counts := map[string]int{}
	for _, r := range rows {
		if !s.mayChange(ctx, userID, r, authz.TemplateDelete, rights) {
			continue
		}
		last := false
		if r.WorkspaceID != nil {
			ws := *r.WorkspaceID
			n, seen := counts[ws]
			if !seen {
				n, _ = s.countWorkspaceTemplates(ctx, ws)
				counts[ws] = n
			}
			last = n == 1
		}
		out[r.ID] = last
	}
	return out
}

// Delete removes a stored template. The template is a self-contained copy:
// its source design and every design made from it are untouched. Built-in
// templates cannot be deleted; a template the caller cannot see reads as not
// found, one they can see but may not delete as forbidden.
func (s *Service) Delete(ctx context.Context, userID, id string) error {
	if _, ok := findSeed(id); ok {
		return ErrForbidden
	}
	row, err := s.getRow(ctx, id)
	if err != nil {
		return err
	}
	if !s.canSee(ctx, userID, row) {
		return ErrNotFound
	}
	if !s.mayChange(ctx, userID, row, authz.TemplateDelete, map[string]bool{}) {
		return ErrForbidden
	}
	return s.deleteRow(ctx, id)
}

// maxTitleRunes bounds a template's name.
const maxTitleRunes = 200

// Rename changes a stored template's name, under template.rename. Built-in
// templates cannot be renamed, and designs already made from it keep their
// names. A template the caller cannot see reads as not found, one they can see
// but may not rename as forbidden.
func (s *Service) Rename(ctx context.Context, userID, id, title string) (Template, error) {
	title = strings.TrimSpace(title)
	if title == "" || utf8.RuneCountInString(title) > maxTitleRunes {
		return Template{}, ErrBadRequest
	}
	if _, ok := findSeed(id); ok {
		return Template{}, ErrForbidden
	}
	row, err := s.getRow(ctx, id)
	if err != nil {
		return Template{}, err
	}
	if !s.canSee(ctx, userID, row) {
		return Template{}, ErrNotFound
	}
	if !s.mayChange(ctx, userID, row, authz.TemplateRename, map[string]bool{}) {
		return Template{}, ErrForbidden
	}
	updated, err := s.setTitle(ctx, id, title)
	if err != nil {
		return Template{}, err
	}
	return rowToTemplate(updated), nil
}

// editableRow loads a stored template the user may edit. Built-in templates
// cannot be edited.
func (s *Service) editableRow(ctx context.Context, userID, id string) (TemplateRow, error) {
	if _, ok := findSeed(id); ok {
		return TemplateRow{}, ErrForbidden
	}
	row, err := s.getRow(ctx, id)
	if err != nil {
		return TemplateRow{}, err
	}
	if !s.canSee(ctx, userID, row) {
		return TemplateRow{}, ErrNotFound
	}
	if !s.mayChange(ctx, userID, row, authz.TemplateEdit, map[string]bool{}) {
		return TemplateRow{}, ErrForbidden
	}
	return row, nil
}

// StartEdit makes the working copy an edit happens on: an ordinary design of
// the template's workspace, created by the user, opened in the editor. The
// template itself stays as it is until SaveEdit.
func (s *Service) StartEdit(ctx context.Context, userID, id, title string) (string, error) {
	row, err := s.editableRow(ctx, userID, id)
	if err != nil {
		return "", err
	}
	if row.WorkspaceID == nil {
		return "", ErrBadRequest
	}
	// The working copy is theirs: saving it takes design.edit at least on own.
	if err := s.access.Require(ctx, userID, *row.WorkspaceID, authz.DesignEdit, userID); err != nil {
		return "", ErrForbidden
	}
	title = strings.TrimSpace(title)
	if title == "" || utf8.RuneCountInString(title) > maxTitleRunes {
		title = row.Title
	}
	var file map[string]any
	if err := json.Unmarshal(row.File, &file); err != nil {
		return "", err
	}
	working, _ := deepCopyDesign(file)
	return s.persist.CreateDesign(ctx, *row.WorkspaceID, title, working, &userID)
}

// SaveEdit replaces the template's design with the working copy's. Its id,
// name, collection and visibility stay; designs made from it are untouched.
func (s *Service) SaveEdit(ctx context.Context, userID, id, designID string) (Template, error) {
	row, err := s.editableRow(ctx, userID, id)
	if err != nil {
		return Template{}, err
	}
	if row.WorkspaceID == nil || designID == "" {
		return Template{}, ErrBadRequest
	}
	dws, err := s.persist.GetWorkspaceID(ctx, designID)
	if err != nil {
		return Template{}, ErrNotFound
	}
	if dws != *row.WorkspaceID {
		return Template{}, ErrBadRequest
	}
	if err := s.access.AssertMember(ctx, userID, dws, "viewer"); err != nil {
		return Template{}, ErrForbidden
	}
	file, err := s.persist.LoadDesignFile(ctx, designID, dws)
	if err != nil {
		return Template{}, ErrNotFound
	}
	if pages, ok := file["pages"].([]any); !ok || len(pages) == 0 {
		return Template{}, ErrBadRequest
	}
	file["title"] = row.Title
	style, _ := json.Marshal(extractStyle(file))
	raw, err := json.Marshal(file)
	if err != nil {
		return Template{}, err
	}
	updated, err := s.setFile(ctx, id, raw, style)
	if err != nil {
		return Template{}, err
	}
	return rowToTemplate(updated), nil
}

// --- collections (FR-3) --------------------------------------------------

// Collection is the API view of a template collection.
type Collection struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspaceId"`
	Name        string `json:"name"`
}

func (s *Service) CreateCollection(ctx context.Context, userID, workspaceID, name string) (Collection, error) {
	if err := s.access.Require(ctx, userID, workspaceID, authz.TemplateCollections, ""); err != nil {
		return Collection{}, ErrForbidden
	}
	row, err := s.createCollection(ctx, workspaceID, name)
	if err != nil {
		return Collection{}, err
	}
	return Collection{ID: row.ID, WorkspaceID: row.WorkspaceID, Name: row.Name}, nil
}

func (s *Service) ListCollections(ctx context.Context, userID, workspaceID string) ([]Collection, error) {
	if err := s.access.AssertMember(ctx, userID, workspaceID, "viewer"); err != nil {
		return nil, ErrForbidden
	}
	rows, err := s.listCollections(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	out := make([]Collection, 0, len(rows))
	for _, r := range rows {
		out = append(out, Collection{ID: r.ID, WorkspaceID: r.WorkspaceID, Name: r.Name})
	}
	return out, nil
}

func (s *Service) DeleteCollection(ctx context.Context, userID, id string) error {
	col, err := s.getCollection(ctx, id)
	if err != nil {
		return err
	}
	if err := s.access.Require(ctx, userID, col.WorkspaceID, authz.TemplateCollections, ""); err != nil {
		return ErrForbidden
	}
	return s.deleteCollection(ctx, id)
}

func (s *Service) AssignCollection(ctx context.Context, userID, templateID, collectionID string) (Template, error) {
	row, err := s.getRow(ctx, templateID)
	if err != nil {
		return Template{}, err
	}
	if row.WorkspaceID == nil {
		return Template{}, ErrBadRequest
	}
	if err := s.access.Require(ctx, userID, *row.WorkspaceID, authz.TemplateCollections, ""); err != nil {
		return Template{}, ErrForbidden
	}
	var colID *string
	if collectionID != "" {
		col, err := s.getCollection(ctx, collectionID)
		if err != nil || col.WorkspaceID != *row.WorkspaceID {
			return Template{}, ErrBadRequest
		}
		colID = &collectionID
	}
	updated, err := s.setCollection(ctx, templateID, colID)
	if err != nil {
		return Template{}, err
	}
	return rowToTemplate(updated), nil
}

// --- search (pure port of @hc/templates) ---------------------------------

func searchTemplates(templates []Template, q TemplateQuery) []Template {
	var matched []Template
	for _, t := range templates {
		if templateMatches(t, q) {
			matched = append(matched, t)
		}
	}
	if q.Text == "" {
		return matched
	}
	sort.SliceStable(matched, func(i, j int) bool {
		si, sj := textRelevance(matched[i], q.Text), textRelevance(matched[j], q.Text)
		if si != sj {
			return si > sj
		}
		return matched[i].Title < matched[j].Title
	})
	return matched
}

func templateMatches(t Template, q TemplateQuery) bool {
	if q.Text != "" && textRelevance(t, q.Text) == 0 {
		return false
	}
	if q.Color != "" && !colorMatches(t, q.Color) {
		return false
	}
	if len(q.Categories) > 0 {
		ok := false
		for _, c := range q.Categories {
			if contains(t.Categories, c) {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	return true
}

func textRelevance(t Template, q string) int {
	n := strings.ToLower(q)
	s := 0
	tl := strings.ToLower(t.Title)
	if tl == n {
		s += 100
	} else if strings.Contains(tl, n) {
		s += 50
	}
	for _, tag := range t.Tags {
		if strings.Contains(strings.ToLower(tag), n) {
			s += 8
		}
	}
	for _, c := range t.Categories {
		if strings.Contains(strings.ToLower(c), n) {
			s += 5
		}
	}
	return s
}

func colorMatches(t Template, hex string) bool {
	target, ok := hexToRGB(hex)
	if !ok {
		return false
	}
	for _, c := range t.Style.Palette {
		rgb, ok := hexToRGB(c)
		if !ok {
			continue
		}
		d := math.Sqrt(math.Pow(rgb[0]-target[0], 2) + math.Pow(rgb[1]-target[1], 2) + math.Pow(rgb[2]-target[2], 2))
		if d <= 70 {
			return true
		}
	}
	return false
}

func hexToRGB(hex string) ([3]float64, bool) {
	h := strings.TrimPrefix(hex, "#")
	if len(h) < 6 {
		return [3]float64{}, false
	}
	var r, g, b int
	if _, err := parseHex(h[0:2], &r); err != nil {
		return [3]float64{}, false
	}
	if _, err := parseHex(h[2:4], &g); err != nil {
		return [3]float64{}, false
	}
	if _, err := parseHex(h[4:6], &b); err != nil {
		return [3]float64{}, false
	}
	return [3]float64{float64(r), float64(g), float64(b)}, true
}

func parseHex(s string, out *int) (int, error) {
	v := 0
	for _, ch := range s {
		v <<= 4
		switch {
		case ch >= '0' && ch <= '9':
			v |= int(ch - '0')
		case ch >= 'a' && ch <= 'f':
			v |= int(ch-'a') + 10
		case ch >= 'A' && ch <= 'F':
			v |= int(ch-'A') + 10
		default:
			return 0, errors.New("bad hex")
		}
	}
	*out = v
	return v, nil
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// json accessors over the opaque DesignFile.
func asObj(v any) map[string]any { m, _ := v.(map[string]any); return m }
func asArr(v any) []any          { a, _ := v.([]any); return a }
func asNum(v any) float64        { f, _ := v.(float64); return f }
func asStr(v any) string         { s, _ := v.(string); return s }
