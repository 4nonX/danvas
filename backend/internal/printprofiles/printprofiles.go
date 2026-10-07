// Package printprofiles stores the ICC output profiles a workspace prints
// with. An admin uploads the CMYK profile their print shop works to (e.g. PSO
// Coated v3 / FOGRA51); CMYK exports convert through it and embed it.
//
// Profiles are uploaded rather than shipped because the common coated
// profiles may be used and embedded freely but not redistributed. The bytes
// live in the "print_profiles" row so they travel with database backups.
package printprofiles

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	// ErrForbidden: not a member at the required role.
	ErrForbidden = errors.New("forbidden")
	// ErrNotFound: no such profile in the workspace.
	ErrNotFound = errors.New("not found")
	// ErrInvalid: bad name.
	ErrInvalid = errors.New("invalid request")
	// ErrDuplicate: the same file is already uploaded to the workspace.
	ErrDuplicate = errors.New("duplicate profile")
)

const maxName = 120

// DBTX is the data surface (satisfied by *pgxpool.Pool).
type DBTX interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Access is the membership check (satisfied by *accounts.Service).
type Access interface {
	AssertMember(ctx context.Context, userID, workspaceID, minRole string) error
}

// Profile is the JSON shape of one profile (without its bytes).
type Profile struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspaceId"`
	Name        string `json:"name"`
	Description string `json:"description"`
	ColorSpace  string `json:"colorSpace"`
	ICCVersion  string `json:"iccVersion"`
	SizeBytes   int    `json:"sizeBytes"`
	IsDefault   bool   `json:"isDefault"`
	CreatedAt   string `json:"createdAt"`
}

type Service struct {
	db     DBTX
	access Access
}

func NewService(db DBTX, access Access) *Service { return &Service{db: db, access: access} }

func (s *Service) member(ctx context.Context, userID, workspaceID, role string) error {
	if _, err := uuid.Parse(workspaceID); err != nil {
		return ErrNotFound
	}
	if err := s.access.AssertMember(ctx, userID, workspaceID, role); err != nil {
		return ErrForbidden
	}
	return nil
}

const cols = `"id", "workspace_id", "name", "description", "color_space", "icc_version", "size_bytes", "is_default", "created_at"`

func scan(row pgx.Row) (Profile, error) {
	var p Profile
	var created time.Time
	err := row.Scan(&p.ID, &p.WorkspaceID, &p.Name, &p.Description, &p.ColorSpace, &p.ICCVersion, &p.SizeBytes, &p.IsDefault, &created)
	p.CreatedAt = created.UTC().Format(time.RFC3339)
	return p, err
}

// List returns the workspace's profiles, default first. Any member may list
// and use them (exporting is not an admin task).
func (s *Service) List(ctx context.Context, userID, workspaceID string) ([]Profile, error) {
	if err := s.member(ctx, userID, workspaceID, "viewer"); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `SELECT `+cols+` FROM "print_profiles" WHERE "workspace_id" = $1 ORDER BY "is_default" DESC, "name"`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Profile{}
	for rows.Next() {
		p, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// Create stores an uploaded profile (admins). The first profile of a
// workspace becomes its default.
func (s *Service) Create(ctx context.Context, userID, workspaceID, name string, data []byte) (Profile, error) {
	if err := s.member(ctx, userID, workspaceID, "admin"); err != nil {
		return Profile{}, err
	}
	h, err := ParseICC(data)
	if err != nil {
		return Profile{}, err
	}
	n := strings.TrimSpace(name)
	if n == "" {
		n = h.Description
	}
	if n == "" {
		n = "CMYK profile"
	}
	if len([]rune(n)) > maxName {
		return Profile{}, ErrInvalid
	}
	sum := sha256.Sum256(data)
	row := s.db.QueryRow(ctx, `INSERT INTO "print_profiles"
		("workspace_id", "name", "description", "color_space", "icc_version", "size_bytes", "checksum", "data", "is_default", "created_by_id")
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
		        NOT EXISTS (SELECT 1 FROM "print_profiles" WHERE "workspace_id" = $1), $9)
		ON CONFLICT ("workspace_id", "checksum") DO NOTHING
		RETURNING `+cols,
		workspaceID, n, h.Description, h.ColorSpace, h.Version, len(data), hex.EncodeToString(sum[:]), data, nullableUUID(userID))
	p, err := scan(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Profile{}, ErrDuplicate
	}
	return p, err
}

func nullableUUID(id string) any {
	if _, err := uuid.Parse(id); err != nil {
		return nil
	}
	return id
}

func (s *Service) workspaceOf(ctx context.Context, id string) (string, error) {
	if _, err := uuid.Parse(id); err != nil {
		return "", ErrNotFound
	}
	var ws string
	err := s.db.QueryRow(ctx, `SELECT "workspace_id" FROM "print_profiles" WHERE "id" = $1`, id).Scan(&ws)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return ws, err
}

// Update renames a profile and/or makes it the workspace default (admins).
func (s *Service) Update(ctx context.Context, userID, id string, name *string, makeDefault bool) error {
	ws, err := s.workspaceOf(ctx, id)
	if err != nil {
		return err
	}
	if err := s.member(ctx, userID, ws, "admin"); err != nil {
		return err
	}
	if name != nil {
		n := strings.TrimSpace(*name)
		if n == "" || len([]rune(n)) > maxName {
			return ErrInvalid
		}
		if _, err := s.db.Exec(ctx, `UPDATE "print_profiles" SET "name" = $2 WHERE "id" = $1`, id, n); err != nil {
			return err
		}
	}
	if makeDefault {
		// One statement, so a workspace never has two defaults.
		if _, err := s.db.Exec(ctx, `UPDATE "print_profiles" SET "is_default" = ("id" = $1) WHERE "workspace_id" = $2`, id, ws); err != nil {
			return err
		}
	}
	return nil
}

// Delete removes a profile (admins). Exports already made keep their
// embedded copy; if it was the default, the oldest remaining one takes over.
func (s *Service) Delete(ctx context.Context, userID, id string) error {
	ws, err := s.workspaceOf(ctx, id)
	if err != nil {
		return err
	}
	if err := s.member(ctx, userID, ws, "admin"); err != nil {
		return err
	}
	if _, err := s.db.Exec(ctx, `DELETE FROM "print_profiles" WHERE "id" = $1`, id); err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `UPDATE "print_profiles" SET "is_default" = true
		WHERE "id" = (SELECT "id" FROM "print_profiles" WHERE "workspace_id" = $1 ORDER BY "created_at" LIMIT 1)
		  AND NOT EXISTS (SELECT 1 FROM "print_profiles" WHERE "workspace_id" = $1 AND "is_default")`, ws)
	return err
}

// Data returns a profile's bytes for any member (exports run in the browser).
func (s *Service) Data(ctx context.Context, userID, id string) ([]byte, string, error) {
	ws, err := s.workspaceOf(ctx, id)
	if err != nil {
		return nil, "", err
	}
	if err := s.member(ctx, userID, ws, "viewer"); err != nil {
		return nil, "", err
	}
	var data []byte
	var checksum string
	if err := s.db.QueryRow(ctx, `SELECT "data", "checksum" FROM "print_profiles" WHERE "id" = $1`, id).Scan(&data, &checksum); err != nil {
		return nil, "", err
	}
	return data, checksum, nil
}
