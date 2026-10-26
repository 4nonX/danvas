package uiprefs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"hycanvas/backend/internal/accounts"
)

func TestUIPrefs_DB(t *testing.T) {
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
	svc := NewService(tx)
	me, _, _, err := acct.Signup(ctx, "ui-me+"+uuid.NewString()+"@example.com", "a-strong-password", "Me")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	other, _, _, err := acct.Signup(ctx, "ui-other+"+uuid.NewString()+"@example.com", "a-strong-password", "Other")
	if err != nil {
		t.Fatalf("signup other: %v", err)
	}

	all, err := svc.All(ctx, me.ID)
	if err != nil || len(all) != 0 {
		t.Fatalf("empty: %v %v", err, all)
	}
	v := json.RawMessage(`{"order":["shapes","frames"],"hidden":{"animated":true}}`)
	if err := svc.Set(ctx, me.ID, "editor.elements", v); err != nil {
		t.Fatalf("set: %v", err)
	}
	// Replacing keeps one row with the new value.
	if err := svc.Set(ctx, me.ID, "editor.elements", json.RawMessage(`{"order":["frames"]}`)); err != nil {
		t.Fatalf("replace: %v", err)
	}
	all, err = svc.All(ctx, me.ID)
	if err != nil || len(all) != 1 || !strings.Contains(string(all["editor.elements"]), `"frames"`) || strings.Contains(string(all["editor.elements"]), "shapes") {
		t.Fatalf("after replace: %v %s", err, all["editor.elements"])
	}
	// Someone else's preferences are their own.
	if all, err := svc.All(ctx, other.ID); err != nil || len(all) != 0 {
		t.Fatalf("other sees: %v %v", err, all)
	}
	// Bad keys, bad JSON and oversized values are refused.
	for _, k := range []string{"", "Editor", "1x", "a/b", strings.Repeat("a", 65)} {
		if err := svc.Set(ctx, me.ID, k, json.RawMessage(`1`)); !errors.Is(err, ErrInvalid) {
			t.Fatalf("key %q accepted: %v", k, err)
		}
	}
	if err := svc.Set(ctx, me.ID, "x", json.RawMessage(`{nope`)); !errors.Is(err, ErrInvalid) {
		t.Fatalf("bad json accepted: %v", err)
	}
	big := json.RawMessage(`"` + strings.Repeat("a", MaxValueBytes) + `"`)
	if err := svc.Set(ctx, me.ID, "x", big); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("big value accepted: %v", err)
	}
	// The number of keys is bounded; replacing at the limit still works.
	for i := 1; i < MaxKeys; i++ {
		if err := svc.Set(ctx, me.ID, fmt.Sprintf("k%d", i), json.RawMessage(`true`)); err != nil {
			t.Fatalf("key %d: %v", i, err)
		}
	}
	if err := svc.Set(ctx, me.ID, "one-more", json.RawMessage(`true`)); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("key over the limit accepted: %v", err)
	}
	if err := svc.Set(ctx, me.ID, "k1", json.RawMessage(`false`)); err != nil {
		t.Fatalf("replace at the limit: %v", err)
	}
	// null removes a key.
	if err := svc.Set(ctx, me.ID, "editor.elements", json.RawMessage(`null`)); err != nil {
		t.Fatalf("remove: %v", err)
	}
	all, _ = svc.All(ctx, me.ID)
	if _, ok := all["editor.elements"]; ok || len(all) != MaxKeys-1 {
		t.Fatalf("after remove: %d keys", len(all))
	}
}
