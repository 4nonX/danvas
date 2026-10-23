// Package colorlibs stores a workspace's colour libraries: a colour book the
// workspace holds a licence for (e.g. a Pantone book as .ase or .acb) or a
// house colour list. The browser reads the file; only its entries are stored
// here. The colour list that goes with a print export names, per colour of a
// design, the nearest entry of the chosen library.
//
// No library ships with the product: colour books are licensed, so each
// workspace brings its own. Any member may read them (exports run in the
// browser); uploading and deleting take the print colour profile right.
package colorlibs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/authz"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	// ErrForbidden: not a member, or the role lacks the action.
	ErrForbidden = errors.New("forbidden")
	// ErrNotFound: no such library.
	ErrNotFound = errors.New("not found")
	// ErrInvalid: bad name or entries.
	ErrInvalid = errors.New("invalid request")
)

const (
	maxName = 120
	// MaxEntries bounds one library (the larger Pantone books hold ~2400).
	MaxEntries = 20000
	// MaxBodyBytes bounds an upload's JSON body.
	MaxBodyBytes = 8 << 20
)

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

// Entry is one colour of a library. At least one of Lab, CMYK, RGB is set;
// matching uses Lab (D50), which the browser works out when the file only
// gives CMYK or RGB.
type Entry struct {
	Name string      `json:"name"`
	Lab  *[3]float64 `json:"lab,omitempty"`
	CMYK *[4]float64 `json:"cmyk,omitempty"`
	RGB  *[3]float64 `json:"rgb,omitempty"`
}

// Library is the JSON shape of one library without its entries.
type Library struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspaceId"`
	Name        string `json:"name"`
	SourceFile  string `json:"sourceFile"`
	EntryCount  int    `json:"entryCount"`
	CreatedAt   string `json:"createdAt"`
}

type Service struct {
	db     DBTX
	access Access
}

func NewService(db DBTX, access Access) *Service { return &Service{db: db, access: access} }

func (s *Service) member(ctx context.Context, userID, workspaceID string) error {
	if _, err := uuid.Parse(workspaceID); err != nil {
		return ErrNotFound
	}
	if err := s.access.AssertMember(ctx, userID, workspaceID, "viewer"); err != nil {
		return ErrForbidden
	}
	return nil
}

// allow checks the caller's role allows managing print colour data (F42).
func (s *Service) allow(ctx context.Context, userID, workspaceID string) error {
	if _, err := uuid.Parse(workspaceID); err != nil {
		return ErrNotFound
	}
	if err := s.access.Require(ctx, userID, workspaceID, authz.PrintColorProfiles, ""); err != nil {
		if _, ok := accounts.IsActionError(err); ok {
			return fmt.Errorf("%w: %w", ErrForbidden, err)
		}
		return ErrForbidden
	}
	return nil
}

const cols = `"id", "workspace_id", "name", "source_file", "entry_count", "created_at"`

func scan(row pgx.Row) (Library, error) {
	var l Library
	var created time.Time
	err := row.Scan(&l.ID, &l.WorkspaceID, &l.Name, &l.SourceFile, &l.EntryCount, &created)
	l.CreatedAt = created.UTC().Format(time.RFC3339)
	return l, err
}

// List returns the workspace's libraries by name.
func (s *Service) List(ctx context.Context, userID, workspaceID string) ([]Library, error) {
	if err := s.member(ctx, userID, workspaceID); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `SELECT `+cols+` FROM "color_libraries" WHERE "workspace_id" = $1 ORDER BY "name", "created_at"`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Library{}
	for rows.Next() {
		l, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// Validate checks and tidies entries: names trimmed and bounded, numbers
// finite and in range, every entry with at least one colour.
func Validate(entries []Entry) ([]Entry, error) {
	if len(entries) == 0 || len(entries) > MaxEntries {
		return nil, ErrInvalid
	}
	finite := func(v []float64, lo, hi float64) bool {
		for _, n := range v {
			if math.IsNaN(n) || math.IsInf(n, 0) || n < lo || n > hi {
				return false
			}
		}
		return true
	}
	out := make([]Entry, 0, len(entries))
	for _, e := range entries {
		e.Name = strings.TrimSpace(e.Name)
		if e.Name == "" || len([]rune(e.Name)) > maxName {
			return nil, ErrInvalid
		}
		if e.Lab == nil && e.CMYK == nil && e.RGB == nil {
			return nil, ErrInvalid
		}
		if e.Lab != nil && (!finite(e.Lab[:1], 0, 100) || !finite(e.Lab[1:], -200, 200)) {
			return nil, ErrInvalid
		}
		if e.CMYK != nil && !finite(e.CMYK[:], 0, 1) {
			return nil, ErrInvalid
		}
		if e.RGB != nil && !finite(e.RGB[:], 0, 1) {
			return nil, ErrInvalid
		}
		out = append(out, e)
	}
	return out, nil
}

// Create stores a library read from an uploaded file.
func (s *Service) Create(ctx context.Context, userID, workspaceID, name, sourceFile string, entries []Entry) (Library, error) {
	if err := s.allow(ctx, userID, workspaceID); err != nil {
		return Library{}, err
	}
	n := strings.TrimSpace(name)
	if n == "" {
		n = strings.TrimSpace(sourceFile)
	}
	src := strings.TrimSpace(sourceFile)
	if n == "" || len([]rune(n)) > maxName || len([]rune(src)) > 255 {
		return Library{}, ErrInvalid
	}
	clean, err := Validate(entries)
	if err != nil {
		return Library{}, err
	}
	raw, err := json.Marshal(clean)
	if err != nil {
		return Library{}, err
	}
	var by any
	if _, err := uuid.Parse(userID); err == nil {
		by = userID
	}
	return scan(s.db.QueryRow(ctx, `INSERT INTO "color_libraries"
		("workspace_id", "name", "source_file", "entries", "entry_count", "created_by_id")
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING `+cols, workspaceID, n, src, raw, len(clean), by))
}

func (s *Service) workspaceOf(ctx context.Context, id string) (string, error) {
	if _, err := uuid.Parse(id); err != nil {
		return "", ErrNotFound
	}
	var ws string
	err := s.db.QueryRow(ctx, `SELECT "workspace_id" FROM "color_libraries" WHERE "id" = $1`, id).Scan(&ws)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return ws, err
}

// Entries returns a library's colours to any member of its workspace.
func (s *Service) Entries(ctx context.Context, userID, id string) ([]Entry, error) {
	ws, err := s.workspaceOf(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := s.member(ctx, userID, ws); err != nil {
		return nil, err
	}
	var raw []byte
	if err := s.db.QueryRow(ctx, `SELECT "entries" FROM "color_libraries" WHERE "id" = $1`, id).Scan(&raw); err != nil {
		return nil, err
	}
	out := []Entry{}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// Delete removes a library. Exports already made keep their colour lists.
func (s *Service) Delete(ctx context.Context, userID, id string) error {
	ws, err := s.workspaceOf(ctx, id)
	if err != nil {
		return err
	}
	if err := s.allow(ctx, userID, ws); err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `DELETE FROM "color_libraries" WHERE "id" = $1`, id)
	return err
}
