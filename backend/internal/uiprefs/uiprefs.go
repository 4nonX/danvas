// Package uiprefs keeps a user's interface preferences with the account, so
// they follow the person to every browser and device: for example the order
// of the element rows in the editor, which rows are hidden and which elements
// are pinned. Each preference is one JSON value under a key; the browser owns
// its shape, the server only bounds its size.
package uiprefs

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	// ErrInvalid: a bad key or a value that is not JSON.
	ErrInvalid = errors.New("invalid preference")
	// ErrTooLarge: the value, or the number of keys, is over the limit.
	ErrTooLarge = errors.New("preference too large")
)

const (
	// MaxValueBytes bounds one preference value.
	MaxValueBytes = 32 << 10
	// MaxKeys bounds how many preferences one user keeps.
	MaxKeys = 64
)

var keyRe = regexp.MustCompile(`^[a-z][A-Za-z0-9._-]{0,63}$`)

// DBTX is the data surface (satisfied by *pgxpool.Pool).
type DBTX interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Service reads and writes a user's interface preferences.
type Service struct{ db DBTX }

// NewService returns the service over db.
func NewService(db DBTX) *Service { return &Service{db: db} }

// All returns every preference of the user, by key (empty when none).
func (s *Service) All(ctx context.Context, userID string) (map[string]json.RawMessage, error) {
	rows, err := s.db.Query(ctx, `SELECT "key", "value" FROM "user_ui_prefs" WHERE "user_id" = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]json.RawMessage{}
	for rows.Next() {
		var k string
		var v []byte
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = json.RawMessage(v)
	}
	return out, rows.Err()
}

// Set stores one preference; a JSON null removes it.
func (s *Service) Set(ctx context.Context, userID, key string, value json.RawMessage) error {
	if !keyRe.MatchString(key) || !json.Valid(value) {
		return ErrInvalid
	}
	if len(value) > MaxValueBytes {
		return ErrTooLarge
	}
	if string(value) == "null" {
		_, err := s.db.Exec(ctx, `DELETE FROM "user_ui_prefs" WHERE "user_id" = $1 AND "key" = $2`, userID, key)
		return err
	}
	// A new key counts against the limit; replacing an existing one does not.
	var n int
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT count(*), coalesce(bool_or("key" = $2), false) FROM "user_ui_prefs" WHERE "user_id" = $1`, userID, key).Scan(&n, &exists); err != nil {
		return err
	}
	if !exists && n >= MaxKeys {
		return ErrTooLarge
	}
	_, err := s.db.Exec(ctx, `INSERT INTO "user_ui_prefs" ("user_id", "key", "value", "updated_at") VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
		ON CONFLICT ("user_id", "key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = EXCLUDED."updated_at"`, userID, key, []byte(value))
	return err
}
