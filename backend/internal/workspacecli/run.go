// Package workspacecli implements the `hycanvas workspace` subcommand. Its one
// verb, grant-owner, is the recovery for a workspace nobody can administer
// any more (F42 FR-9): it gives an existing user the owner role from the
// server's command line. It reads the same configuration as the server and
// never boots it.
package workspacecli

import (
	"context"
	"errors"
	"fmt"
	"io"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/migrations"
	"hycanvas/backend/internal/platform/config"
	"hycanvas/backend/internal/platform/db"
)

// Run executes `hycanvas workspace <verb>` and returns the process exit code.
func Run(args []string, stdout, stderr io.Writer) int {
	if len(args) != 3 || args[0] != "grant-owner" {
		usage(stderr)
		return 2
	}
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(stderr, "error: configuration:", err)
		return 1
	}
	ctx := context.Background()
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		fmt.Fprintln(stderr, "error: database:", err)
		return 1
	}
	defer pool.Close()
	// The role tables must exist (a server of this release migrates on boot).
	if err := db.Migrate(ctx, pool, migrations.FS); err != nil {
		fmt.Fprintln(stderr, "error: migrations:", err)
		return 1
	}
	acct := accounts.NewService(pool, cfg.JWTSecret)
	id, name, err := acct.GrantOwner(ctx, args[1], args[2])
	switch {
	case errors.Is(err, accounts.ErrNotFound):
		fmt.Fprintln(stderr, "error: no such workspace, or no user with that email (they must have signed in once)")
		return 1
	case errors.Is(err, accounts.ErrBadRequest):
		fmt.Fprintln(stderr, "error: several workspaces have that slug; use the workspace id")
		return 1
	case err != nil:
		fmt.Fprintln(stderr, "error:", err)
		return 1
	}
	fmt.Fprintf(stdout, "%s is now an owner of %q (%s).\n", args[2], name, id)
	return 0
}

func usage(w io.Writer) {
	fmt.Fprintln(w, "usage: hycanvas workspace grant-owner <workspace id or slug> <email>")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Gives an existing user the owner role of a workspace (adding them to it")
	fmt.Fprintln(w, "if needed), for when nobody who could do it in the app is left. The change")
	fmt.Fprintln(w, "is recorded in the workspace's role change log.")
}
