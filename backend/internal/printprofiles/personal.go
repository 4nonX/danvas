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
)

// Personal profiles ("user_print_profiles"): a user's own ICC profiles, usable
// in every workspace and seen by nobody else. Update, Delete and Data take
// either kind of id; a personal one is only ever its owner's.

const personalCols = `"id", "name", "description", "color_space", "icc_version", "size_bytes", "is_default", "created_at"`

func scanPersonal(row pgx.Row) (Profile, error) {
	p := Profile{Owner: "user"}
	var created time.Time
	err := row.Scan(&p.ID, &p.Name, &p.Description, &p.ColorSpace, &p.ICCVersion, &p.SizeBytes, &p.IsDefault, &created)
	p.CreatedAt = created.UTC().Format(time.RFC3339)
	return p, err
}

// ListPersonal returns the user's own profiles, default first.
func (s *Service) ListPersonal(ctx context.Context, userID string) ([]Profile, error) {
	if _, err := uuid.Parse(userID); err != nil {
		return nil, ErrForbidden
	}
	rows, err := s.db.Query(ctx, `SELECT `+personalCols+` FROM "user_print_profiles" WHERE "user_id" = $1 ORDER BY "is_default" DESC, "name"`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Profile{}
	for rows.Next() {
		p, err := scanPersonal(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// CreatePersonal stores a profile the user uploaded for themselves. Unlike a
// workspace's first profile it does not become a default by itself: the
// workspace's default keeps applying until the user chooses one of theirs.
func (s *Service) CreatePersonal(ctx context.Context, userID, name string, data []byte) (Profile, error) {
	if _, err := uuid.Parse(userID); err != nil {
		return Profile{}, ErrForbidden
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
	row := s.db.QueryRow(ctx, `INSERT INTO "user_print_profiles"
		("user_id", "name", "description", "color_space", "icc_version", "size_bytes", "checksum", "data")
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT ("user_id", "checksum") DO NOTHING
		RETURNING `+personalCols,
		userID, n, h.Description, h.ColorSpace, h.Version, len(data), hex.EncodeToString(sum[:]), data)
	p, err := scanPersonal(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Profile{}, ErrDuplicate
	}
	return p, err
}

// personalOwner is the owner of a personal profile; "" when id is none.
func (s *Service) personalOwner(ctx context.Context, id string) (string, error) {
	if _, err := uuid.Parse(id); err != nil {
		return "", ErrNotFound
	}
	var owner string
	err := s.db.QueryRow(ctx, `SELECT "user_id" FROM "user_print_profiles" WHERE "id" = $1`, id).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return owner, err
}

// updatePersonal renames one of the user's profiles and/or sets or clears it
// as their default (one at most).
func (s *Service) updatePersonal(ctx context.Context, userID, id string, name *string, makeDefault, clearDefault bool) error {
	if name != nil {
		n := strings.TrimSpace(*name)
		if n == "" || len([]rune(n)) > maxName {
			return ErrInvalid
		}
		if _, err := s.db.Exec(ctx, `UPDATE "user_print_profiles" SET "name" = $2 WHERE "id" = $1`, id, n); err != nil {
			return err
		}
	}
	if makeDefault {
		if _, err := s.db.Exec(ctx, `UPDATE "user_print_profiles" SET "is_default" = ("id" = $1) WHERE "user_id" = $2`, id, userID); err != nil {
			return err
		}
	} else if clearDefault {
		if _, err := s.db.Exec(ctx, `UPDATE "user_print_profiles" SET "is_default" = false WHERE "id" = $1`, id); err != nil {
			return err
		}
	}
	return nil
}
