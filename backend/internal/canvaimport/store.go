package canvaimport

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Run statuses.
const (
	StatusQueued  = "queued"
	StatusRunning = "running"
	StatusPaused  = "paused" // Canva's daily limit; resumes at ResumeAt
	StatusDone    = "done"
	StatusStopped = "stopped"
	StatusHalted  = "halted"
)

// Why a run halted (Run.Halted); the client translates these.
const (
	HaltRateLimit    = "rate_limit"    // Canva kept refusing for too long
	HaltAccessLost   = "access_lost"   // the owner may no longer add designs here
	HaltNotConnected = "not_connected" // the owner's Canva account is no longer connected
	HaltError        = "error"         // anything else; HaltedDetail says what
)

// Why one design failed (Failure.Code); the client translates these.
const (
	FailExportFailed  = "export_failed" // Canva's export failed; Detail is Canva's code
	FailExportTimeout = "export_timed_out"
	FailNoExport      = "no_export" // no full PPTX or PNG export; Detail lists what Canva offers
	FailTooLarge      = "too_large"
	FailConvert       = "convert_failed" // the export could not be turned into a design
	FailOther         = "error"
)

// maxFailures bounds the failed designs a run keeps for its progress view.
const maxFailures = 200

// Failure is one design that could not be imported.
type Failure struct {
	// ID is the Canva design's id (absent on failures recorded before 0.3.5).
	ID     string `json:"id,omitempty"`
	Name   string `json:"name"`
	Code   string `json:"code"`
	Detail string `json:"detail,omitempty"`
}

// Run is one import, as its owner sees it.
type Run struct {
	ID             string     `json:"id"`
	WorkspaceID    string     `json:"workspaceId"`
	UserID         string     `json:"-"`
	TargetFolderID *string    `json:"targetFolderId"`
	Picks          []Pick     `json:"-"`
	Untitled       string     `json:"-"`
	Status         string     `json:"status"`
	StopRequested  bool       `json:"stopRequested"`
	ResumeAt       *time.Time `json:"resumeAt,omitempty"`
	Total          *int       `json:"total"`
	Imported       int        `json:"imported"`
	Skipped        int        `json:"skipped"`
	Failed         int        `json:"failed"`
	AsImages       int        `json:"asImages"`
	Current        string     `json:"current"`
	Waiting        bool       `json:"waiting"`
	Halted         string     `json:"halted,omitempty"`
	HaltedDetail   string     `json:"haltedDetail,omitempty"`
	Failures       []Failure  `json:"failures"`
	Dismissed      bool       `json:"dismissed"`
	CreatedAt      time.Time  `json:"createdAt"`
	StartedAt      *time.Time `json:"startedAt,omitempty"`
	FinishedAt     *time.Time `json:"finishedAt,omitempty"`
}

// Active reports whether the run has not ended yet.
func (r Run) Active() bool {
	return r.Status == StatusQueued || r.Status == StatusRunning || r.Status == StatusPaused
}

// progress is what a running run writes as it goes.
type progress struct {
	Total    *int
	Imported int
	Skipped  int
	Failed   int
	AsImages int
	Current  string
	Waiting  bool
	Failures []Failure
}

// store is the persistence the runner needs; sqlStore is the real one.
type store interface {
	create(ctx context.Context, r Run) (Run, error)
	get(ctx context.Context, id string) (Run, error)
	// listForUser lists the owner's runs: those not dismissed, oldest first,
	// or with all the most recent ones, dismissed too, newest first.
	listForUser(ctx context.Context, userID string, all bool) ([]Run, error)
	// requeue puts runs left "running" by a previous process back in line.
	requeue(ctx context.Context) error
	// claim marks up to n startable runs running and returns them: queued, or
	// paused with resume_at passed, and never a second run of the same owner.
	claim(ctx context.Context, n int, now time.Time) ([]Run, error)
	saveProgress(ctx context.Context, id string, p progress) error
	stopRequested(ctx context.Context, id string) (bool, error)
	requestStop(ctx context.Context, id string) error
	finish(ctx context.Context, id, status, halted, detail string, resumeAt *time.Time) error
	dismiss(ctx context.Context, id string) error
	markImported(ctx context.Context, runID, canvaDesignID string) error
	importedByRun(ctx context.Context, runID string) (map[string]bool, error)
}

// DBTX is the query surface (satisfied by *pgxpool.Pool and pgx.Tx).
type DBTX interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

type sqlStore struct{ db DBTX }

// ErrNotFound is a run that does not exist (or is not the caller's).
var ErrNotFound = errors.New("import run not found")

const runCols = `id::text, "workspace_id"::text, "user_id"::text, "target_folder_id"::text, picks, untitled, status,
	"stop_requested", "resume_at", total, imported, skipped, failed, "as_images", "current", waiting,
	halted, "halted_detail", failures, dismissed, "created_at", "started_at", "finished_at"`

func scanRun(row pgx.Row) (Run, error) {
	var (
		r                    Run
		picks, failures      []byte
		halted, haltedDetail *string
	)
	err := row.Scan(&r.ID, &r.WorkspaceID, &r.UserID, &r.TargetFolderID, &picks, &r.Untitled, &r.Status,
		&r.StopRequested, &r.ResumeAt, &r.Total, &r.Imported, &r.Skipped, &r.Failed, &r.AsImages, &r.Current, &r.Waiting,
		&halted, &haltedDetail, &failures, &r.Dismissed, &r.CreatedAt, &r.StartedAt, &r.FinishedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Run{}, ErrNotFound
	}
	if err != nil {
		return Run{}, err
	}
	_ = json.Unmarshal(picks, &r.Picks)
	_ = json.Unmarshal(failures, &r.Failures)
	if r.Failures == nil {
		r.Failures = []Failure{}
	}
	if halted != nil {
		r.Halted = *halted
	}
	if haltedDetail != nil {
		r.HaltedDetail = *haltedDetail
	}
	return r, nil
}

func collect(rows pgx.Rows) ([]Run, error) {
	defer rows.Close()
	out := []Run{}
	for rows.Next() {
		r, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s sqlStore) create(ctx context.Context, r Run) (Run, error) {
	picks, err := json.Marshal(r.Picks)
	if err != nil {
		return Run{}, err
	}
	return scanRun(s.db.QueryRow(ctx, `INSERT INTO "canva_import_runs" (id, "workspace_id", "user_id", "target_folder_id", picks, untitled, "created_at")
		VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp()) RETURNING `+runCols,
		uuid.NewString(), r.WorkspaceID, r.UserID, r.TargetFolderID, picks, r.Untitled))
}

func (s sqlStore) get(ctx context.Context, id string) (Run, error) {
	if _, err := uuid.Parse(id); err != nil {
		return Run{}, ErrNotFound
	}
	return scanRun(s.db.QueryRow(ctx, `SELECT `+runCols+` FROM "canva_import_runs" WHERE id = $1`, id))
}

func (s sqlStore) listForUser(ctx context.Context, userID string, all bool) ([]Run, error) {
	q := `SELECT ` + runCols + ` FROM "canva_import_runs" WHERE "user_id" = $1 AND NOT dismissed ORDER BY "created_at" LIMIT 20`
	if all {
		q = `SELECT ` + runCols + ` FROM "canva_import_runs" WHERE "user_id" = $1 ORDER BY "created_at" DESC LIMIT 20`
	}
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	return collect(rows)
}

func (s sqlStore) requeue(ctx context.Context) error {
	_, err := s.db.Exec(ctx, `UPDATE "canva_import_runs" SET status = 'queued', waiting = false, "updated_at" = now() WHERE status = 'running'`)
	return err
}

func (s sqlStore) claim(ctx context.Context, n int, now time.Time) ([]Run, error) {
	if n <= 0 {
		return nil, nil
	}
	// One statement, so two claims cannot start the same run, nor two runs of
	// one owner: the candidates exclude owners with a running run, and only
	// each owner's oldest candidate is taken.
	rows, err := s.db.Query(ctx, `WITH cand AS (
			SELECT DISTINCT ON ("user_id") id FROM "canva_import_runs" r
			WHERE (r.status = 'queued' OR (r.status = 'paused' AND r."resume_at" <= $2))
			  AND NOT EXISTS (SELECT 1 FROM "canva_import_runs" x WHERE x."user_id" = r."user_id" AND x.status = 'running')
			ORDER BY "user_id", "created_at"
		), pick AS (
			SELECT c.id FROM cand c JOIN "canva_import_runs" r ON r.id = c.id ORDER BY r."created_at" LIMIT $1
		)
		UPDATE "canva_import_runs" r SET status = 'running', "resume_at" = NULL, waiting = false,
			"started_at" = COALESCE(r."started_at", now()), "updated_at" = now()
		FROM pick WHERE r.id = pick.id AND r.status IN ('queued', 'paused')
		RETURNING `+runColsR, n, now)
	if err != nil {
		return nil, err
	}
	return collect(rows)
}

// runColsR is runCols qualified with the alias r (UPDATE ... FROM needs it).
const runColsR = `r.id::text, r."workspace_id"::text, r."user_id"::text, r."target_folder_id"::text, r.picks, r.untitled, r.status,
	r."stop_requested", r."resume_at", r.total, r.imported, r.skipped, r.failed, r."as_images", r."current", r.waiting,
	r.halted, r."halted_detail", r.failures, r.dismissed, r."created_at", r."started_at", r."finished_at"`

func (s sqlStore) saveProgress(ctx context.Context, id string, p progress) error {
	failures, err := json.Marshal(p.Failures)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `UPDATE "canva_import_runs" SET total = $2, imported = $3, skipped = $4, failed = $5,
		"as_images" = $6, "current" = $7, waiting = $8, failures = $9, "updated_at" = now() WHERE id = $1`,
		id, p.Total, p.Imported, p.Skipped, p.Failed, p.AsImages, p.Current, p.Waiting, failures)
	return err
}

func (s sqlStore) stopRequested(ctx context.Context, id string) (bool, error) {
	var stop bool
	err := s.db.QueryRow(ctx, `SELECT "stop_requested" FROM "canva_import_runs" WHERE id = $1`, id).Scan(&stop)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, nil // the run is gone (its workspace or owner was deleted)
	}
	return stop, err
}

func (s sqlStore) requestStop(ctx context.Context, id string) error {
	// A run that has not started yet ends right away; a running one stops
	// after the design it is on.
	_, err := s.db.Exec(ctx, `UPDATE "canva_import_runs" SET "stop_requested" = true,
		status = CASE WHEN status IN ('queued', 'paused') THEN 'stopped' ELSE status END,
		"finished_at" = CASE WHEN status IN ('queued', 'paused') THEN now() ELSE "finished_at" END,
		"updated_at" = now() WHERE id = $1`, id)
	return err
}

func (s sqlStore) finish(ctx context.Context, id, status, halted, detail string, resumeAt *time.Time) error {
	var h, d *string
	if halted != "" {
		h = &halted
	}
	if detail != "" {
		d = &detail
	}
	_, err := s.db.Exec(ctx, `UPDATE "canva_import_runs" SET status = $2, halted = $3, "halted_detail" = $4, "resume_at" = $5,
		waiting = false, "current" = '',
		"finished_at" = CASE WHEN $2 IN ('done', 'stopped', 'halted') THEN now() ELSE NULL END, "updated_at" = now()
		WHERE id = $1`, id, status, h, d, resumeAt)
	return err
}

func (s sqlStore) dismiss(ctx context.Context, id string) error {
	_, err := s.db.Exec(ctx, `UPDATE "canva_import_runs" SET dismissed = true, "updated_at" = now()
		WHERE id = $1 AND status IN ('done', 'stopped', 'halted')`, id)
	return err
}

func (s sqlStore) markImported(ctx context.Context, runID, canvaDesignID string) error {
	_, err := s.db.Exec(ctx, `INSERT INTO "canva_import_run_designs" ("run_id", "canva_design_id") VALUES ($1, $2)
		ON CONFLICT DO NOTHING`, runID, canvaDesignID)
	return err
}

func (s sqlStore) importedByRun(ctx context.Context, runID string) (map[string]bool, error) {
	rows, err := s.db.Query(ctx, `SELECT "canva_design_id" FROM "canva_import_run_designs" WHERE "run_id" = $1`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}
