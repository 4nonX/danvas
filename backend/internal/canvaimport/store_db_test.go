package canvaimport

import (
	"context"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"hycanvas/backend/internal/accounts"
)

func TestStore_DB(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set; skipping DB integration test")
	}
	if u, err := url.Parse(dsn); err == nil {
		q := u.Query()
		q.Del("schema")
		u.RawQuery = q.Encode()
		dsn = u.String()
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	acct := accounts.NewService(tx, "jwt")
	u1, ws, _, err := acct.Signup(ctx, "import+"+uuid.NewString()+"@example.com", "a-strong-password", "One")
	if err != nil {
		t.Fatal(err)
	}
	u2, _, _, err := acct.Signup(ctx, "import2+"+uuid.NewString()+"@example.com", "a-strong-password", "Two")
	if err != nil {
		t.Fatal(err)
	}
	st := sqlStore{tx}
	picks := []Pick{{Type: "folder", ID: "F1", Name: "Clients", Ancestors: []string{"root"}}}
	a, err := st.create(ctx, Run{WorkspaceID: ws.ID, UserID: u1.ID, Picks: picks, Untitled: "Ohne Titel"})
	if err != nil {
		t.Fatal(err)
	}
	if a.Status != StatusQueued || a.Total != nil || len(a.Picks) != 1 || a.Picks[0].Ancestors[0] != "root" || a.Untitled != "Ohne Titel" {
		t.Fatalf("created %+v", a)
	}
	b, _ := st.create(ctx, Run{WorkspaceID: ws.ID, UserID: u1.ID, Picks: picks, Untitled: "x"})
	c, _ := st.create(ctx, Run{WorkspaceID: ws.ID, UserID: u2.ID, Picks: picks, Untitled: "x"})

	// One run per owner, oldest first.
	now := time.Now()
	runs, err := st.claim(ctx, 5, now)
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]bool{}
	for _, r := range runs {
		ids[r.ID] = true
		if r.Status != StatusRunning || r.StartedAt == nil {
			t.Fatalf("claimed %+v", r)
		}
	}
	if len(runs) != 2 || !ids[a.ID] || !ids[c.ID] {
		t.Fatalf("claimed %v", ids)
	}
	if again, _ := st.claim(ctx, 5, now); len(again) != 0 {
		t.Fatalf("claimed twice: %+v", again)
	}

	total := 3
	if err := st.saveProgress(ctx, a.ID, progress{Total: &total, Imported: 1, Failed: 1, Current: "Pitch", Waiting: true,
		Failures: []Failure{{Name: "Brief", Code: FailConvert, Detail: "bad"}}}); err != nil {
		t.Fatal(err)
	}
	if err := st.markImported(ctx, a.ID, "D1"); err != nil {
		t.Fatal(err)
	}
	_ = st.markImported(ctx, a.ID, "D1")
	if mine, _ := st.importedByRun(ctx, a.ID); len(mine) != 1 || !mine["D1"] {
		t.Fatalf("imported %v", mine)
	}

	// A restart requeues a, which is then claimed again (b still waits).
	if err := st.requeue(ctx); err != nil {
		t.Fatal(err)
	}
	got, _ := st.get(ctx, a.ID)
	if got.Status != StatusQueued || *got.Total != 3 || got.Failures[0].Code != FailConvert || got.Waiting {
		t.Fatalf("requeued %+v", got)
	}
	runs, _ = st.claim(ctx, 5, now)
	if len(runs) != 2 || (runs[0].ID != a.ID && runs[1].ID != a.ID) {
		t.Fatalf("reclaimed %+v", runs)
	}

	// The daily limit pauses a; a paused run does not hold its owner's slot,
	// so b starts.
	resume := now.Add(time.Hour)
	if err := st.finish(ctx, a.ID, StatusPaused, "", "", &resume); err != nil {
		t.Fatal(err)
	}
	got, _ = st.get(ctx, a.ID)
	if got.Status != StatusPaused || got.ResumeAt == nil || got.FinishedAt != nil {
		t.Fatalf("paused %+v", got)
	}
	runs, _ = st.claim(ctx, 5, now)
	if len(runs) != 1 || runs[0].ID != b.ID {
		t.Fatalf("after pause %+v", runs)
	}
	_ = st.finish(ctx, b.ID, StatusDone, "", "", nil)
	if runs, _ = st.claim(ctx, 5, now.Add(2*time.Hour)); len(runs) != 1 || runs[0].ID != a.ID {
		t.Fatalf("resumed %+v", runs)
	}

	// Stop: a running run is flagged, a queued one ends at once.
	if err := st.requestStop(ctx, a.ID); err != nil {
		t.Fatal(err)
	}
	if stop, _ := st.stopRequested(ctx, a.ID); !stop {
		t.Fatal("stop not flagged")
	}
	if got, _ = st.get(ctx, a.ID); got.Status != StatusRunning {
		t.Fatalf("running run ended at once: %+v", got)
	}
	d, _ := st.create(ctx, Run{WorkspaceID: ws.ID, UserID: u2.ID, Picks: picks, Untitled: "x"})
	_ = st.requestStop(ctx, d.ID)
	if got, _ = st.get(ctx, d.ID); got.Status != StatusStopped || got.FinishedAt == nil {
		t.Fatalf("queued stop %+v", got)
	}
	if err := st.finish(ctx, a.ID, StatusHalted, HaltAccessLost, "x", nil); err != nil {
		t.Fatal(err)
	}
	got, _ = st.get(ctx, a.ID)
	if got.Halted != HaltAccessLost || got.HaltedDetail != "x" || got.FinishedAt == nil {
		t.Fatalf("halted %+v", got)
	}

	// Dismiss hides ended runs only.
	_ = st.dismiss(ctx, a.ID)
	_ = st.dismiss(ctx, c.ID) // still running: stays
	mine, _ := st.listForUser(ctx, u1.ID, false)
	if len(mine) != 1 || mine[0].ID != b.ID {
		t.Fatalf("listed %+v", mine)
	}
	// The recent runs keep a dismissed one, newest first.
	recent, _ := st.listForUser(ctx, u1.ID, true)
	if len(recent) != 2 || recent[0].ID != b.ID || recent[1].ID != a.ID || !recent[1].Dismissed || recent[0].Dismissed || recent[1].Halted != HaltAccessLost {
		t.Fatalf("recent %+v", recent)
	}
	theirs, _ := st.listForUser(ctx, u2.ID, false)
	if len(theirs) != 2 {
		t.Fatalf("listed %+v", theirs)
	}
	if _, err := st.get(ctx, "not-a-uuid"); err != ErrNotFound {
		t.Fatalf("bad id: %v", err)
	}
	if _, err := st.get(ctx, uuid.NewString()); err != ErrNotFound {
		t.Fatalf("missing: %v", err)
	}
}
