package colorlibs

import (
	"context"
	"errors"
	"math"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"hycanvas/backend/internal/accounts"
)

func lab(l, a, b float64) *[3]float64 { return &[3]float64{l, a, b} }

func TestValidate(t *testing.T) {
	ok, err := Validate([]Entry{{Name: "  Grün  ", Lab: lab(38, -32, 14)}, {Name: "Blau", CMYK: &[4]float64{0.6, 0.2, 0, 0}}})
	if err != nil || ok[0].Name != "Grün" {
		t.Fatalf("valid entries: %v %+v", err, ok)
	}
	bad := [][]Entry{
		nil,
		{{Name: "", Lab: lab(1, 2, 3)}},
		{{Name: "no colour"}},
		{{Name: "L too high", Lab: lab(101, 0, 0)}},
		{{Name: "NaN", Lab: lab(50, math.NaN(), 0)}},
		{{Name: "CMYK percent", CMYK: &[4]float64{60, 20, 0, 0}}},
		{{Name: strings.Repeat("x", maxName+1), Lab: lab(50, 0, 0)}},
		make([]Entry, MaxEntries+1),
	}
	for i, b := range bad {
		if _, err := Validate(b); !errors.Is(err, ErrInvalid) {
			t.Fatalf("case %d accepted: %v", i, err)
		}
	}
}

func TestColorLibraries_DB(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set; skipping DB integration test")
	}
	if i := strings.Index(dsn, "?schema="); i >= 0 {
		dsn = dsn[:i]
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	acct := accounts.NewService(tx, "test-jwt-secret")
	svc := NewService(tx, acct)
	me, ws, _, err := acct.Signup(ctx, "cl-me+"+uuid.NewString()+"@example.com", "a-strong-password", "Me")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	other, _, _, err := acct.Signup(ctx, "cl-other+"+uuid.NewString()+"@example.com", "a-strong-password", "Other")
	if err != nil {
		t.Fatalf("signup other: %v", err)
	}

	entries := []Entry{{Name: "Hausgrün", Lab: lab(38, -32, 14)}, {Name: "Rot", RGB: &[3]float64{1, 0, 0}}}
	lib, err := svc.Create(ctx, me.ID, ws.ID, "", "haus.csv", entries)
	if err != nil || lib.Name != "haus.csv" || lib.EntryCount != 2 || lib.WorkspaceID != ws.ID {
		t.Fatalf("create: %v %+v", err, lib)
	}
	if _, err := svc.Create(ctx, me.ID, ws.ID, "x", "x.csv", nil); !errors.Is(err, ErrInvalid) {
		t.Fatalf("empty library: %v", err)
	}
	list, err := svc.List(ctx, me.ID, ws.ID)
	if err != nil || len(list) != 1 || list[0].ID != lib.ID {
		t.Fatalf("list: %v %+v", err, list)
	}
	got, err := svc.Entries(ctx, me.ID, lib.ID)
	if err != nil || len(got) != 2 || got[0].Name != "Hausgrün" || got[0].Lab[1] != -32 || got[1].RGB == nil {
		t.Fatalf("entries: %v %+v", err, got)
	}

	// Outsiders see nothing and change nothing.
	if _, err := svc.List(ctx, other.ID, ws.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider listed: %v", err)
	}
	if _, err := svc.Entries(ctx, other.ID, lib.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider read: %v", err)
	}
	if err := svc.Delete(ctx, other.ID, lib.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider deleted: %v", err)
	}
	if _, err := svc.Create(ctx, other.ID, ws.ID, "x", "x.csv", entries); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider created: %v", err)
	}

	if err := svc.Delete(ctx, me.ID, lib.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := svc.Entries(ctx, me.ID, lib.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted still readable: %v", err)
	}
}
