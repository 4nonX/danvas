// Package exportprofiles stores named sets of output settings, so a design
// goes out with the same settings again in one click. There are two kinds,
// kept apart everywhere a user sees them: export profiles (the download
// menu: format, size, colour, print-shop options) and print presets (the
// print dialog: size on paper, resolution, bleed and marks).
//
// A profile is personal (owned by a user, usable in every workspace) or
// belongs to a workspace (shared by its members). Every member uses the
// workspace's profiles; who may create, change and delete them is a
// workspace setting per kind: owners and admins (the default) or every
// member who may edit. Names are unique per owner and kind, ignoring case.
// Each owner has at most one default per kind; the menu starts from the
// personal default, else the workspace's.
//
// The settings are the client's versioned JSON object, stored as sent: the
// server checks only that it is a bounded object with a version, so a newer
// client's options survive an older server.
package exportprofiles

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	// ErrForbidden: not allowed to see or change this profile.
	ErrForbidden = errors.New("forbidden")
	// ErrNotFound: no such profile (or workspace).
	ErrNotFound = errors.New("not found")
	// ErrInvalid: bad name, description, scope, kind or settings.
	ErrInvalid = errors.New("invalid request")
	// ErrNameTaken: the owner already has a profile of that kind and name.
	ErrNameTaken = errors.New("name taken")
)

const (
	maxName        = 120
	maxDescription = 500
	maxSettings    = 16 << 10

	// ScopeWorkspace and ScopePersonal are the two owners a profile can have.
	ScopeWorkspace = "workspace"
	ScopePersonal  = "personal"

	// KindExport and KindPrint are the two kinds of profile.
	KindExport = "export"
	KindPrint  = "print"

	// ManagedByAdmins and ManagedByMembers are who may manage a workspace's
	// profiles of a kind.
	ManagedByAdmins  = "admins"
	ManagedByMembers = "members"
)

// KindOf is the kind a request names; empty is an export profile.
func KindOf(s string) (string, error) {
	switch s {
	case "", KindExport:
		return KindExport, nil
	case KindPrint:
		return KindPrint, nil
	}
	return "", ErrInvalid
}

// managedByColumn is the workspace setting of a kind.
func managedByColumn(kind string) string {
	if kind == KindPrint {
		return `"print_presets_managed_by"`
	}
	return `"profiles_managed_by"`
}

// DBTX is the data surface (satisfied by *pgxpool.Pool and pgx.Tx).
type DBTX interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Access is the membership check (satisfied by *accounts.Service).
type Access interface {
	AssertMember(ctx context.Context, userID, workspaceID, minRole string) error
}

// Profile is the JSON shape of one profile.
type Profile struct {
	ID          string          `json:"id"`
	Kind        string          `json:"kind"`
	Scope       string          `json:"scope"`
	WorkspaceID *string         `json:"workspaceId"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Settings    json.RawMessage `json:"settings"`
	IsDefault   bool            `json:"isDefault"`
	// UpdatedByName says who last changed a shared profile.
	UpdatedByName string `json:"updatedByName"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
}

// View is what a menu and the settings pages load: the workspace's profiles
// of a kind and the user's own, and what the user may do.
type View struct {
	Profiles []Profile `json:"profiles"`
	// ManagedBy is who may manage the workspace's profiles of this kind.
	ManagedBy string `json:"managedBy"`
	// CanManageWorkspace: this user may create, change and delete them.
	CanManageWorkspace bool `json:"canManageWorkspace"`
	// CanConfigure: this user may change ManagedBy (owners and admins).
	CanConfigure bool `json:"canConfigure"`
}

// Input creates a profile.
type Input struct {
	Kind        string          `json:"kind"`
	Scope       string          `json:"scope"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Settings    json.RawMessage `json:"settings"`
	IsDefault   bool            `json:"isDefault"`
}

// Patch changes a profile; nil fields stay as they are.
type Patch struct {
	Name        *string         `json:"name"`
	Description *string         `json:"description"`
	Settings    json.RawMessage `json:"settings"`
	IsDefault   *bool           `json:"isDefault"`
}

type Service struct {
	db     DBTX
	access Access
}

func NewService(db DBTX, access Access) *Service { return &Service{db: db, access: access} }

func validID(id string) bool {
	_, err := uuid.Parse(id)
	return err == nil
}

// managedBy is who may manage the workspace's profiles of a kind ("admins"
// without a row).
func (s *Service) managedBy(ctx context.Context, workspaceID, kind string) (string, error) {
	var m string
	err := s.db.QueryRow(ctx, `SELECT `+managedByColumn(kind)+` FROM "workspace_export_settings" WHERE "workspace_id" = $1`, workspaceID).Scan(&m)
	if errors.Is(err, pgx.ErrNoRows) {
		return ManagedByAdmins, nil
	}
	if err != nil {
		return "", err
	}
	if m != ManagedByMembers {
		return ManagedByAdmins, nil
	}
	return m, nil
}

// canManage reports whether the user may change the workspace's profiles of
// a kind.
func (s *Service) canManage(ctx context.Context, userID, workspaceID, kind string) (bool, error) {
	m, err := s.managedBy(ctx, workspaceID, kind)
	if err != nil {
		return false, err
	}
	role := "admin"
	if m == ManagedByMembers {
		role = "member"
	}
	return s.access.AssertMember(ctx, userID, workspaceID, role) == nil, nil
}

const cols = `p."id", p."kind", p."workspace_id", p."user_id", p."name", p."description", p."settings", p."is_default",
	COALESCE(u."name", u."email", ''), p."created_at", p."updated_at"`

const from = ` FROM "export_profiles" p LEFT JOIN "users" u ON u."id" = p."updated_by"`

func scan(row pgx.Row) (Profile, error) {
	var p Profile
	var ws, user *string
	var settings []byte
	var created, updated time.Time
	if err := row.Scan(&p.ID, &p.Kind, &ws, &user, &p.Name, &p.Description, &settings, &p.IsDefault, &p.UpdatedByName, &created, &updated); err != nil {
		return p, err
	}
	p.WorkspaceID = ws
	p.Scope = ScopePersonal
	if ws != nil {
		p.Scope = ScopeWorkspace
	}
	p.Settings = json.RawMessage(settings)
	p.CreatedAt = created.UTC().Format(time.RFC3339)
	p.UpdatedAt = updated.UTC().Format(time.RFC3339)
	return p, nil
}

func (s *Service) query(ctx context.Context, sql string, args ...any) ([]Profile, error) {
	rows, err := s.db.Query(ctx, sql, args...)
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

// List returns the workspace's profiles of a kind and the user's personal
// ones, each group default first, then by name. Any member may list and use
// them.
func (s *Service) List(ctx context.Context, userID, workspaceID, kind string) (View, error) {
	if !validID(workspaceID) {
		return View{}, ErrNotFound
	}
	if err := s.access.AssertMember(ctx, userID, workspaceID, "viewer"); err != nil {
		return View{}, ErrForbidden
	}
	list, err := s.query(ctx, `SELECT `+cols+from+`
		WHERE (p."workspace_id" = $1 OR p."user_id" = $2) AND p."kind" = $3
		ORDER BY (p."workspace_id" IS NULL), p."is_default" DESC, lower(p."name")`, workspaceID, userID, kind)
	if err != nil {
		return View{}, err
	}
	v := View{Profiles: list}
	if v.ManagedBy, err = s.managedBy(ctx, workspaceID, kind); err != nil {
		return View{}, err
	}
	if v.CanManageWorkspace, err = s.canManage(ctx, userID, workspaceID, kind); err != nil {
		return View{}, err
	}
	v.CanConfigure = s.access.AssertMember(ctx, userID, workspaceID, "admin") == nil
	return v, nil
}

// ListPersonal returns only the user's own profiles of a kind (the settings
// page, which belongs to no workspace).
func (s *Service) ListPersonal(ctx context.Context, userID, kind string) ([]Profile, error) {
	return s.query(ctx, `SELECT `+cols+from+`
		WHERE p."user_id" = $1 AND p."kind" = $2 ORDER BY p."is_default" DESC, lower(p."name")`, userID, kind)
}

func cleanName(name string) (string, error) {
	n := strings.TrimSpace(name)
	if n == "" || len([]rune(n)) > maxName {
		return "", ErrInvalid
	}
	return n, nil
}

func cleanDescription(d string) (string, error) {
	d = strings.TrimSpace(d)
	if len([]rune(d)) > maxDescription {
		return "", ErrInvalid
	}
	return d, nil
}

// cleanSettings accepts a JSON object of bounded size carrying a positive
// version number "v"; everything else in it is the client's business.
func cleanSettings(raw json.RawMessage) (json.RawMessage, error) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || len(raw) > maxSettings || raw[0] != '{' {
		return nil, ErrInvalid
	}
	var probe struct {
		V *float64 `json:"v"`
	}
	if err := json.Unmarshal(raw, &probe); err != nil || probe.V == nil || *probe.V < 1 {
		return nil, ErrInvalid
	}
	return raw, nil
}

func nameTaken(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23505"
}

// owner is a profile's owner (the workspace or the user it belongs to) and
// its kind.
type owner struct {
	workspaceID *string
	userID      *string
	kind        string
}

func (o owner) column() string {
	if o.workspaceID != nil {
		return `"workspace_id"`
	}
	return `"user_id"`
}

func (o owner) id() string {
	if o.workspaceID != nil {
		return *o.workspaceID
	}
	return *o.userID
}

// authorize checks that the user may change this owner's profiles.
func (s *Service) authorize(ctx context.Context, userID string, o owner) error {
	if o.userID != nil {
		if *o.userID != userID {
			return ErrNotFound // someone else's personal profile: not visible at all
		}
		return nil
	}
	ok, err := s.canManage(ctx, userID, *o.workspaceID, o.kind)
	if err != nil {
		return err
	}
	if !ok {
		return ErrForbidden
	}
	return nil
}

// makeDefault makes the profile its owner's only default of its kind. Two
// statements, clearing first, so the unique default index never sees two at
// once.
func (s *Service) makeDefault(ctx context.Context, o owner, id string) error {
	if _, err := s.db.Exec(ctx, `UPDATE "export_profiles" SET "is_default" = false
		WHERE `+o.column()+` = $1 AND "kind" = $2 AND "is_default" AND "id" <> $3`, o.id(), o.kind, id); err != nil {
		return err
	}
	_, err := s.db.Exec(ctx, `UPDATE "export_profiles" SET "is_default" = true WHERE "id" = $1`, id)
	return err
}

// Create stores a new profile, personal or for the workspace (which needs
// the right to manage its profiles of that kind). A personal profile needs
// no workspace (workspaceID ""), it is the user's in every workspace.
func (s *Service) Create(ctx context.Context, userID, workspaceID string, in Input) (Profile, error) {
	kind, err := KindOf(in.Kind)
	if err != nil {
		return Profile{}, err
	}
	if workspaceID != "" || in.Scope != ScopePersonal {
		if !validID(workspaceID) {
			return Profile{}, ErrNotFound
		}
		if err := s.access.AssertMember(ctx, userID, workspaceID, "viewer"); err != nil {
			return Profile{}, ErrForbidden
		}
	}
	name, err := cleanName(in.Name)
	if err != nil {
		return Profile{}, err
	}
	desc, err := cleanDescription(in.Description)
	if err != nil {
		return Profile{}, err
	}
	settings, err := cleanSettings(in.Settings)
	if err != nil {
		return Profile{}, err
	}
	o := owner{kind: kind}
	switch in.Scope {
	case ScopeWorkspace:
		o.workspaceID = &workspaceID
	case ScopePersonal:
		o.userID = &userID
	default:
		return Profile{}, ErrInvalid
	}
	if err := s.authorize(ctx, userID, o); err != nil {
		return Profile{}, err
	}
	var id string
	err = s.db.QueryRow(ctx, `INSERT INTO "export_profiles"
		("kind", "workspace_id", "user_id", "name", "description", "settings", "created_by", "updated_by")
		VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING "id"`,
		kind, o.workspaceID, o.userID, name, desc, []byte(settings), userID).Scan(&id)
	if nameTaken(err) {
		return Profile{}, ErrNameTaken
	}
	if err != nil {
		return Profile{}, err
	}
	if in.IsDefault {
		if err := s.makeDefault(ctx, o, id); err != nil {
			return Profile{}, err
		}
	}
	return s.get(ctx, id)
}

func (s *Service) get(ctx context.Context, id string) (Profile, error) {
	p, err := scan(s.db.QueryRow(ctx, `SELECT `+cols+from+` WHERE p."id" = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Profile{}, ErrNotFound
	}
	return p, err
}

// ownerOf loads a profile's owner and kind, hiding profiles the user cannot
// see.
func (s *Service) ownerOf(ctx context.Context, userID, id string) (owner, error) {
	if !validID(id) {
		return owner{}, ErrNotFound
	}
	var o owner
	err := s.db.QueryRow(ctx, `SELECT "workspace_id", "user_id", "kind" FROM "export_profiles" WHERE "id" = $1`, id).Scan(&o.workspaceID, &o.userID, &o.kind)
	if errors.Is(err, pgx.ErrNoRows) {
		return owner{}, ErrNotFound
	}
	if err != nil {
		return owner{}, err
	}
	if o.userID != nil && *o.userID != userID {
		return owner{}, ErrNotFound
	}
	if o.workspaceID != nil && s.access.AssertMember(ctx, userID, *o.workspaceID, "viewer") != nil {
		return owner{}, ErrNotFound
	}
	return o, nil
}

// Update renames, re-describes, replaces the settings of, or (un)sets the
// default of a profile. Its kind and owner never change.
func (s *Service) Update(ctx context.Context, userID, id string, p Patch) (Profile, error) {
	o, err := s.ownerOf(ctx, userID, id)
	if err != nil {
		return Profile{}, err
	}
	if err := s.authorize(ctx, userID, o); err != nil {
		return Profile{}, err
	}
	sets := []string{`"updated_by" = $2`, `"updated_at" = now()`}
	args := []any{id, userID}
	if p.Name != nil {
		n, err := cleanName(*p.Name)
		if err != nil {
			return Profile{}, err
		}
		args = append(args, n)
		sets = append(sets, `"name" = $`+itoa(len(args)))
	}
	if p.Description != nil {
		d, err := cleanDescription(*p.Description)
		if err != nil {
			return Profile{}, err
		}
		args = append(args, d)
		sets = append(sets, `"description" = $`+itoa(len(args)))
	}
	if len(bytes.TrimSpace(p.Settings)) > 0 && string(bytes.TrimSpace(p.Settings)) != "null" {
		st, err := cleanSettings(p.Settings)
		if err != nil {
			return Profile{}, err
		}
		args = append(args, []byte(st))
		sets = append(sets, `"settings" = $`+itoa(len(args)))
	}
	if p.IsDefault != nil && !*p.IsDefault {
		sets = append(sets, `"is_default" = false`)
	}
	_, err = s.db.Exec(ctx, `UPDATE "export_profiles" SET `+strings.Join(sets, ", ")+` WHERE "id" = $1`, args...)
	if nameTaken(err) {
		return Profile{}, ErrNameTaken
	}
	if err != nil {
		return Profile{}, err
	}
	if p.IsDefault != nil && *p.IsDefault {
		if err := s.makeDefault(ctx, o, id); err != nil {
			return Profile{}, err
		}
	}
	return s.get(ctx, id)
}

// Delete removes a profile. Designs are not touched; a deleted default
// simply leaves its owner without one.
func (s *Service) Delete(ctx context.Context, userID, id string) error {
	o, err := s.ownerOf(ctx, userID, id)
	if err != nil {
		return err
	}
	if err := s.authorize(ctx, userID, o); err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `DELETE FROM "export_profiles" WHERE "id" = $1`, id)
	return err
}

// SetManagedBy sets who may manage the workspace's profiles of a kind
// (owners and admins only).
func (s *Service) SetManagedBy(ctx context.Context, userID, workspaceID, kind, managedBy string) error {
	if !validID(workspaceID) {
		return ErrNotFound
	}
	kind, err := KindOf(kind)
	if err != nil {
		return err
	}
	if managedBy != ManagedByAdmins && managedBy != ManagedByMembers {
		return ErrInvalid
	}
	if err := s.access.AssertMember(ctx, userID, workspaceID, "admin"); err != nil {
		return ErrForbidden
	}
	col := managedByColumn(kind)
	_, err = s.db.Exec(ctx, `INSERT INTO "workspace_export_settings" ("workspace_id", `+col+`, "updated_by", "updated_at")
		VALUES ($1, $2, $3, now())
		ON CONFLICT ("workspace_id") DO UPDATE SET `+col+` = $2, "updated_by" = $3, "updated_at" = now()`,
		workspaceID, managedBy, userID)
	return err
}

func itoa(n int) string {
	const digits = "0123456789"
	if n < 10 {
		return digits[n : n+1]
	}
	return itoa(n/10) + digits[n%10:n%10+1]
}
