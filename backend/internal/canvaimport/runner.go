package canvaimport

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"sync"
	"time"

	"hycanvas/backend/internal/canva"
	"hycanvas/backend/internal/home"
	"hycanvas/backend/internal/persistence"
	"hycanvas/backend/internal/pptxconv"
)

// Canva is the Canva module surface a run uses (internal/canva.Service).
type Canva interface {
	Connection(ctx context.Context, ws, userID string) (canva.ConnectionView, error)
	ListFolder(ctx context.Context, ws, userID, folderID, continuation string) (canva.FolderPage, error)
	StartExport(ctx context.Context, ws, userID, designID string) (canva.Export, error)
	GetExport(ctx context.Context, ws, userID, jobID string) (canva.ExportStatus, error)
	ExportFile(ctx context.Context, ws, userID, jobID string, index int) (io.ReadCloser, string, error)
	Imported(ctx context.Context, ws string) (map[string]string, error)
	RecordImport(ctx context.Context, ws, canvaDesignID, designID string) error
}

// Folders mirrors the Canva folder tree (internal/home.Service). Each call
// checks the owner's membership itself.
type Folders interface {
	ListFolders(ctx context.Context, userID, ws string) ([]home.Folder, error)
	CreateFolder(ctx context.Context, userID, ws, name string, parentID *string) (home.Folder, error)
	Move(ctx context.Context, userID, ws string, designIDs, folderIDs []string, target *string) error
}

// Designs creates the imported designs (internal/persistence.Service).
type Designs interface {
	Create(ctx context.Context, ws, title string, from persistence.DesignFile, authorID *string) (persistence.DesignRecord, error)
}

// Access checks that the owner may still add designs to the workspace.
type Access interface {
	AssertMember(ctx context.Context, userID, ws, minRole string) error
}

// Converter turns exports into design file JSON (internal/pptxconv).
type Converter interface {
	PPTX(ctx context.Context, data []byte, title string) ([]byte, error)
	ImagePages(ctx context.Context, title string, pages []pptxconv.Page) ([]byte, error)
}

type pptxConverter struct{}

func (pptxConverter) PPTX(ctx context.Context, data []byte, title string) ([]byte, error) {
	return pptxconv.PPTX(ctx, data, title)
}
func (pptxConverter) ImagePages(ctx context.Context, title string, pages []pptxconv.Page) ([]byte, error) {
	return pptxconv.ImagePages(ctx, title, pages)
}

const (
	// maxConcurrent runs execute at once (one per owner); the rest wait.
	maxConcurrent = 4
	// exportsPerWindow / exportWindow pace export starts under Canva's 75
	// per 5 minutes and per user.
	exportsPerWindow = 14
	exportWindow     = time.Minute
	// rateWait is how long a rate limit is waited out when Canva names no time.
	rateWait = time.Minute
	// maxRateRetries rate limits in a row on one call halt the run.
	maxRateRetries = 6
	pollEvery      = 2 * time.Second
	exportTimeout  = 15 * time.Minute
	// dailyRetry is when a run paused by the daily limit tries again when
	// Canva names no time.
	dailyRetry = time.Hour
	// tick is how often the worker looks for startable runs (a new run wakes
	// it at once).
	tick = 30 * time.Second
)

// Service runs Canva imports.
type Service struct {
	store   store
	canva   Canva
	folders Folders
	designs Designs
	access  Access
	conv    Converter
	log     *slog.Logger

	now   func() time.Time
	sleep func(ctx context.Context, d time.Duration) error

	wake    chan struct{}
	mu      sync.Mutex
	running int
}

// NewService wires the module.
func NewService(db DBTX, c Canva, f Folders, d Designs, a Access, log *slog.Logger) *Service {
	return newService(sqlStore{db}, c, f, d, a, pptxConverter{}, log)
}

func newService(st store, c Canva, f Folders, d Designs, a Access, conv Converter, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{
		store: st, canva: c, folders: f, designs: d, access: a, conv: conv, log: log,
		now:   time.Now,
		sleep: sleepCtx,
		wake:  make(chan struct{}, 1),
	}
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// --- API ---------------------------------------------------------------------

// ErrForbidden is a caller who may not start or see this run.
var ErrForbidden = errors.New("forbidden")

// ErrBadRequest is a start with an unusable selection.
var ErrBadRequest = errors.New("invalid import request")

// maxPicks bounds one selection.
const maxPicks = 5000

// Start queues an import of picks into targetFolderID (nil = the workspace
// root) for the caller. untitled names untitled designs and folders in the
// caller's language.
func (s *Service) Start(ctx context.Context, ws, userID string, targetFolderID *string, picks []Pick, untitled string) (Run, error) {
	if err := s.access.AssertMember(ctx, userID, ws, "member"); err != nil {
		return Run{}, ErrForbidden
	}
	if len(picks) == 0 || len(picks) > maxPicks {
		return Run{}, ErrBadRequest
	}
	for _, p := range picks {
		if (p.Type != "folder" && p.Type != "design") || p.ID == "" || len(p.ID) > 200 || len(p.Ancestors) > 100 {
			return Run{}, ErrBadRequest
		}
	}
	if targetFolderID != nil {
		folders, err := s.folders.ListFolders(ctx, userID, ws)
		if err != nil {
			return Run{}, err
		}
		found := false
		for _, f := range folders {
			found = found || f.ID == *targetFolderID
		}
		if !found {
			return Run{}, ErrBadRequest
		}
	}
	conn, err := s.canva.Connection(ctx, ws, userID)
	if err != nil {
		return Run{}, err
	}
	if !conn.Configured {
		return Run{}, canva.ErrNotConfigured
	}
	if !conn.Connected {
		return Run{}, canva.ErrNotConnected
	}
	untitled = strings.TrimSpace(untitled)
	if untitled == "" || len(untitled) > 100 {
		untitled = "Untitled"
	}
	r, err := s.store.create(ctx, Run{WorkspaceID: ws, UserID: userID, TargetFolderID: targetFolderID, Picks: picks, Untitled: untitled})
	if err != nil {
		return Run{}, err
	}
	s.poke()
	return r, nil
}

// Mine lists the caller's runs that are not dismissed, oldest first.
func (s *Service) Mine(ctx context.Context, userID string) ([]Run, error) {
	return s.store.listForUser(ctx, userID)
}

func (s *Service) own(ctx context.Context, userID, id string) (Run, error) {
	r, err := s.store.get(ctx, id)
	if err != nil {
		return Run{}, err
	}
	if r.UserID != userID {
		return Run{}, ErrNotFound
	}
	return r, nil
}

// Stop ends the caller's run: at once when it has not started, after the
// design it is on when it runs.
func (s *Service) Stop(ctx context.Context, userID, id string) (Run, error) {
	if _, err := s.own(ctx, userID, id); err != nil {
		return Run{}, err
	}
	if err := s.store.requestStop(ctx, id); err != nil {
		return Run{}, err
	}
	s.poke()
	return s.store.get(ctx, id)
}

// Dismiss hides the caller's ended run from the progress view.
func (s *Service) Dismiss(ctx context.Context, userID, id string) error {
	if _, err := s.own(ctx, userID, id); err != nil {
		return err
	}
	return s.store.dismiss(ctx, id)
}

func (s *Service) poke() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

// --- worker ------------------------------------------------------------------

// Run executes queued imports until ctx ends. Runs a previous process left
// running are taken up again (they skip what they already imported).
func (s *Service) Run(ctx context.Context) {
	if err := s.store.requeue(ctx); err != nil && ctx.Err() == nil {
		s.log.Warn("canva import: requeue failed", "err", err)
	}
	t := time.NewTicker(tick)
	defer t.Stop()
	var wg sync.WaitGroup
	defer wg.Wait()
	for {
		s.mu.Lock()
		free := maxConcurrent - s.running
		s.mu.Unlock()
		runs, err := s.store.claim(ctx, free, s.now())
		if err != nil && ctx.Err() == nil {
			s.log.Warn("canva import: claim failed", "err", err)
		}
		for _, r := range runs {
			s.mu.Lock()
			s.running++
			s.mu.Unlock()
			wg.Add(1)
			go func(r Run) {
				defer wg.Done()
				s.execute(ctx, r)
				s.mu.Lock()
				s.running--
				s.mu.Unlock()
				s.poke()
			}(r)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		case <-s.wake:
		}
	}
}

// halt ends a run early with a reason.
type halt struct {
	code, detail string
	pause        time.Duration // > 0: the daily limit, pause and resume
}

func (h *halt) Error() string { return h.code + ": " + h.detail }

// stopped is the owner's stop (or the process shutting down).
var errStopped = errors.New("stopped")

// execute runs one import to its end, a stop, a halt or a pause.
func (s *Service) execute(ctx context.Context, r Run) {
	x := &execution{s: s, r: r, ctx: ctx}
	status, h := x.run()
	if ctx.Err() != nil {
		return // shutting down: the run stays "running" and is requeued on start
	}
	var resumeAt *time.Time
	halted, detail := "", ""
	if h != nil {
		if h.pause > 0 {
			status = StatusPaused
			t := s.now().Add(h.pause)
			resumeAt = &t
		} else {
			status = StatusHalted
			halted, detail = h.code, h.detail
		}
	}
	x.save()
	if err := s.store.finish(context.WithoutCancel(ctx), r.ID, status, halted, detail, resumeAt); err != nil {
		s.log.Warn("canva import: finish failed", "run", r.ID, "err", err)
	}
	if status == StatusDone || status == StatusStopped || status == StatusHalted {
		s.log.Info("canva import: run ended", "run", r.ID, "status", status, "imported", x.p.Imported, "skipped", x.p.Skipped, "failed", x.p.Failed, "halted", halted)
	}
}

type execution struct {
	s   *Service
	r   Run
	ctx context.Context
	p   progress
	// folderIDs maps "<parent id>/<lower-case name>" to folder ids.
	folderIDs map[string]string
}

func (x *execution) save() {
	if err := x.s.store.saveProgress(context.WithoutCancel(x.ctx), x.r.ID, x.p); err != nil {
		x.s.log.Warn("canva import: progress not saved", "run", x.r.ID, "err", err)
	}
}

func (x *execution) stopped() bool {
	if x.ctx.Err() != nil {
		return true
	}
	stop, err := x.s.store.stopRequested(x.ctx, x.r.ID)
	return err == nil && stop
}

// sleep waits d, checking for a stop every few seconds.
func (x *execution) sleep(d time.Duration) error {
	for d > 0 {
		step := d
		if step > 5*time.Second {
			step = 5 * time.Second
		}
		if err := x.s.sleep(x.ctx, step); err != nil {
			return err
		}
		d -= step
		if x.stopped() {
			return errStopped
		}
	}
	return nil
}

// canvaCall runs a Canva call, waiting out rate limits; the daily limit
// pauses the run, a disconnected account halts it.
func canvaCall[T any](x *execution, call func() (T, error)) (T, error) {
	var zero T
	for attempt := 0; ; attempt++ {
		out, err := call()
		if err == nil {
			if x.p.Waiting {
				x.p.Waiting = false
				x.save()
			}
			return out, nil
		}
		var rl *canva.RateLimitError
		switch {
		case errors.As(err, &rl):
			if rl.Daily {
				wait := rl.RetryAfter
				if wait <= 0 {
					wait = dailyRetry
				}
				return zero, &halt{code: "daily_limit", pause: wait}
			}
			if attempt >= maxRateRetries {
				return zero, &halt{code: HaltRateLimit}
			}
			x.p.Waiting = true
			x.save()
			wait := rl.RetryAfter
			if wait <= 0 {
				wait = rateWait
			}
			if err := x.sleep(wait); err != nil {
				return zero, err
			}
		case errors.Is(err, canva.ErrNotConnected), errors.Is(err, canva.ErrNotConfigured):
			return zero, &halt{code: HaltNotConnected}
		default:
			return zero, err
		}
	}
}

// run returns the final status, or a halt.
func (x *execution) run() (string, *halt) {
	ws, user := x.r.WorkspaceID, x.r.UserID
	asHalt := func(err error) *halt {
		var h *halt
		if errors.As(err, &h) {
			return h
		}
		return &halt{code: HaltError, detail: err.Error()}
	}
	if err := x.s.access.AssertMember(x.ctx, user, ws, "member"); err != nil {
		return "", &halt{code: HaltAccessLost}
	}

	// Counters start from what this run already imported (a resumed run);
	// skipped and failed are counted afresh (failed designs are retried).
	mine, err := x.s.store.importedByRun(x.ctx, x.r.ID)
	if err != nil {
		return "", asHalt(err)
	}
	x.p = progress{Imported: len(mine), AsImages: x.r.AsImages, Failures: []Failure{}}

	x.p.Current = ""
	x.save()
	plan, err := planImport(x.ctx, x.r.Picks, func(ctx context.Context, id, cont string) (canva.FolderPage, error) {
		return canvaCall(x, func() (canva.FolderPage, error) { return x.s.canva.ListFolder(ctx, ws, user, id, cont) })
	}, x.r.Untitled, func(name string) {
		x.p.Current = name
		x.save()
	}, x.stopped)
	if err != nil {
		if errors.Is(err, errStopped) || x.stopped() {
			return StatusStopped, nil
		}
		return "", asHalt(err)
	}
	total := len(plan.Designs)
	x.p.Total = &total
	x.p.Current = ""
	x.save()
	if x.stopped() {
		return StatusStopped, nil
	}

	// Mirror the folders (existing ones of the same name are reused).
	x.folderIDs = map[string]string{}
	existing, err := x.s.folders.ListFolders(x.ctx, user, ws)
	if err != nil {
		return "", &halt{code: HaltAccessLost}
	}
	for _, f := range existing {
		parent := ""
		if f.ParentID != nil {
			parent = *f.ParentID
		}
		x.folderIDs[parent+"/"+strings.ToLower(f.Name)] = f.ID
	}
	for _, path := range plan.Folders {
		if x.stopped() {
			return StatusStopped, nil
		}
		if _, err := x.ensureFolder(path); err != nil {
			return "", asHalt(err)
		}
	}

	imported, err := x.s.canva.Imported(x.ctx, ws)
	if err != nil {
		return "", asHalt(err)
	}
	// What is already in danvas (from earlier runs, not this one) is counted
	// up front, so the progress shows how much is left to import.
	for _, d := range plan.Designs {
		if imported[d.ID] != "" && !mine[d.ID] {
			x.p.Skipped++
		}
	}
	x.save()
	pace := newPacer(exportsPerWindow, exportWindow, x.s.now, x.s.sleep)
	for _, d := range plan.Designs {
		if x.stopped() {
			return StatusStopped, nil
		}
		label := strings.Join(append(append([]string(nil), d.Path...), d.Title), " / ")
		if imported[d.ID] != "" {
			continue
		}
		// The owner may have lost access to the workspace while this ran.
		if err := x.s.access.AssertMember(x.ctx, user, ws, "member"); err != nil {
			return "", &halt{code: HaltAccessLost}
		}
		x.p.Current = label
		x.save()
		if err := pace.wait(x.ctx); err != nil {
			return StatusStopped, nil
		}
		asImages, err := x.importOne(d)
		if err != nil {
			var h *halt
			if errors.As(err, &h) {
				return "", h
			}
			if errors.Is(err, errStopped) || x.ctx.Err() != nil {
				return StatusStopped, nil
			}
			x.fail(label, err)
			continue
		}
		x.p.Imported++
		if asImages {
			x.p.AsImages++
		}
		x.save()
	}
	return StatusDone, nil
}

// designFailure is a design that could not be imported, with its code.
type designFailure struct {
	code, detail string
}

func (e *designFailure) Error() string { return e.code + ": " + e.detail }

func (x *execution) fail(label string, err error) {
	x.p.Failed++
	f := Failure{Name: label, Code: FailOther, Detail: err.Error()}
	var df *designFailure
	if errors.As(err, &df) {
		f.Code, f.Detail = df.code, df.detail
	}
	if len(x.p.Failures) < maxFailures {
		x.p.Failures = append(x.p.Failures, f)
	}
	x.save()
}

// importOne exports, converts, creates, files and records one design.
// It reports whether the design arrived as page images.
func (x *execution) importOne(d PlannedDesign) (bool, error) {
	ws, user := x.r.WorkspaceID, x.r.UserID
	exp, err := canvaCall(x, func() (canva.Export, error) { return x.s.canva.StartExport(x.ctx, ws, user, d.ID) })
	if err != nil {
		if errors.Is(err, canva.ErrNoExport) {
			// Record what Canva does offer, to tell such designs apart.
			offered := ""
			var ne *canva.NoExportError
			if errors.As(err, &ne) {
				offered = strings.Join(ne.Offered, ", ")
			}
			x.s.log.Info("canva import: no export format", "run", x.r.ID, "design", d.ID, "offered", offered)
			return false, &designFailure{code: FailNoExport, detail: offered}
		}
		return false, err
	}
	deadline := x.s.now().Add(exportTimeout)
	st, err := canvaCall(x, func() (canva.ExportStatus, error) { return x.s.canva.GetExport(x.ctx, ws, user, exp.JobID) })
	for err == nil && st.Status == "in_progress" {
		if x.s.now().After(deadline) {
			return false, &designFailure{code: FailExportTimeout}
		}
		if err := x.s.sleep(x.ctx, pollEvery); err != nil {
			return false, err
		}
		st, err = canvaCall(x, func() (canva.ExportStatus, error) { return x.s.canva.GetExport(x.ctx, ws, user, exp.JobID) })
	}
	if err != nil {
		return false, err
	}
	if st.Status != "success" || st.Files == 0 {
		reason := st.Error
		if reason == "" {
			reason = st.Status
		}
		return false, &designFailure{code: FailExportFailed, detail: reason}
	}
	files := make([][]byte, 0, st.Files)
	types := make([]string, 0, st.Files)
	total := 0
	for i := 0; i < st.Files; i++ {
		fb, err := canvaCall(x, func() (fileBody, error) {
			rc, ct, err := x.s.canva.ExportFile(x.ctx, ws, user, exp.JobID, i)
			return fileBody{rc, ct}, err
		})
		if err != nil {
			return false, err
		}
		body, ctype := fb.rc, fb.ctype
		data, err := io.ReadAll(io.LimitReader(body, int64(pptxconv.MaxInputBytes)-int64(total)+1))
		body.Close()
		if err != nil {
			return false, err
		}
		total += len(data)
		if total > pptxconv.MaxInputBytes {
			return false, &designFailure{code: FailTooLarge}
		}
		files = append(files, data)
		types = append(types, mimeOf(ctype))
	}

	var raw []byte
	asImages := exp.Format != "pptx"
	if asImages {
		pages := make([]pptxconv.Page, len(files))
		for i := range files {
			pages[i] = pptxconv.Page{Bytes: files[i], MIME: types[i]}
		}
		raw, err = x.s.conv.ImagePages(x.ctx, d.Title, pages)
	} else {
		raw, err = x.s.conv.PPTX(x.ctx, files[0], d.Title)
	}
	if err != nil {
		if errors.Is(err, pptxconv.ErrTooLarge) {
			return false, &designFailure{code: FailTooLarge}
		}
		if x.ctx.Err() != nil {
			return false, x.ctx.Err()
		}
		return false, &designFailure{code: FailConvert, detail: err.Error()}
	}
	var file persistence.DesignFile
	if err := json.Unmarshal(raw, &file); err != nil || file == nil {
		if err == nil {
			err = errors.New("empty design")
		}
		return false, &designFailure{code: FailConvert, detail: err.Error()}
	}
	file["title"] = d.Title

	folderID, err := x.ensureFolder(d.Path)
	if err != nil {
		return false, err
	}
	rec, err := x.s.designs.Create(x.ctx, ws, d.Title, file, &user)
	if err != nil {
		return false, err
	}
	if folderID != nil {
		if err := x.s.folders.Move(x.ctx, user, ws, []string{rec.ID}, nil, folderID); err != nil {
			return false, err
		}
	}
	if err := x.s.canva.RecordImport(x.ctx, ws, d.ID, rec.ID); err != nil {
		x.s.log.Warn("canva import: not recorded", "run", x.r.ID, "design", rec.ID, "err", err)
	}
	if err := x.s.store.markImported(x.ctx, x.r.ID, d.ID); err != nil {
		x.s.log.Warn("canva import: run record not written", "run", x.r.ID, "err", err)
	}
	return asImages, nil
}

type fileBody struct {
	rc    io.ReadCloser
	ctype string
}

func mimeOf(ctype string) string {
	m := strings.TrimSpace(strings.SplitN(ctype, ";", 2)[0])
	if !strings.HasPrefix(m, "image/") {
		return "image/png"
	}
	return m
}

// ensureFolder returns the id of the folder at path below the run's target,
// creating what is missing (nil for the workspace root).
func (x *execution) ensureFolder(path []string) (*string, error) {
	parent := x.r.TargetFolderID
	for _, name := range path {
		p := ""
		if parent != nil {
			p = *parent
		}
		key := p + "/" + strings.ToLower(name)
		id, ok := x.folderIDs[key]
		if !ok {
			f, err := x.s.folders.CreateFolder(x.ctx, x.r.UserID, x.r.WorkspaceID, name, parent)
			if err != nil {
				return nil, fmt.Errorf("create folder %q: %w", name, err)
			}
			id = f.ID
			x.folderIDs[key] = id
		}
		parent = &id
	}
	return parent, nil
}
