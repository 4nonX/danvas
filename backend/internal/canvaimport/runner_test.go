package canvaimport

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"hycanvas/backend/internal/canva"
	"hycanvas/backend/internal/home"
	"hycanvas/backend/internal/persistence"
	"hycanvas/backend/internal/pptxconv"
)

// --- fakes -------------------------------------------------------------------

type memStore struct {
	mu       sync.Mutex
	runs     map[string]*Run
	order    []string
	designs  map[string]map[string]bool
	stopNext bool // requestStop is reported once the first design is imported
}

func newMemStore() *memStore {
	return &memStore{runs: map[string]*Run{}, designs: map[string]map[string]bool{}}
}

func (m *memStore) create(_ context.Context, r Run) (Run, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r.ID = fmt.Sprintf("run-%d", len(m.order)+1)
	r.Status = StatusQueued
	r.Failures = []Failure{}
	r.CreatedAt = time.Unix(int64(len(m.order)), 0)
	m.runs[r.ID] = &r
	m.order = append(m.order, r.ID)
	return r, nil
}

func (m *memStore) get(_ context.Context, id string) (Run, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.runs[id]
	if !ok {
		return Run{}, ErrNotFound
	}
	return *r, nil
}

func (m *memStore) listForUser(_ context.Context, userID string, _ bool) ([]Run, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []Run{}
	for _, id := range m.order {
		if r := m.runs[id]; r.UserID == userID {
			out = append(out, *r)
		}
	}
	return out, nil
}

func (m *memStore) requeue(context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, r := range m.runs {
		if r.Status == StatusRunning {
			r.Status = StatusQueued
		}
	}
	return nil
}

func (m *memStore) claim(_ context.Context, n int, now time.Time) ([]Run, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	busy := map[string]bool{}
	for _, r := range m.runs {
		if r.Status == StatusRunning {
			busy[r.UserID] = true
		}
	}
	var out []Run
	for _, id := range m.order {
		r := m.runs[id]
		startable := r.Status == StatusQueued || (r.Status == StatusPaused && r.ResumeAt != nil && !r.ResumeAt.After(now))
		if len(out) >= n || !startable || busy[r.UserID] {
			continue
		}
		busy[r.UserID] = true
		r.Status, r.ResumeAt = StatusRunning, nil
		out = append(out, *r)
	}
	return out, nil
}

func (m *memStore) saveProgress(_ context.Context, id string, p progress) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	r := m.runs[id]
	r.Total, r.Imported, r.Skipped, r.Failed, r.AsImages = p.Total, p.Imported, p.Skipped, p.Failed, p.AsImages
	r.Current, r.Waiting = p.Current, p.Waiting
	r.Failures = append([]Failure{}, p.Failures...)
	return nil
}

func (m *memStore) stopRequested(_ context.Context, id string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.stopNext && len(m.designs[id]) > 0 {
		m.runs[id].StopRequested = true
	}
	return m.runs[id].StopRequested, nil
}

func (m *memStore) requestStop(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	r := m.runs[id]
	r.StopRequested = true
	if r.Status == StatusQueued || r.Status == StatusPaused {
		r.Status = StatusStopped
	}
	return nil
}

func (m *memStore) finish(_ context.Context, id, status, halted, detail string, resumeAt *time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	r := m.runs[id]
	r.Status, r.Halted, r.HaltedDetail, r.ResumeAt, r.Waiting, r.Current = status, halted, detail, resumeAt, false, ""
	return nil
}

func (m *memStore) dismiss(context.Context, string) error { return nil }

func (m *memStore) markImported(_ context.Context, runID, canvaDesignID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.designs[runID] == nil {
		m.designs[runID] = map[string]bool{}
	}
	m.designs[runID][canvaDesignID] = true
	return nil
}

func (m *memStore) importedByRun(_ context.Context, runID string) (map[string]bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]bool{}
	for k := range m.designs[runID] {
		out[k] = true
	}
	return out, nil
}

type fakeCanva struct {
	mu        sync.Mutex
	connected bool
	imported  map[string]string
	// errs are returned, in order, by StartExport before it succeeds.
	errs []error
	// failExport names designs whose export fails.
	failExport map[string]bool
	// png names designs exported as page images.
	png map[string]bool
	// noExport names designs Canva offers no usable format for.
	noExport map[string]bool
	exports  int
	polls    int
}

func newFakeCanva() *fakeCanva {
	return &fakeCanva{connected: true, imported: map[string]string{}, failExport: map[string]bool{}, png: map[string]bool{}, noExport: map[string]bool{}}
}

func (f *fakeCanva) Connection(context.Context, string, string) (canva.ConnectionView, error) {
	return canva.ConnectionView{Configured: true, Connected: f.connected}, nil
}

func (f *fakeCanva) ListFolder(ctx context.Context, _, _, id, cont string) (canva.FolderPage, error) {
	return treeLister(&[]string{})(ctx, id, cont)
}

func (f *fakeCanva) StartExport(_ context.Context, _, _, designID string) (canva.Export, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.errs) > 0 {
		err := f.errs[0]
		f.errs = f.errs[1:]
		return canva.Export{}, err
	}
	if f.noExport[designID] {
		return canva.Export{}, &canva.NoExportError{Offered: []string{"pdf", "pptx [1]"}}
	}
	f.exports++
	format := "pptx"
	if f.png[designID] {
		format = "png"
	}
	return canva.Export{JobID: designID, Format: format}, nil
}

func (f *fakeCanva) GetExport(_ context.Context, _, _, jobID string) (canva.ExportStatus, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.polls++
	if f.polls%2 == 1 {
		return canva.ExportStatus{Status: "in_progress"}, nil
	}
	if f.failExport[jobID] {
		return canva.ExportStatus{Status: "failed", Error: "license_required"}, nil
	}
	files := 1
	if f.png[jobID] {
		files = 2
	}
	return canva.ExportStatus{Status: "success", Files: files}, nil
}

func (f *fakeCanva) ExportFile(_ context.Context, _, _, jobID string, index int) (io.ReadCloser, string, error) {
	ct := "application/vnd.openxmlformats-officedocument.presentationml.presentation"
	if f.png[jobID] {
		ct = "image/png"
	}
	return io.NopCloser(strings.NewReader(fmt.Sprintf("%s#%d", jobID, index))), ct, nil
}

func (f *fakeCanva) Imported(context.Context, string) (map[string]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[string]string{}
	for k, v := range f.imported {
		out[k] = v
	}
	return out, nil
}

func (f *fakeCanva) RecordImport(_ context.Context, _, canvaID, designID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.imported[canvaID] = designID
	return nil
}

type fakeFolders struct {
	folders []home.Folder
	moves   map[string]string // design id -> folder id
}

func (f *fakeFolders) ListFolders(context.Context, string, string) ([]home.Folder, error) {
	return append([]home.Folder(nil), f.folders...), nil
}

func (f *fakeFolders) CreateFolder(_ context.Context, _, _, name string, parent *string) (home.Folder, error) {
	nf := home.Folder{ID: fmt.Sprintf("hf-%d", len(f.folders)+1), Name: name, ParentID: parent}
	f.folders = append(f.folders, nf)
	return nf, nil
}

func (f *fakeFolders) Move(_ context.Context, _, _ string, designIDs, _ []string, target *string) error {
	for _, id := range designIDs {
		f.moves[id] = *target
	}
	return nil
}

// path returns the folder path of a home folder id.
func (f *fakeFolders) path(id string) string {
	var parts []string
	for id != "" {
		for _, x := range f.folders {
			if x.ID == id {
				parts = append([]string{x.Name}, parts...)
				id = ""
				if x.ParentID != nil {
					id = *x.ParentID
				}
				break
			}
		}
	}
	return strings.Join(parts, "/")
}

type fakeDesigns struct {
	created []string // titles
	authors []string
}

func (d *fakeDesigns) Create(_ context.Context, _, title string, from persistence.DesignFile, author *string) (persistence.DesignRecord, error) {
	d.created = append(d.created, title)
	d.authors = append(d.authors, *author)
	return persistence.DesignRecord{ID: fmt.Sprintf("d-%d", len(d.created)), Title: title}, nil
}

// designsHook calls before ahead of every create.
type designsHook struct {
	Designs
	before func()
}

func (h designsHook) Create(ctx context.Context, ws, title string, from persistence.DesignFile, author *string) (persistence.DesignRecord, error) {
	h.before()
	return h.Designs.Create(ctx, ws, title, from, author)
}

type fakeAccess struct{ denyAfter int }

func (a *fakeAccess) AssertMember(context.Context, string, string, string) error {
	if a.denyAfter == 0 {
		return errors.New("forbidden")
	}
	a.denyAfter--
	return nil
}

type fakeConv struct{ fail map[string]bool }

func (c fakeConv) PPTX(_ context.Context, data []byte, title string) ([]byte, error) {
	if c.fail[title] {
		return nil, errors.New("bad deck")
	}
	if !bytes.Contains(data, []byte("#0")) {
		return nil, errors.New("wrong file")
	}
	return []byte(`{"title":"x","pages":[]}`), nil
}

func (c fakeConv) ImagePages(_ context.Context, title string, pages []pptxconv.Page) ([]byte, error) {
	if len(pages) != 2 || pages[1].MIME != "image/png" {
		return nil, errors.New("wrong pages")
	}
	return []byte(`{"title":"x","pages":[]}`), nil
}

type rig struct {
	s       *Service
	st      *memStore
	cv      *fakeCanva
	folders *fakeFolders
	designs *fakeDesigns
	access  *fakeAccess
	slept   time.Duration
	now     time.Time
}

func newRig() *rig {
	g := &rig{st: newMemStore(), cv: newFakeCanva(), folders: &fakeFolders{moves: map[string]string{}},
		designs: &fakeDesigns{}, access: &fakeAccess{denyAfter: 1 << 30}, now: time.Unix(1000, 0)}
	g.s = newService(g.st, g.cv, g.folders, g.designs, g.access, fakeConv{}, nil)
	g.s.now = func() time.Time { return g.now }
	g.s.sleep = func(ctx context.Context, d time.Duration) error {
		g.slept += d
		g.now = g.now.Add(d)
		return ctx.Err()
	}
	return g
}

// runOnce starts a run of picks and executes it to its end.
func (g *rig) runOnce(t *testing.T, picks []Pick) Run {
	t.Helper()
	r, err := g.s.Start(context.Background(), "ws", "u1", nil, picks, "Ohne Titel")
	if err != nil {
		t.Fatal(err)
	}
	return g.resume(t, r.ID)
}

func (g *rig) resume(t *testing.T, id string) Run {
	t.Helper()
	runs, _ := g.st.claim(context.Background(), 1, g.now)
	if len(runs) != 1 || runs[0].ID != id {
		t.Fatalf("claimed %+v", runs)
	}
	g.s.execute(context.Background(), runs[0])
	r, _ := g.st.get(context.Background(), id)
	return r
}

var everything = []Pick{{Type: "folder", ID: "root"}}

// --- tests -------------------------------------------------------------------

func TestRun_ImportsTheLibraryIntoMirroredFolders(t *testing.T) {
	g := newRig()
	g.cv.png["D3"] = true
	r := g.runOnce(t, everything)
	if r.Status != StatusDone || r.Total == nil || *r.Total != 4 || r.Imported != 4 || r.AsImages != 1 || r.Failed != 0 {
		t.Fatalf("run %+v", r)
	}
	got := map[string]string{}
	for i, title := range g.designs.created {
		got[title] = g.folders.path(g.folders.moves[fmt.Sprintf("d-%d", i+1)])
	}
	want := map[string]string{"Pitch": "Clients/Acme", "Brief": "Clients", "Card": "Personal", "Loose deck": ""}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("placed %v", got)
	}
	var names []string
	for _, f := range g.folders.folders {
		names = append(names, g.folders.path(f.ID))
	}
	sort.Strings(names)
	if want := []string{"Clients", "Clients/Acme", "Clients/Empty", "Personal"}; !reflect.DeepEqual(names, want) {
		t.Fatalf("folders %v", names)
	}
	if len(g.cv.imported) != 4 || g.designs.authors[0] != "u1" {
		t.Fatalf("recorded %v authors %v", g.cv.imported, g.designs.authors)
	}
	if g.slept == 0 {
		t.Fatal("export polls did not wait")
	}
}

func TestRun_SkipsImportedDesignsAndReusesFolders(t *testing.T) {
	g := newRig()
	g.cv.imported["D1"] = "old"
	g.folders.folders = []home.Folder{{ID: "existing", Name: "clients"}}
	r := g.runOnce(t, []Pick{{Type: "folder", ID: "F1", Name: "Clients", Ancestors: []string{"root"}}})
	if r.Status != StatusDone || r.Imported != 1 || r.Skipped != 1 {
		t.Fatalf("run %+v", r)
	}
	if g.folders.moves["d-1"] != "existing" {
		t.Fatalf("moved %v", g.folders.moves)
	}
}

func TestRun_CountsWhatIsAlreadyHereBeforeExporting(t *testing.T) {
	g := newRig()
	g.cv.imported["D1"] = "old"
	g.cv.imported["D3"] = "old"
	var skippedAtFirstExport = -1
	g.s.designs = designsHook{g.designs, func() {
		if skippedAtFirstExport < 0 {
			r, _ := g.st.get(context.Background(), "run-1")
			skippedAtFirstExport = r.Skipped
		}
	}}
	r := g.runOnce(t, everything)
	if r.Status != StatusDone || *r.Total != 4 || r.Skipped != 2 || r.Imported != 2 || skippedAtFirstExport != 2 {
		t.Fatalf("run %+v skipped at first export %d", r, skippedAtFirstExport)
	}
}

func TestRun_NoExportRecordsWhatCanvaOffers(t *testing.T) {
	g := newRig()
	g.cv.noExport["D4"] = true
	r := g.runOnce(t, []Pick{{Type: "design", ID: "D4", Name: "Loose deck"}})
	want := []Failure{{Name: "Loose deck", Code: FailNoExport, Detail: "pdf, pptx [1]"}}
	if r.Status != StatusDone || r.Failed != 1 || !reflect.DeepEqual(r.Failures, want) {
		t.Fatalf("run %+v", r)
	}
}

func TestRun_FailedDesignsAreListedAndTheRunGoesOn(t *testing.T) {
	g := newRig()
	g.cv.failExport["D1"] = true
	g.s.conv = fakeConv{fail: map[string]bool{"Brief": true}}
	r := g.runOnce(t, []Pick{{Type: "folder", ID: "F1", Name: "Clients", Ancestors: []string{"root"}}})
	if r.Status != StatusDone || r.Imported != 0 || r.Failed != 2 {
		t.Fatalf("run %+v", r)
	}
	want := []Failure{
		{Name: "Clients / Acme / Pitch", Code: FailExportFailed, Detail: "license_required"},
		{Name: "Clients / Brief", Code: FailConvert, Detail: "bad deck"},
	}
	if !reflect.DeepEqual(r.Failures, want) {
		t.Fatalf("failures %+v", r.Failures)
	}
}

func TestRun_WaitsOutARateLimit(t *testing.T) {
	g := newRig()
	g.cv.errs = []error{&canva.RateLimitError{RetryAfter: 30 * time.Second}}
	r := g.runOnce(t, []Pick{{Type: "design", ID: "D4", Name: "Loose deck"}})
	if r.Status != StatusDone || r.Imported != 1 || r.Waiting || g.slept < 30*time.Second {
		t.Fatalf("run %+v slept %v", r, g.slept)
	}
}

func TestRun_HaltsWhenCanvaKeepsRefusing(t *testing.T) {
	g := newRig()
	for i := 0; i <= maxRateRetries; i++ {
		g.cv.errs = append(g.cv.errs, &canva.RateLimitError{})
	}
	r := g.runOnce(t, []Pick{{Type: "design", ID: "D4", Name: "Loose deck"}})
	if r.Status != StatusHalted || r.Halted != HaltRateLimit {
		t.Fatalf("run %+v", r)
	}
}

func TestRun_DailyLimitPausesAndResumes(t *testing.T) {
	g := newRig()
	g.cv.errs = []error{&canva.RateLimitError{RetryAfter: 3 * time.Hour, Daily: true}}
	r := g.runOnce(t, everything)
	// The first design (D1) hit the limit; nothing is imported yet.
	if r.Status != StatusPaused || r.ResumeAt == nil || !r.ResumeAt.Equal(g.now.Add(3*time.Hour)) {
		t.Fatalf("run %+v", r)
	}
	if runs, _ := g.st.claim(context.Background(), 1, g.now); len(runs) != 0 {
		t.Fatalf("claimed a paused run early: %+v", runs)
	}
	g.now = g.now.Add(3 * time.Hour)
	r = g.resume(t, r.ID)
	if r.Status != StatusDone || r.Imported != 4 || r.Skipped != 0 {
		t.Fatalf("resumed %+v", r)
	}
}

func TestRun_ResumeCountsWhatTheRunAlreadyImported(t *testing.T) {
	g := newRig()
	g.st.stopNext = true
	r := g.runOnce(t, everything)
	if r.Status != StatusStopped || r.Imported != 1 {
		t.Fatalf("run %+v", r)
	}
	// A restart requeues a run left running; it skips its own designs
	// without counting them as skipped.
	g.st.stopNext = false
	g.st.mu.Lock()
	g.st.runs[r.ID].Status, g.st.runs[r.ID].StopRequested = StatusRunning, false
	g.st.mu.Unlock()
	_ = g.st.requeue(context.Background())
	r = g.resume(t, r.ID)
	if r.Status != StatusDone || r.Imported != 4 || r.Skipped != 0 || len(g.designs.created) != 4 {
		t.Fatalf("resumed %+v created %v", r, g.designs.created)
	}
}

func TestRun_HaltsWhenTheAccountIsDisconnected(t *testing.T) {
	g := newRig()
	g.cv.errs = []error{canva.ErrNotConnected}
	r := g.runOnce(t, []Pick{{Type: "design", ID: "D4", Name: "Loose deck"}})
	if r.Status != StatusHalted || r.Halted != HaltNotConnected {
		t.Fatalf("run %+v", r)
	}
}

func TestRun_HaltsWhenTheOwnerLosesAccess(t *testing.T) {
	g := newRig()
	r, err := g.s.Start(context.Background(), "ws", "u1", nil, everything, "Ohne Titel")
	if err != nil {
		t.Fatal(err)
	}
	g.access.denyAfter = 2 // the run's own check and the first design
	r = g.resume(t, r.ID)
	if r.Status != StatusHalted || r.Halted != HaltAccessLost || r.Imported != 1 {
		t.Fatalf("run %+v", r)
	}
}

func TestStart_RefusesWithoutConnectionOrValidPicks(t *testing.T) {
	g := newRig()
	if _, err := g.s.Start(context.Background(), "ws", "u1", nil, nil, ""); !errors.Is(err, ErrBadRequest) {
		t.Fatalf("empty picks: %v", err)
	}
	if _, err := g.s.Start(context.Background(), "ws", "u1", nil, []Pick{{Type: "page", ID: "x"}}, ""); !errors.Is(err, ErrBadRequest) {
		t.Fatalf("bad type: %v", err)
	}
	g.cv.connected = false
	if _, err := g.s.Start(context.Background(), "ws", "u1", nil, everything, ""); !errors.Is(err, canva.ErrNotConnected) {
		t.Fatalf("disconnected: %v", err)
	}
	g.access.denyAfter = 0
	if _, err := g.s.Start(context.Background(), "ws", "u1", nil, everything, ""); !errors.Is(err, ErrForbidden) {
		t.Fatalf("not a member: %v", err)
	}
}

func TestStopAndOwnership(t *testing.T) {
	g := newRig()
	r, _ := g.s.Start(context.Background(), "ws", "u1", nil, everything, "")
	if _, err := g.s.Stop(context.Background(), "u2", r.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other user stopped it: %v", err)
	}
	r, err := g.s.Stop(context.Background(), "u1", r.ID)
	if err != nil || r.Status != StatusStopped {
		t.Fatalf("stop %+v %v", r, err)
	}
	if r.Untitled != "Untitled" {
		t.Fatalf("untitled %q", r.Untitled)
	}
}

func TestClaim_OneRunPerOwner(t *testing.T) {
	g := newRig()
	a, _ := g.s.Start(context.Background(), "ws", "u1", nil, everything, "")
	g.s.Start(context.Background(), "ws", "u1", nil, everything, "")
	c, _ := g.s.Start(context.Background(), "ws", "u2", nil, everything, "")
	runs, _ := g.st.claim(context.Background(), 4, g.now)
	if len(runs) != 2 || runs[0].ID != a.ID || runs[1].ID != c.ID {
		t.Fatalf("claimed %+v", runs)
	}
}

func TestWorker_RunsQueuedImportsAndStopsWithItsContext(t *testing.T) {
	g := newRig()
	g.s.sleep = sleepCtx
	g.s.now = time.Now
	// Export polls would take 2 s each with the real clock; answer at once.
	g.cv.polls = 1
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { g.s.Run(ctx); close(done) }()
	r, err := g.s.Start(ctx, "ws", "u1", nil, []Pick{{Type: "design", ID: "D4", Name: "Loose deck"}}, "")
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		got, _ := g.st.get(context.Background(), r.ID)
		if got.Status == StatusDone {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("run %+v", got)
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	<-done
}
