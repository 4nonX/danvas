// Folder print defaults (F44): a folder names the export profile and the
// print preset its designs open with. A folder without its own default uses
// the nearest folder above it that has one; only the workspace's own profiles
// qualify. Setting one takes the folder.defaults action (F42); everyone who
// can see the folder can read them.
package home

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"hycanvas/backend/internal/authz"
)

// DefaultKinds are the two kinds of profiles a folder can name.
var DefaultKinds = []string{"export", "print"}

// EffectiveDefault is the profile a folder's designs open with, and the
// folder it is set on (the folder itself or one above it).
type EffectiveDefault struct {
	ProfileID  string `json:"profileId"`
	FolderID   string `json:"folderId"`
	FolderName string `json:"folderName"`
}

// FolderDefaults is a folder's own defaults (kind to profile id) and what
// its designs actually open with.
type FolderDefaults struct {
	FolderID  string                       `json:"folderId"`
	Own       map[string]string            `json:"own"`
	Effective map[string]*EffectiveDefault `json:"effective"`
	CanEdit   bool                         `json:"canEdit"`
}

func validKind(kind string) bool {
	for _, k := range DefaultKinds {
		if k == kind {
			return true
		}
	}
	return false
}

// GetFolderDefaults returns the folder's own and effective defaults.
func (s *Service) GetFolderDefaults(ctx context.Context, userID, folderID string) (*FolderDefaults, error) {
	ws, err := s.folderWorkspace(ctx, folderID)
	if err != nil {
		return nil, err
	}
	if err := s.member(ctx, userID, ws, "viewer"); err != nil {
		return nil, err
	}
	out, err := s.resolveDefaults(ctx, folderID)
	if err != nil {
		return nil, err
	}
	out.CanEdit = s.access.Require(ctx, userID, ws, authz.FolderDefaults, "") == nil
	return out, nil
}

// resolveDefaults walks from the folder up to the root, the nearest default
// of each kind winning.
func (s *Service) resolveDefaults(ctx context.Context, folderID string) (*FolderDefaults, error) {
	rows, err := s.db.Query(ctx, `
		WITH RECURSIVE chain AS (
			SELECT id, "parent_id", name, 0 AS depth FROM "projects" WHERE id = $1
			UNION ALL
			SELECT p.id, p."parent_id", p.name, c.depth + 1 FROM "projects" p JOIN chain c ON p.id = c."parent_id" WHERE c.depth < 64
		)
		SELECT c.id::text, c.name, c.depth, d.kind, d."profile_id"::text
		FROM chain c JOIN "folder_export_defaults" d ON d."folder_id" = c.id
		ORDER BY c.depth`, folderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &FolderDefaults{FolderID: folderID, Own: map[string]string{}, Effective: map[string]*EffectiveDefault{}}
	for rows.Next() {
		var id, name, kind, profile string
		var depth int
		if err := rows.Scan(&id, &name, &depth, &kind, &profile); err != nil {
			return nil, err
		}
		if depth == 0 {
			out.Own[kind] = profile
		}
		if _, ok := out.Effective[kind]; !ok {
			out.Effective[kind] = &EffectiveDefault{ProfileID: profile, FolderID: id, FolderName: name}
		}
	}
	return out, rows.Err()
}

// SetFolderDefault sets (profileID non-nil) or clears a folder's default of
// one kind. The profile must be one of the folder's workspace, of that kind.
func (s *Service) SetFolderDefault(ctx context.Context, userID, folderID, kind string, profileID *string) (*FolderDefaults, error) {
	if !validKind(kind) {
		return nil, ErrInvalid
	}
	ws, err := s.folderWorkspace(ctx, folderID)
	if err != nil {
		return nil, err
	}
	if err := s.allow(ctx, userID, ws, authz.FolderDefaults, ""); err != nil {
		return nil, err
	}
	if profileID == nil {
		if _, err := s.db.Exec(ctx, `DELETE FROM "folder_export_defaults" WHERE "folder_id" = $1 AND kind = $2`, folderID, kind); err != nil {
			return nil, err
		}
	} else {
		if _, err := uuid.Parse(*profileID); err != nil {
			return nil, ErrInvalid
		}
		var pws *string
		var pkind string
		err := s.db.QueryRow(ctx, `SELECT "workspace_id"::text, kind FROM "export_profiles" WHERE id = $1`, *profileID).Scan(&pws, &pkind)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInvalid
		}
		if err != nil {
			return nil, err
		}
		// Personal profiles and other workspaces' are not shared with the folder's members.
		if pws == nil || *pws != ws || pkind != kind {
			return nil, ErrInvalid
		}
		if _, err := s.db.Exec(ctx, `
			INSERT INTO "folder_export_defaults" ("folder_id", kind, "profile_id", "updated_by", "updated_at")
			VALUES ($1, $2, $3, $4, now())
			ON CONFLICT ("folder_id", kind) DO UPDATE SET "profile_id" = EXCLUDED."profile_id", "updated_by" = EXCLUDED."updated_by", "updated_at" = now()`,
			folderID, kind, *profileID, userID); err != nil {
			return nil, err
		}
	}
	return s.GetFolderDefaults(ctx, userID, folderID)
}
