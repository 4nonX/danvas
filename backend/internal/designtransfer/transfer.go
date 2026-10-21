// Package designtransfer copies or moves designs (and whole folders of them)
// to another workspace, or copies them to a folder of their own workspace.
//
// A design points at workspace data: its uploads (images, masks, video and
// audio clips, logos), the workspace's font library by family name, and the
// workspace's brand kit. A copy that kept pointing at the source would show
// in the browser (asset content is public) but fail to export, since the
// renderers only read assets of the design's own workspace, and it would
// break the day the source deletes an upload. So the transfer copies every
// upload the design uses into the target and rewrites the references, brings
// the font families it uses along (when the user may add fonts there), and
// drops a brand kit assignment the target does not have.
//
// Moving is copying followed by moving the original to the trash, so it can
// be restored from there. Version history, comments and share links stay
// with the original.
//
// Within one workspace the uploads, fonts and brand kit are already the
// target's: a copy keeps pointing at them, and moving is the ordinary move to
// a folder.
package designtransfer

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"hycanvas/backend/internal/home"
	"hycanvas/backend/internal/persistence"
	"hycanvas/backend/internal/uploads"
)

var (
	ErrForbidden  = errors.New("designtransfer: forbidden")
	ErrBadRequest = errors.New("designtransfer: bad request")
)

// MaxItems bounds one transfer (designs, including those inside folders).
const MaxItems = 500

type DBTX interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

type Access interface {
	AssertMember(ctx context.Context, userID, workspaceID, minRole string) error
}

type Designs interface {
	GetWorkspaceID(ctx context.Context, designID string) (string, error)
	LoadFile(ctx context.Context, designID, workspaceID string) (persistence.LoadResult, error)
	Create(ctx context.Context, workspaceID, title string, from persistence.DesignFile, authorID *string) (persistence.DesignRecord, error)
	SoftDelete(ctx context.Context, designID, workspaceID string) error
}

type Assets interface {
	InWorkspace(ctx context.Context, workspaceID string, ids []string) (map[string]bool, error)
	CopyToWorkspace(ctx context.Context, userID, srcWS, assetID, dstWS string) (uploads.UploadedAsset, error)
}

type Fonts interface {
	CopyFamilies(ctx context.Context, userID, srcWS, dstWS string, families []string) ([]string, error)
}

type Folders interface {
	ListFolders(ctx context.Context, userID, workspaceID string) ([]home.Folder, error)
	CreateFolder(ctx context.Context, userID, workspaceID, name string, parentID *string) (home.Folder, error)
	Move(ctx context.Context, userID, workspaceID string, designIDs, folderIDs []string, target *string) error
	DeleteFolder(ctx context.Context, userID, id string) error
}

type Service struct {
	db      DBTX
	access  Access
	designs Designs
	assets  Assets
	fonts   Fonts
	folders Folders
}

func NewService(db DBTX, access Access, designs Designs, assets Assets, fonts Fonts, folders Folders) *Service {
	return &Service{db: db, access: access, designs: designs, assets: assets, fonts: fonts, folders: folders}
}

// Input is one transfer request.
type Input struct {
	DesignIDs         []string `json:"designIds"`
	FolderIDs         []string `json:"folderIds"`
	TargetWorkspaceID string   `json:"targetWorkspaceId"`
	// TargetFolderID places the designs (and the copied folders) in a folder
	// of the target; empty is the top level.
	TargetFolderID *string `json:"targetFolderId"`
	// Move puts the originals in the trash once copied.
	Move bool `json:"move"`
}

// Item is the outcome for one design.
type Item struct {
	SourceID string `json:"sourceId"`
	Title    string `json:"title"`
	NewID    string `json:"newId,omitempty"`
	Error    string `json:"error,omitempty"`
}

// Result is what the job reports.
type Result struct {
	Designs []Item `json:"designs"`
	Folders int    `json:"folders"`
	Assets  int    `json:"assets"`
	// MissingFonts are workspace font families the designs use that the
	// target lacks (the user may not add fonts there).
	MissingFonts []string `json:"missingFonts"`
	Moved        bool     `json:"moved"`
}

// Progress reports done of total designs.
type Progress func(done, total int)

type work struct {
	designID string
	folder   *string // target folder
}

// Prepare checks the request and resolves the source workspace, so the
// handler can refuse at once instead of starting a job that fails.
func (s *Service) Prepare(ctx context.Context, userID string, in Input) (string, error) {
	if in.TargetWorkspaceID == "" || len(in.DesignIDs)+len(in.FolderIDs) == 0 {
		return "", ErrBadRequest
	}
	if s.access.AssertMember(ctx, userID, in.TargetWorkspaceID, "member") != nil {
		return "", ErrForbidden
	}
	src := ""
	same := func(ws string) error {
		if src == "" {
			src = ws
		}
		if ws != src {
			return ErrBadRequest // one source workspace per transfer
		}
		return nil
	}
	for _, id := range in.DesignIDs {
		ws, err := s.designs.GetWorkspaceID(ctx, id)
		if err != nil {
			return "", ErrBadRequest
		}
		if err := same(ws); err != nil {
			return "", err
		}
	}
	for _, id := range in.FolderIDs {
		var ws string
		if err := s.db.QueryRow(ctx, `SELECT "workspace_id"::text FROM "projects" WHERE id::text = $1`, id).Scan(&ws); err != nil {
			return "", ErrBadRequest
		}
		if err := same(ws); err != nil {
			return "", err
		}
	}
	// Moving changes the source (its designs go to the trash): members only.
	// A copy needs to read it: viewers too.
	role := "viewer"
	if in.Move {
		role = "member"
	}
	if s.access.AssertMember(ctx, userID, src, role) != nil {
		return "", ErrForbidden
	}
	if in.TargetFolderID != nil && *in.TargetFolderID != "" {
		var ws string
		if err := s.db.QueryRow(ctx, `SELECT "workspace_id"::text FROM "projects" WHERE id::text = $1`, *in.TargetFolderID).Scan(&ws); err != nil || ws != in.TargetWorkspaceID {
			return "", ErrBadRequest
		}
	}
	return src, nil
}

// Transfer runs a prepared request. Each design succeeds or fails on its own;
// a failed design is reported and left untouched in the source.
func (s *Service) Transfer(ctx context.Context, userID, src string, in Input, progress Progress) (Result, error) {
	res := Result{Designs: []Item{}, MissingFonts: []string{}, Moved: in.Move}
	var target *string
	if in.TargetFolderID != nil && *in.TargetFolderID != "" {
		target = in.TargetFolderID
	}
	same := src == in.TargetWorkspaceID
	if same && in.Move {
		return s.moveWithin(ctx, userID, src, in, target, progress)
	}

	// The work list: the selected designs into the target folder, and each
	// selected folder recreated there with everything inside it.
	var list []work
	seen := map[string]bool{}
	add := func(id string, folder *string) {
		if !seen[id] {
			seen[id] = true
			list = append(list, work{designID: id, folder: folder})
		}
	}
	for _, id := range in.DesignIDs {
		add(id, target)
	}
	var copiedFolders []string // source folders, children before parents
	if len(in.FolderIDs) > 0 {
		all, err := s.folders.ListFolders(ctx, userID, src)
		if err != nil {
			return res, err
		}
		children := map[string][]home.Folder{}
		byID := map[string]home.Folder{}
		for _, f := range all {
			byID[f.ID] = f
			if f.ParentID != nil {
				children[*f.ParentID] = append(children[*f.ParentID], f)
			}
		}
		var copyFolder func(f home.Folder, parent *string) error
		copyFolder = func(f home.Folder, parent *string) error {
			nf, err := s.folders.CreateFolder(ctx, userID, in.TargetWorkspaceID, f.Name, parent)
			if err != nil {
				return err
			}
			res.Folders++
			ids, err := s.designsIn(ctx, src, f.ID)
			if err != nil {
				return err
			}
			for _, id := range ids {
				add(id, &nf.ID)
			}
			for _, c := range children[f.ID] {
				if err := copyFolder(c, &nf.ID); err != nil {
					return err
				}
			}
			copiedFolders = append(copiedFolders, f.ID)
			return nil
		}
		// A selected folder inside another selected folder comes along with
		// its parent.
		selected := map[string]bool{}
		for _, id := range in.FolderIDs {
			selected[id] = true
		}
		for _, id := range in.FolderIDs {
			f, ok := byID[id]
			if !ok {
				return res, ErrBadRequest
			}
			inside := false
			for p := f.ParentID; p != nil; {
				if selected[*p] {
					inside = true
					break
				}
				pf, ok := byID[*p]
				if !ok {
					break
				}
				p = pf.ParentID
			}
			if inside {
				continue
			}
			if err := copyFolder(f, target); err != nil {
				return res, err
			}
		}
	}
	if len(list) > MaxItems {
		return res, ErrBadRequest
	}

	// Load every design first: the fonts they use are brought over before
	// any of them lands in the target.
	files := make([]persistence.LoadResult, len(list))
	loadErr := make([]error, len(list))
	families := map[string]bool{}
	for i, w := range list {
		files[i], loadErr[i] = s.designs.LoadFile(ctx, w.designID, src)
		if loadErr[i] == nil {
			collectFamilies(map[string]any(files[i].File), families)
		}
	}
	if len(families) > 0 && s.fonts != nil && !same {
		names := make([]string, 0, len(families))
		for f := range families {
			names = append(names, f)
		}
		missing, err := s.fonts.CopyFamilies(ctx, userID, src, in.TargetWorkspaceID, names)
		if err == nil && missing != nil {
			res.MissingFonts = missing
		}
	}

	copied := map[string]string{} // source asset id -> target asset id, across designs
	for i, w := range list {
		item := Item{SourceID: w.designID}
		if loadErr[i] != nil {
			item.Error = "load_failed"
			res.Designs = append(res.Designs, item)
			progress(i+1, len(list))
			continue
		}
		rec, file := files[i].Record, files[i].File
		item.Title = rec.Title
		newID, n, err := s.transferOne(ctx, userID, src, in.TargetWorkspaceID, rec.Title, file, copied)
		res.Assets += n
		if err != nil {
			item.Error = errorCode(err)
			res.Designs = append(res.Designs, item)
			progress(i+1, len(list))
			continue
		}
		item.NewID = newID
		if w.folder != nil {
			if err := s.folders.Move(ctx, userID, in.TargetWorkspaceID, []string{newID}, nil, w.folder); err != nil {
				item.Error = "folder_failed" // the copy exists, at the top level
			}
		}
		if in.Move && item.Error == "" {
			if err := s.designs.SoftDelete(ctx, w.designID, src); err != nil {
				item.Error = "source_kept"
			}
		}
		res.Designs = append(res.Designs, item)
		progress(i+1, len(list))
	}

	// Moving whole folders: the emptied source folders go too (children
	// first). A folder that still holds a design, because one failed, stays.
	if in.Move {
		for _, id := range copiedFolders {
			var live int
			if err := s.db.QueryRow(ctx, `SELECT
				(SELECT count(*) FROM "designs" WHERE "project_id"::text = $1 AND "deleted_at" IS NULL) +
				(SELECT count(*) FROM "projects" WHERE "parent_id"::text = $1)`, id).Scan(&live); err == nil && live == 0 {
				_ = s.folders.DeleteFolder(ctx, userID, id)
			}
		}
	}
	return res, nil
}

// transferOne copies one design's uploads and the design itself into dst and
// returns the new design's id and how many uploads were copied.
func (s *Service) transferOne(ctx context.Context, userID, src, dst, title string, file persistence.DesignFile, copied map[string]string) (string, int, error) {
	ids := map[string]bool{}
	collectUUIDs(map[string]any(file), ids)
	cand := make([]string, 0, len(ids))
	for id := range ids {
		cand = append(cand, id)
	}
	// Within one workspace the copy uses the same uploads.
	owned := map[string]bool{}
	if src != dst {
		var err error
		if owned, err = s.assets.InWorkspace(ctx, src, cand); err != nil {
			return "", 0, err
		}
	}
	n := 0
	mapping := map[string]string{}
	for id := range owned {
		if to, ok := copied[id]; ok {
			mapping[id] = to
			continue
		}
		a, err := s.assets.CopyToWorkspace(ctx, userID, src, id, dst)
		if err != nil {
			return "", n, err
		}
		copied[id] = a.ID
		mapping[id] = a.ID
		n++
	}
	out := rewrite(map[string]any(file), mapping).(map[string]any)
	s.dropForeignBrand(ctx, out, dst)
	rec, err := s.designs.Create(ctx, dst, title, persistence.DesignFile(out), &userID)
	if err != nil {
		return "", n, err
	}
	return rec.ID, n, nil
}

// moveWithin moves designs and folders to a folder of their own workspace:
// the ordinary folder move (which refuses a folder into its own subtree).
func (s *Service) moveWithin(ctx context.Context, userID, ws string, in Input, target *string, progress Progress) (Result, error) {
	res := Result{Designs: []Item{}, MissingFonts: []string{}, Moved: true, Folders: len(in.FolderIDs)}
	if err := s.folders.Move(ctx, userID, ws, in.DesignIDs, in.FolderIDs, target); err != nil {
		return res, err
	}
	for _, id := range in.DesignIDs {
		item := Item{SourceID: id, NewID: id}
		_ = s.db.QueryRow(ctx, `SELECT "title" FROM "designs" WHERE id::text = $1`, id).Scan(&item.Title)
		res.Designs = append(res.Designs, item)
	}
	progress(1, 1)
	return res, nil
}

// designsIn lists the live designs directly inside a folder.
func (s *Service) designsIn(ctx context.Context, ws, folderID string) ([]string, error) {
	rows, err := s.db.Query(ctx, `SELECT id::text FROM "designs" WHERE "workspace_id"::text = $1 AND "project_id"::text = $2 AND "deleted_at" IS NULL ORDER BY "created_at"`, ws, folderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// dropForeignBrand removes a brand kit assignment (and its version pin) the
// target workspace does not have; the design then follows the target's
// default kit, as any design without an assignment does.
func (s *Service) dropForeignBrand(ctx context.Context, file map[string]any, dst string) {
	meta, ok := file["meta"].(map[string]any)
	if !ok {
		return
	}
	kit, _ := meta["brandKitId"].(string)
	if kit == "" {
		return
	}
	var one int
	err := s.db.QueryRow(ctx, `SELECT 1 FROM "brand_kits" WHERE id::text = $1 AND "workspace_id"::text = $2`, kit, dst).Scan(&one)
	if err == nil {
		return
	}
	delete(meta, "brandKitId")
	delete(meta, "brandKitVersion")
	delete(meta, "brandReviewedVersion")
}

func errorCode(err error) string {
	switch {
	case errors.Is(err, uploads.ErrQuota), errors.Is(err, uploads.ErrUserQuota):
		return "quota"
	case errors.Is(err, uploads.ErrForbidden), errors.Is(err, ErrForbidden):
		return "forbidden"
	default:
		return "failed"
	}
}

var uuidRe = regexp.MustCompile(`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`)

// collectUUIDs gathers every UUID anywhere in the file's strings: asset ids
// as node references and inside asset URLs. Which of them are uploads is
// decided against the asset table, so ids of anything else are ignored.
func collectUUIDs(v any, out map[string]bool) {
	switch t := v.(type) {
	case map[string]any:
		for _, x := range t {
			collectUUIDs(x, out)
		}
	case []any:
		for _, x := range t {
			collectUUIDs(x, out)
		}
	case string:
		// Data URLs (embedded fonts and images) are large and hold no
		// references.
		if strings.HasPrefix(t, "data:") {
			return
		}
		for _, m := range uuidRe.FindAllString(t, -1) {
			out[strings.ToLower(m)] = true
		}
	}
}

// rewrite returns a copy of v with every occurrence of a mapped id replaced.
func rewrite(v any, mapping map[string]string) any {
	switch t := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, x := range t {
			out[k] = rewrite(x, mapping)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, x := range t {
			out[i] = rewrite(x, mapping)
		}
		return out
	case string:
		if len(mapping) == 0 || strings.HasPrefix(t, "data:") {
			return t
		}
		return uuidRe.ReplaceAllStringFunc(t, func(m string) string {
			if to, ok := mapping[strings.ToLower(m)]; ok {
				return to
			}
			return m
		})
	default:
		return v
	}
}

// collectFamilies gathers the font family names the file uses.
func collectFamilies(v any, out map[string]bool) {
	switch t := v.(type) {
	case map[string]any:
		for k, x := range t {
			if k == "fontFamily" {
				if s, ok := x.(string); ok && strings.TrimSpace(s) != "" {
					out[strings.TrimSpace(s)] = true
				}
				continue
			}
			collectFamilies(x, out)
		}
	case []any:
		for _, x := range t {
			collectFamilies(x, out)
		}
	}
}
