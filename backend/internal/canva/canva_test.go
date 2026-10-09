package canva

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"hycanvas/backend/internal/accounts"
)

func TestSafeReturnTo(t *testing.T) {
	for in, want := range map[string]string{
		"/dashboard/?folder=1": "/dashboard/?folder=1",
		"//evil.example/x":     "/dashboard/",
		"https://evil.example": "/dashboard/",
		"/a\\b":                "/dashboard/",
		"/\t/evil.example":     "/dashboard/",
		"/\x00x":               "/dashboard/",
		"/x\x7f":               "/dashboard/",
		"":                     "/dashboard/",
	} {
		if got := SafeReturnTo(in); got != want {
			t.Errorf("SafeReturnTo(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestCanvaHostAndIDs(t *testing.T) {
	for raw, want := range map[string]bool{
		"https://export-download.canva.com/x": true,
		"https://canva.com/x":                 true,
		"http://export-download.canva.com/x":  false,
		"https://canva.com.evil.example/x":    false,
		"https://evilcanva.com/x":             false,
	} {
		u, _ := url.Parse(raw)
		if canvaHost(u) != want {
			t.Errorf("canvaHost(%s) != %v", raw, want)
		}
	}
	if !validID("DAVZr1z5464") || !validID("root") || validID("../x") || validID("a/b") || validID("") {
		t.Fatal("validID")
	}
}

// stripSchema drops Prisma's ?schema= parameter, which pgx does not know.
func stripSchema(dsn string) string {
	u, err := url.Parse(dsn)
	if err != nil {
		return dsn
	}
	q := u.Query()
	q.Del("schema")
	u.RawQuery = q.Encode()
	return u.String()
}

// fakeCanva is a stub of the parts of Canva's API the module uses. It checks
// PKCE and Basic auth, and that each refresh token is used once.
type fakeCanva struct {
	mu            sync.Mutex
	challenge     string
	refreshValid  map[string]bool
	refreshCalls  int32
	exportStatus  int // 0 = OK, else the status POST /v1/exports answers with
	serverURL     string
	lastExportReq map[string]any
}

func (f *fakeCanva) handler(t *testing.T) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		bearer := r.Header.Get("Authorization")
		switch {
		case r.URL.Path == "/v1/oauth/token":
			id, sec, ok := r.BasicAuth()
			if !ok || id != "client-1" || sec != "secret-1" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			_ = r.ParseForm()
			f.mu.Lock()
			defer f.mu.Unlock()
			switch r.Form.Get("grant_type") {
			case "authorization_code":
				sum := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
				if r.Form.Get("code") != "the-code" || base64.RawURLEncoding.EncodeToString(sum[:]) != f.challenge {
					w.WriteHeader(http.StatusBadRequest)
					return
				}
			case "refresh_token":
				atomic.AddInt32(&f.refreshCalls, 1)
				rt := r.Form.Get("refresh_token")
				if !f.refreshValid[rt] {
					w.WriteHeader(http.StatusBadRequest)
					_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
					return
				}
				delete(f.refreshValid, rt) // single use
			default:
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			next := "refresh-" + uuid.NewString()
			f.refreshValid[next] = true
			_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "access-" + uuid.NewString(), "refresh_token": next, "expires_in": 14400, "token_type": "Bearer"})
		case !strings.HasPrefix(bearer, "Bearer access-"):
			w.WriteHeader(http.StatusUnauthorized)
		case r.URL.Path == "/v1/users/me/profile":
			_, _ = w.Write([]byte(`{"profile":{"display_name":"Dan D."}}`))
		case r.URL.Path == "/v1/folders/root/items":
			if r.URL.Query().Get("item_types") != "design,folder" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			_, _ = w.Write([]byte(`{"items":[
				{"type":"folder","folder":{"id":"FOLDER1","name":"Clients","created_at":1,"updated_at":2}},
				{"type":"design","design":{"id":"DESIGN1","title":"Deck","page_count":3,"created_at":1,"updated_at":5,"urls":{"edit_url":"e","view_url":"v"},"thumbnail":{"width":1,"height":1,"url":"https://thumb"}}},
				{"type":"image","image":{"type":"image","id":"IMG1","name":"x.png","tags":[],"created_at":1,"updated_at":1}}
			],"continuation":"next-page"}`))
		case r.URL.Path == "/v1/designs/DESIGN1/export-formats":
			_, _ = w.Write([]byte(`{"formats":{"pdf":{},"pptx":{},"png":{}}}`))
		case r.URL.Path == "/v1/designs/DESIGN2/export-formats":
			_, _ = w.Write([]byte(`{"formats":{"pdf":{},"pptx":{"page_numbers":[1]},"png":{}}}`))
		case r.URL.Path == "/v1/exports" && r.Method == http.MethodPost:
			if f.exportStatus != 0 {
				w.Header().Set("Retry-After", "30")
				w.WriteHeader(f.exportStatus)
				_, _ = w.Write([]byte(`{"code":"too_many_requests","message":"Daily user export limit reached"}`))
				return
			}
			_ = json.NewDecoder(r.Body).Decode(&f.lastExportReq)
			_, _ = w.Write([]byte(`{"job":{"id":"JOB1","status":"in_progress"}}`))
		case r.URL.Path == "/v1/exports/JOB1":
			_ = json.NewEncoder(w).Encode(map[string]any{"job": map[string]any{"id": "JOB1", "status": "success", "urls": []string{f.serverURL + "/download/JOB1.pptx"}}})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})
}

func TestCanvaFlow_DB(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set; skipping DB integration test")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, stripSchema(dsn))
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
	user, ws, _, err := acct.Signup(ctx, "canva+"+uuid.NewString()+"@example.com", "a-strong-password", "Dan")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	other, _, _, err := acct.Signup(ctx, "canva-other+"+uuid.NewString()+"@example.com", "a-strong-password", "Other")
	if err != nil {
		t.Fatalf("signup other: %v", err)
	}

	fake := &fakeCanva{refreshValid: map[string]bool{}}
	mux := http.NewServeMux()
	mux.Handle("/download/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation")
		_, _ = w.Write([]byte("PPTX-BYTES"))
	}))
	mux.Handle("/", fake.handler(t))
	server := httptest.NewServer(mux)
	defer server.Close()
	fake.serverURL = server.URL

	// One connection, as Postgres allows one statement at a time on it:
	// the parallel refresh test below still exercises the per-connection lock.
	svc := NewService(serialDB{tx: tx}, "ai-secret")
	svc.apiBase = server.URL
	svc.authBase = "https://www.canva.com/api/oauth/authorize"
	svc.allowDownload = func(u *url.URL) bool { return strings.HasPrefix(u.String(), server.URL+"/download/") }

	// Not configured yet.
	if v, _ := svc.GetIntegration(ctx, ws.ID); v.Configured {
		t.Fatal("unexpected integration")
	}
	if _, err := svc.StartConnect(ctx, ws.ID, user.ID, "https://d.example/api/v1/canva/callback", "/dashboard/"); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("connect without integration: %v", err)
	}
	if _, err := svc.SetIntegration(ctx, ws.ID, "client-1", ""); !errors.Is(err, ErrSecretRequired) {
		t.Fatalf("integration without secret: %v", err)
	}
	if v, err := svc.SetIntegration(ctx, ws.ID, "client-1", "secret-1"); err != nil || !v.Configured || v.ClientID != "client-1" {
		t.Fatalf("set integration: %+v %v", v, err)
	}
	var stored string
	if err := tx.QueryRow(ctx, `SELECT "secret_cipher" FROM "canva_integrations" WHERE "workspace_id" = $1`, ws.ID).Scan(&stored); err != nil || strings.Contains(stored, "secret-1") {
		t.Fatalf("secret must be encrypted at rest: %q %v", stored, err)
	}

	// Connect: the authorization URL carries PKCE and a state.
	authURL, err := svc.StartConnect(ctx, ws.ID, user.ID, "https://d.example/api/v1/canva/callback", "/dashboard/?folder=f1")
	if err != nil {
		t.Fatal(err)
	}
	au, _ := url.Parse(authURL)
	q := au.Query()
	if q.Get("client_id") != "client-1" || q.Get("code_challenge_method") != "S256" || q.Get("scope") != "folder:read design:content:read profile:read" || q.Get("redirect_uri") != "https://d.example/api/v1/canva/callback" {
		t.Fatalf("authorize url: %s", authURL)
	}
	fake.challenge = q.Get("code_challenge")
	state := q.Get("state")
	// Another user cannot complete it.
	if _, err := svc.FinishConnect(ctx, other.ID, state, "the-code"); !errors.Is(err, ErrStateInvalid) {
		t.Fatalf("foreign state: %v", err)
	}
	// The state was spent by that attempt: start again.
	authURL, _ = svc.StartConnect(ctx, ws.ID, user.ID, "https://d.example/api/v1/canva/callback", "/dashboard/?folder=f1")
	au, _ = url.Parse(authURL)
	fake.challenge, state = au.Query().Get("code_challenge"), au.Query().Get("state")
	ret, err := svc.FinishConnect(ctx, user.ID, state, "the-code")
	if err != nil || ret != "/dashboard/?folder=f1" {
		t.Fatalf("finish connect: %q %v", ret, err)
	}
	if _, err := svc.FinishConnect(ctx, user.ID, state, "the-code"); !errors.Is(err, ErrStateInvalid) {
		t.Fatalf("state reuse must fail: %v", err)
	}
	if c, _ := svc.Connection(ctx, ws.ID, user.ID); !c.Connected || c.DisplayName != "Dan D." {
		t.Fatalf("connection: %+v", c)
	}

	// Folder listing, normalized (images dropped).
	page, err := svc.ListFolder(ctx, ws.ID, user.ID, "root", "")
	if err != nil || len(page.Items) != 2 || page.Items[0].Type != "folder" || page.Items[1].Name != "Deck" || page.Items[1].PageCount != 3 || page.Continuation != "next-page" {
		t.Fatalf("list: %+v %v", page, err)
	}

	// An expiring token refreshes once, even with parallel callers (refresh
	// tokens are single-use).
	if _, err := tx.Exec(ctx, `UPDATE "canva_connections" SET "expires_at" = now() WHERE "workspace_id" = $1`, ws.ID); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := svc.ListFolder(ctx, ws.ID, user.ID, "root", "")
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("parallel list after expiry: %v", err)
		}
	}
	if n := atomic.LoadInt32(&fake.refreshCalls); n != 1 {
		t.Fatalf("refresh calls = %d, want 1", n)
	}

	// Format choice: PPTX when every page supports it, PNG otherwise.
	if exp, err := svc.StartExport(ctx, ws.ID, user.ID, "DESIGN1"); err != nil || exp.Format != "pptx" || exp.JobID != "JOB1" {
		t.Fatalf("export pptx: %+v %v", exp, err)
	}
	if exp, err := svc.StartExport(ctx, ws.ID, user.ID, "DESIGN2"); err != nil || exp.Format != "png" {
		t.Fatalf("export png fallback: %+v %v", exp, err)
	}
	if st, err := svc.GetExport(ctx, ws.ID, user.ID, "JOB1"); err != nil || st.Status != "success" || st.Files != 1 {
		t.Fatalf("export status: %+v %v", st, err)
	}
	body, ctype, err := svc.ExportFile(ctx, ws.ID, user.ID, "JOB1", 0)
	if err != nil {
		t.Fatalf("export file: %v", err)
	}
	b, _ := io.ReadAll(body)
	body.Close()
	if string(b) != "PPTX-BYTES" || !strings.Contains(ctype, "presentation") {
		t.Fatalf("file: %q %q", b, ctype)
	}
	// Only Canva's own hosts are fetched.
	svc.allowDownload = canvaHost
	if _, _, err := svc.ExportFile(ctx, ws.ID, user.ID, "JOB1", 0); !errors.Is(err, ErrUpstream) {
		t.Fatalf("foreign download host must be refused: %v", err)
	}

	// Rate limits come back with Canva's wait and whether it is the daily one.
	fake.exportStatus = http.StatusTooManyRequests
	var rl *RateLimitError
	if _, err := svc.StartExport(ctx, ws.ID, user.ID, "DESIGN1"); !errors.As(err, &rl) || rl.RetryAfter.Seconds() != 30 || !rl.Daily {
		t.Fatalf("rate limit: %v", err)
	}

	// Import records: only designs of this workspace, and trashed ones drop out.
	designID := uuid.NewString()
	if _, err := tx.Exec(ctx, `INSERT INTO "designs" (id, "workspace_id", title, "updated_at") VALUES ($1, $2, 'Deck', now())`, designID, ws.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.RecordImport(ctx, ws.ID, "DESIGN1", designID); err != nil {
		t.Fatalf("record: %v", err)
	}
	if err := svc.RecordImport(ctx, ws.ID, "DESIGN9", uuid.NewString()); !errors.Is(err, ErrBadRequest) {
		t.Fatalf("record for a design elsewhere: %v", err)
	}
	if m, err := svc.Imported(ctx, ws.ID); err != nil || m["DESIGN1"] != designID {
		t.Fatalf("imported: %v %v", m, err)
	}
	if _, err := tx.Exec(ctx, `UPDATE "designs" SET "deleted_at" = now() WHERE id = $1`, designID); err != nil {
		t.Fatal(err)
	}
	if m, _ := svc.Imported(ctx, ws.ID); len(m) != 0 {
		t.Fatalf("trashed design still counts: %v", m)
	}

	// A new Client ID drops the connections made through the old one.
	if _, err := svc.SetIntegration(ctx, ws.ID, "client-2", "secret-2"); err != nil {
		t.Fatal(err)
	}
	if c, _ := svc.Connection(ctx, ws.ID, user.ID); c.Connected {
		t.Fatal("connection survived a new integration")
	}
	if err := svc.DeleteIntegration(ctx, ws.ID); err != nil {
		t.Fatal(err)
	}
	if v, _ := svc.GetIntegration(ctx, ws.ID); v.Configured {
		t.Fatal("integration not deleted")
	}
}

// serialDB lets parallel goroutines share one transaction: pgx connections
// run one statement at a time, so access is serialized.
type serialDB struct {
	tx pgx.Tx
}

var serialMu sync.Mutex

func (d serialDB) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	serialMu.Lock()
	defer serialMu.Unlock()
	return bufferedRow{row: d.tx.QueryRow(ctx, sql, args...)}
}

// bufferedRow scans under the lock, since a pgx row reads lazily.
type bufferedRow struct{ row pgx.Row }

func (b bufferedRow) Scan(dest ...any) error {
	serialMu.Lock()
	defer serialMu.Unlock()
	return b.row.Scan(dest...)
}

func (d serialDB) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	serialMu.Lock()
	defer serialMu.Unlock()
	return d.tx.Query(ctx, sql, args...)
}

func (d serialDB) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	serialMu.Lock()
	defer serialMu.Unlock()
	return d.tx.Exec(ctx, sql, args...)
}
