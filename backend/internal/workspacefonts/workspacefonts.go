// Package workspacefonts stores the font files a workspace uses: custom and
// licensed typefaces an admin uploads once, available in every design of the
// workspace (font pickers, brand kit) and embedded by the vector exports.
//
// One row per face; the faces sharing a family name make up a family. The
// bytes live in the "workspace_fonts" row so they travel with database
// backups.
package workspacefonts

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/authz"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	// ErrForbidden: not a member at the required role.
	ErrForbidden = errors.New("forbidden")
	// ErrNotFound: no such font in the workspace.
	ErrNotFound = errors.New("not found")
	// ErrInvalid: bad family name, weight or style.
	ErrInvalid = errors.New("invalid request")
	// ErrNotFont: the file is not a WOFF2/WOFF/TrueType/OpenType font.
	ErrNotFont = errors.New("not a font file")
	// ErrDuplicate: the same file is already uploaded to the workspace.
	ErrDuplicate = errors.New("duplicate font")
)

// MaxFontBytes bounds one uploaded face (large CJK fonts reach ~20 MB).
const MaxFontBytes = 32 << 20

const maxFamily = 120

// Format names the container by its signature, or "" when it is not a font.
func Format(b []byte) string {
	if len(b) < 12 {
		return ""
	}
	switch string(b[0:4]) {
	case "wOF2":
		return "woff2"
	case "wOFF":
		return "woff"
	case "OTTO":
		return "otf"
	case "\x00\x01\x00\x00", "true":
		return "ttf"
	case "ttcf":
		return "ttc"
	}
	return ""
}

// ContentType for serving a face.
func ContentType(format string) string {
	switch format {
	case "woff2":
		return "font/woff2"
	case "woff":
		return "font/woff"
	case "otf":
		return "font/otf"
	case "ttc":
		return "font/collection"
	default:
		return "font/ttf"
	}
}

// DBTX is the data surface (satisfied by *pgxpool.Pool).
type DBTX interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Access is the membership and role check (satisfied by *accounts.Service).
type Access interface {
	AssertMember(ctx context.Context, userID, workspaceID, minRole string) error
	Require(ctx context.Context, userID, workspaceID string, a authz.Action, creatorID string) error
}

// Font is the JSON shape of one face (without its bytes).
type Font struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspaceId"`
	Family      string `json:"family"`
	Weight      int    `json:"weight"`
	Style       string `json:"style"`
	FileName    string `json:"fileName"`
	Format      string `json:"format"`
	SizeBytes   int    `json:"sizeBytes"`
	CreatedAt   string `json:"createdAt"`
}

// Face is the descriptive part of an upload or edit.
type Face struct {
	Family string
	Weight int
	Style  string
}

func (f Face) clean() (Face, error) {
	f.Family = strings.TrimSpace(f.Family)
	if f.Family == "" || len([]rune(f.Family)) > maxFamily || strings.ContainsAny(f.Family, "\"'\\;{}<>") {
		return f, ErrInvalid
	}
	if f.Weight == 0 {
		f.Weight = 400
	}
	if f.Weight < 1 || f.Weight > 1000 {
		return f, ErrInvalid
	}
	if f.Style == "" {
		f.Style = "normal"
	}
	if f.Style != "normal" && f.Style != "italic" {
		return f, ErrInvalid
	}
	return f, nil
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

// allow checks the caller's role allows the action (F42). The error is
// ErrForbidden wrapping the action error, so the API can name the action.
func (s *Service) allow(ctx context.Context, userID, workspaceID string, a authz.Action) error {
	if _, err := uuid.Parse(workspaceID); err != nil {
		return ErrNotFound
	}
	if err := s.access.Require(ctx, userID, workspaceID, a, ""); err != nil {
		return forbidden(err)
	}
	return nil
}

const cols = `"id", "workspace_id", "family", "weight", "style", "file_name", "format", "size_bytes", "created_at"`

func scan(row pgx.Row) (Font, error) {
	var f Font
	var created time.Time
	err := row.Scan(&f.ID, &f.WorkspaceID, &f.Family, &f.Weight, &f.Style, &f.FileName, &f.Format, &f.SizeBytes, &created)
	f.CreatedAt = created.UTC().Format(time.RFC3339)
	return f, err
}

// List returns the workspace's faces by family, weight, style. Any member
// may list and use them.
func (s *Service) List(ctx context.Context, userID, workspaceID string) ([]Font, error) {
	if err := s.member(ctx, userID, workspaceID, "viewer"); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `SELECT `+cols+` FROM "workspace_fonts" WHERE "workspace_id" = $1 ORDER BY lower("family"), "weight", "style"`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Font{}
	for rows.Next() {
		f, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// Create stores an uploaded face (admins).
func (s *Service) Create(ctx context.Context, userID, workspaceID string, face Face, fileName string, data []byte) (Font, error) {
	if err := s.allow(ctx, userID, workspaceID, authz.FontsManage); err != nil {
		return Font{}, err
	}
	format := Format(data)
	if format == "" || len(data) > MaxFontBytes {
		return Font{}, ErrNotFont
	}
	face, err := face.clean()
	if err != nil {
		return Font{}, err
	}
	if len(fileName) > 200 {
		fileName = fileName[:200]
	}
	sum := sha256.Sum256(data)
	row := s.db.QueryRow(ctx, `INSERT INTO "workspace_fonts"
		("workspace_id", "family", "weight", "style", "file_name", "format", "size_bytes", "checksum", "data", "created_by_id")
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT ("workspace_id", "checksum") DO NOTHING
		RETURNING `+cols,
		workspaceID, face.Family, face.Weight, face.Style, fileName, format, len(data), hex.EncodeToString(sum[:]), data, nullableUUID(userID))
	f, err := scan(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Font{}, ErrDuplicate
	}
	return f, err
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
	err := s.db.QueryRow(ctx, `SELECT "workspace_id" FROM "workspace_fonts" WHERE "id" = $1`, id).Scan(&ws)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return ws, err
}

// Update corrects a face's family name, weight or style (admins).
func (s *Service) Update(ctx context.Context, userID, id string, face Face) error {
	ws, err := s.workspaceOf(ctx, id)
	if err != nil {
		return err
	}
	if err := s.allow(ctx, userID, ws, authz.FontsManage); err != nil {
		return err
	}
	face, err = face.clean()
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `UPDATE "workspace_fonts" SET "family" = $2, "weight" = $3, "style" = $4 WHERE "id" = $1`, id, face.Family, face.Weight, face.Style)
	return err
}

// Delete removes a face (admins). Designs using the family fall back to a
// default font; vector exports already made keep their outlines.
func (s *Service) Delete(ctx context.Context, userID, id string) error {
	ws, err := s.workspaceOf(ctx, id)
	if err != nil {
		return err
	}
	if err := s.allow(ctx, userID, ws, authz.FontsManage); err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `DELETE FROM "workspace_fonts" WHERE "id" = $1`, id)
	return err
}

// File returns a face's bytes for any member.
func (s *Service) File(ctx context.Context, userID, id string) ([]byte, string, string, error) {
	ws, err := s.workspaceOf(ctx, id)
	if err != nil {
		return nil, "", "", err
	}
	if err := s.member(ctx, userID, ws, "viewer"); err != nil {
		return nil, "", "", err
	}
	var data []byte
	var format, checksum string
	if err := s.db.QueryRow(ctx, `SELECT "data", "format", "checksum" FROM "workspace_fonts" WHERE "id" = $1`, id).Scan(&data, &format, &checksum); err != nil {
		return nil, "", "", err
	}
	return data, format, checksum, nil
}

// CopyFamilies brings the faces of the given families from workspace srcWS
// into dstWS, for a design moved or copied there. Families the target already
// has (by name) are left alone; faces already there (same file) are not added
// twice. Adding faces needs admin in the target, as an upload does: without
// it nothing is added. Returns the families the design uses from the source
// library that the target still lacks.
func (s *Service) CopyFamilies(ctx context.Context, userID, srcWS, dstWS string, families []string) ([]string, error) {
	if len(families) == 0 || srcWS == dstWS {
		return nil, nil
	}
	if err := s.member(ctx, userID, srcWS, "viewer"); err != nil {
		return nil, err
	}
	if err := s.allow(ctx, userID, dstWS, authz.DesignCreate); err != nil {
		return nil, err
	}
	admin := s.allow(ctx, userID, dstWS, authz.FontsManage) == nil
	lower := make([]string, 0, len(families))
	for _, f := range families {
		lower = append(lower, strings.ToLower(strings.TrimSpace(f)))
	}
	// Families of the source library the design uses that the target has
	// under no face at all.
	rows, err := s.db.Query(ctx, `SELECT DISTINCT "family" FROM "workspace_fonts" src
		WHERE src."workspace_id" = $1 AND lower(src."family") = ANY($3)
		AND NOT EXISTS (SELECT 1 FROM "workspace_fonts" d WHERE d."workspace_id" = $2 AND lower(d."family") = lower(src."family"))`,
		srcWS, dstWS, lower)
	if err != nil {
		return nil, err
	}
	var lacking []string
	for rows.Next() {
		var f string
		if err := rows.Scan(&f); err != nil {
			rows.Close()
			return nil, err
		}
		lacking = append(lacking, f)
	}
	rows.Close()
	if err := rows.Err(); err != nil || len(lacking) == 0 || !admin {
		return lacking, err
	}
	low := make([]string, len(lacking))
	for i, f := range lacking {
		low[i] = strings.ToLower(f)
	}
	if _, err := s.db.Exec(ctx, `INSERT INTO "workspace_fonts"
		("workspace_id", "family", "weight", "style", "file_name", "format", "size_bytes", "checksum", "data", "created_by_id")
		SELECT $2, "family", "weight", "style", "file_name", "format", "size_bytes", "checksum", "data", $4
		FROM "workspace_fonts" WHERE "workspace_id" = $1 AND lower("family") = ANY($3)
		ON CONFLICT ("workspace_id", "checksum") DO NOTHING`,
		srcWS, dstWS, low, nullableUUID(userID)); err != nil {
		return lacking, err
	}
	return nil, nil
}

// forbidden maps a role check failure: a missing action keeps its name for
// the API (wrapped in ErrForbidden), anything else is plain ErrForbidden.
func forbidden(err error) error {
	if _, ok := accounts.IsActionError(err); ok {
		return fmt.Errorf("%w: %w", ErrForbidden, err)
	}
	return ErrForbidden
}
