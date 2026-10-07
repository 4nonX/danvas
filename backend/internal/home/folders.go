// Design folders: a nested folder tree per workspace for organizing designs on
// the dashboard. Folders live in the "projects" table (id, workspace_id,
// parent_id, name, created_by_id, created_at) and a design points at its folder
// through designs.project_id; a NULL parent or project means the workspace
// root. Both columns predate this code, so no migration is needed.
//
// Deleting a folder never deletes designs: its designs and subfolders move up
// to the deleted folder's parent in one transaction.
package home

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var (
	// ErrForbidden: the caller is not a member of the folder's workspace at the
	// required role.
	ErrForbidden = errors.New("forbidden")
	// ErrNotFound: no such folder (or design) in the workspace.
	ErrNotFound = errors.New("not found")
	// ErrInvalid: a bad name, a cross-workspace reference, or a move that would
	// put a folder inside itself.
	ErrInvalid = errors.New("invalid request")
)

// maxFolderName bounds a folder name; longer names are rejected, not cut.
const maxFolderName = 120

// Folder is the JSON shape of one design folder.
type Folder struct {
	ID          string  `json:"id"`
	WorkspaceID string  `json:"workspaceId"`
	ParentID    *string `json:"parentId"`
	Name        string  `json:"name"`
	CreatedAt   string  `json:"createdAt"`
	// DesignCount counts the live (not trashed) designs directly inside.
	DesignCount int `json:"designCount"`
}

// Beginner opens a transaction (satisfied by *pgxpool.Pool). Folder deletes
// and bulk moves need one; when the pool does not provide it they fail rather
// than run half-applied.
type Beginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

func cleanName(name string) (string, error) {
	n := strings.TrimSpace(name)
	if n == "" || len([]rune(n)) > maxFolderName {
		return "", ErrInvalid
	}
	return n, nil
}

func (s *Service) member(ctx context.Context, userID, workspaceID, role string) error {
	if err := s.access.AssertMember(ctx, userID, workspaceID, role); err != nil {
		return ErrForbidden
	}
	return nil
}

// folderWorkspace returns the workspace a folder belongs to.
func (s *Service) folderWorkspace(ctx context.Context, id string) (string, error) {
	if _, err := uuid.Parse(id); err != nil {
		return "", ErrNotFound
	}
	var ws string
	err := s.db.QueryRow(ctx, `SELECT "workspace_id" FROM "projects" WHERE id = $1`, id).Scan(&ws)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return ws, err
}

// checkParent verifies parentID (when set) is a folder of workspaceID.
func (s *Service) checkParent(ctx context.Context, workspaceID string, parentID *string) error {
	if parentID == nil {
		return nil
	}
	ws, err := s.folderWorkspace(ctx, *parentID)
	if err != nil {
		return ErrInvalid
	}
	if ws != workspaceID {
		return ErrInvalid
	}
	return nil
}

// ListFolders returns every folder of the workspace (flat; the client builds
// the tree from parentId) with its direct live design count.
func (s *Service) ListFolders(ctx context.Context, userID, workspaceID string) ([]Folder, error) {
	if err := s.member(ctx, userID, workspaceID, "viewer"); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `SELECT p.id, p."workspace_id", p."parent_id", p.name, p."created_at",
		(SELECT count(*) FROM "designs" d WHERE d."project_id" = p.id AND d."deleted_at" IS NULL)
		FROM "projects" p WHERE p."workspace_id" = $1 ORDER BY lower(p.name), p.id`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Folder{}
	for rows.Next() {
		var (
			f       Folder
			created time.Time
		)
		if err := rows.Scan(&f.ID, &f.WorkspaceID, &f.ParentID, &f.Name, &created, &f.DesignCount); err != nil {
			return nil, err
		}
		f.CreatedAt = created.UTC().Format(time.RFC3339Nano)
		out = append(out, f)
	}
	return out, rows.Err()
}

// CreateFolder makes a folder under parentID (nil = workspace root).
func (s *Service) CreateFolder(ctx context.Context, userID, workspaceID, name string, parentID *string) (Folder, error) {
	if err := s.member(ctx, userID, workspaceID, "member"); err != nil {
		return Folder{}, err
	}
	n, err := cleanName(name)
	if err != nil {
		return Folder{}, err
	}
	if err := s.checkParent(ctx, workspaceID, parentID); err != nil {
		return Folder{}, err
	}
	f := Folder{ID: uuid.NewString(), WorkspaceID: workspaceID, ParentID: parentID, Name: n}
	var created time.Time
	err = s.db.QueryRow(ctx, `INSERT INTO "projects" (id, "workspace_id", "parent_id", name, "created_by_id")
		VALUES ($1, $2, $3, $4, $5) RETURNING "created_at"`, f.ID, workspaceID, parentID, n, userID).Scan(&created)
	if err != nil {
		return Folder{}, err
	}
	f.CreatedAt = created.UTC().Format(time.RFC3339Nano)
	return f, nil
}

// UpdateFolder renames a folder and/or moves it under another parent. A nil
// name leaves the name; moveParent=false leaves the parent; moveParent=true
// with a nil parentID moves it to the workspace root.
func (s *Service) UpdateFolder(ctx context.Context, userID, id string, name *string, moveParent bool, parentID *string) error {
	ws, err := s.folderWorkspace(ctx, id)
	if err != nil {
		return err
	}
	if err := s.member(ctx, userID, ws, "member"); err != nil {
		return err
	}
	if name != nil {
		n, err := cleanName(*name)
		if err != nil {
			return err
		}
		if _, err := s.db.Exec(ctx, `UPDATE "projects" SET name = $2 WHERE id = $1`, id, n); err != nil {
			return err
		}
	}
	if moveParent {
		if err := s.moveFolders(ctx, s.db, ws, []string{id}, parentID); err != nil {
			return err
		}
	}
	return nil
}

// moveFolders reparents folders, refusing any move that would put a folder
// inside itself or one of its descendants.
func (s *Service) moveFolders(ctx context.Context, q DBTX, workspaceID string, ids []string, target *string) error {
	if len(ids) == 0 {
		return nil
	}
	if err := s.checkParent(ctx, workspaceID, target); err != nil {
		return err
	}
	if target != nil {
		// Walk up from the target; meeting a moved folder means a cycle.
		moving := map[string]bool{}
		for _, id := range ids {
			moving[id] = true
		}
		cur := target
		for depth := 0; cur != nil && depth < 1000; depth++ {
			if moving[*cur] {
				return ErrInvalid
			}
			var parent *string
			if err := q.QueryRow(ctx, `SELECT "parent_id" FROM "projects" WHERE id = $1`, *cur).Scan(&parent); err != nil {
				return err
			}
			cur = parent
		}
	}
	tag, err := q.Exec(ctx, `UPDATE "projects" SET "parent_id" = $3 WHERE "workspace_id" = $1 AND id = ANY($2::uuid[])`, workspaceID, ids, target)
	if err != nil {
		return err
	}
	if int(tag.RowsAffected()) != len(ids) {
		return ErrNotFound
	}
	return nil
}

// Move puts designs and folders into target (nil = workspace root) as one
// step: either everything moves or nothing does.
func (s *Service) Move(ctx context.Context, userID, workspaceID string, designIDs, folderIDs []string, target *string) error {
	if err := s.member(ctx, userID, workspaceID, "member"); err != nil {
		return err
	}
	for _, id := range append(append([]string{}, designIDs...), folderIDs...) {
		if _, err := uuid.Parse(id); err != nil {
			return ErrInvalid
		}
	}
	if err := s.checkParent(ctx, workspaceID, target); err != nil {
		return err
	}
	b, ok := s.db.(Beginner)
	if !ok {
		return errors.New("folders: database does not support transactions")
	}
	tx, err := b.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if len(designIDs) > 0 {
		tag, err := tx.Exec(ctx, `UPDATE "designs" SET "project_id" = $3 WHERE "workspace_id" = $1 AND id = ANY($2::uuid[])`, workspaceID, designIDs, target)
		if err != nil {
			return err
		}
		if int(tag.RowsAffected()) != len(designIDs) {
			return ErrNotFound
		}
	}
	if err := s.moveFolders(ctx, tx, workspaceID, folderIDs, target); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// DeleteFolder removes one folder. Its designs (trashed ones included, so a
// restore lands somewhere that exists) and subfolders move to its parent.
func (s *Service) DeleteFolder(ctx context.Context, userID, id string) error {
	ws, err := s.folderWorkspace(ctx, id)
	if err != nil {
		return err
	}
	if err := s.member(ctx, userID, ws, "member"); err != nil {
		return err
	}
	b, ok := s.db.(Beginner)
	if !ok {
		return errors.New("folders: database does not support transactions")
	}
	tx, err := b.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var parent *string
	if err := tx.QueryRow(ctx, `SELECT "parent_id" FROM "projects" WHERE id = $1 FOR UPDATE`, id).Scan(&parent); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE "designs" SET "project_id" = $2 WHERE "project_id" = $1`, id, parent); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE "projects" SET "parent_id" = $2 WHERE "parent_id" = $1`, id, parent); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM "projects" WHERE id = $1`, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
