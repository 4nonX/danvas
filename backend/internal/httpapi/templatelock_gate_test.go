package httpapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/brand"
	"hycanvas/backend/internal/persistence"
	"hycanvas/backend/internal/sharing"
	"hycanvas/backend/internal/storage"
)

// TestTemplateLockGate_DB drives the save and checkpoint routes of a design
// with template locks as a member who may not lift them: a relabelled schema
// version, objects added to a protected group, a lock for a workspace nobody
// can act for, and a checkpoint that cannot be checked are all refused, while
// free edits and the owner's changes pass.
func TestTemplateLockGate_DB(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set; skipping DB integration test")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, stripSchemaParam(dsn))
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	acct := accounts.NewService(tx, "test-jwt-secret")
	owner, ws, ownerTok, err := acct.Signup(ctx, "lock-owner+"+uuid.NewString()+"@example.com", "a-strong-password", "Owner")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	member, _, memberTok, err := acct.Signup(ctx, "lock-member+"+uuid.NewString()+"@example.com", "a-strong-password", "Member")
	if err != nil {
		t.Fatalf("signup member: %v", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO "workspace_members" (id,"workspace_id","user_id",role,status,"joined_at","updated_at") VALUES ($1,$2,$3,'MEMBER','ACTIVE', now(), now())`,
		uuid.NewString(), ws.ID, member.ID); err != nil {
		t.Fatal(err)
	}
	driver, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	p := persistence.NewService(tx).WithStorage(driver)
	sh := sharing.NewService(tx, p, nil, nil)

	base := func() persistence.DesignFile {
		var f persistence.DesignFile
		src := `{"schemaVersion":27,"title":"T","pages":[{"id":"p1","width":400,"height":400,"children":[
 {"id":"title","type":"text","transform":{"x":0,"y":100,"scaleX":1,"scaleY":1,"rotation":0},"size":{"width":300,"height":40},"content":[{"runs":[{"text":"Hello"}]}],
  "templateLock":{"level":"content","workspaceId":"` + ws.ID + `"}},
 {"id":"box","type":"group","transform":{"x":0,"y":200,"scaleX":1,"scaleY":1,"rotation":0},"size":{"width":50,"height":50},
  "templateLock":{"level":"locked","workspaceId":"` + ws.ID + `"},
  "children":[{"id":"inner","type":"shape","transform":{"x":0,"y":0,"scaleX":1,"scaleY":1,"rotation":0},"size":{"width":10,"height":10}}]},
 {"id":"free","type":"shape","transform":{"x":0,"y":0,"scaleX":1,"scaleY":1,"rotation":0},"size":{"width":5,"height":5}}]}]}`
		if err := json.Unmarshal([]byte(src), &f); err != nil {
			t.Fatal(err)
		}
		return f
	}
	rec, err := p.Create(ctx, ws.ID, "T", base(), &owner.ID)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	r := chi.NewRouter()
	r.Route("/api/v1", func(api chi.Router) {
		mountPersistence(api, p, acct, sh, brand.NewService(tx))
		mountSnapshots(api, p, brand.NewService(tx), acct, sh)
	})
	srv := httptest.NewServer(r)
	defer srv.Close()
	post := func(path, token string, body any) (int, string) {
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest(http.MethodPost, srv.URL+path, bytes.NewReader(b))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var pb struct {
			Code string `json:"code"`
		}
		_ = json.NewDecoder(res.Body).Decode(&pb)
		return res.StatusCode, pb.Code
	}
	children := func(f persistence.DesignFile) []any {
		return f["pages"].([]any)[0].(map[string]any)["children"].([]any)
	}
	save := func(token string, f persistence.DesignFile) (int, string) {
		return post("/api/v1/designs/"+rec.ID+"/snapshots", token, map[string]any{"file": f})
	}

	// A free edit passes.
	f := base()
	children(f)[2].(map[string]any)["transform"].(map[string]any)["x"] = 30.0
	if st, code := save(memberTok.Access, f); st >= 300 {
		t.Fatalf("free edit: %d %s", st, code)
	}

	// Moving the protected title is refused at v27, labelled v26, and with no
	// version at all.
	for _, label := range []any{27.0, 26.0, nil} {
		f := base()
		children(f)[0].(map[string]any)["transform"].(map[string]any)["y"] = 300.0
		if label == nil {
			delete(f, "schemaVersion")
		} else {
			f["schemaVersion"] = label
		}
		if st, code := save(memberTok.Access, f); st != http.StatusConflict || code != "template_locked" {
			t.Fatalf("moved title labelled %v: %d %s", label, st, code)
		}
	}

	// An object added inside the protected group is refused.
	f = base()
	box := children(f)[1].(map[string]any)
	box["children"] = append(box["children"].([]any), map[string]any{"id": "intruder", "type": "shape",
		"transform": map[string]any{"x": 0.0, "y": 0.0, "scaleX": 1.0, "scaleY": 1.0, "rotation": 0.0}, "size": map[string]any{"width": 50.0, "height": 50.0}})
	if st, code := save(memberTok.Access, f); st != http.StatusConflict || code != "template_locked" {
		t.Fatalf("object added to protected group: %d %s", st, code)
	}

	// A lock for a workspace that does not exist is refused, on an existing
	// object and on a new one.
	f = base()
	children(f)[2].(map[string]any)["templateLock"] = map[string]any{"level": "locked", "workspaceId": uuid.NewString()}
	if st, code := save(memberTok.Access, f); st != http.StatusConflict || code != "template_locked" {
		t.Fatalf("foreign lock on existing object: %d %s", st, code)
	}
	f = base()
	page := f["pages"].([]any)[0].(map[string]any)
	page["children"] = append(children(f), map[string]any{"id": "new", "type": "shape",
		"transform": map[string]any{"x": 0.0, "y": 0.0, "scaleX": 1.0, "scaleY": 1.0, "rotation": 0.0}, "size": map[string]any{"width": 5.0, "height": 5.0},
		"templateLock": map[string]any{"level": "locked", "workspaceId": uuid.NewString()}})
	if st, code := save(memberTok.Access, f); st != http.StatusConflict || code != "template_locked" {
		t.Fatalf("new object locked for a workspace nobody can act for: %d %s", st, code)
	}

	// The owner may change protected objects.
	f = base()
	children(f)[0].(map[string]any)["transform"].(map[string]any)["y"] = 300.0
	if st, code := save(ownerTok.Access, f); st >= 300 {
		t.Fatalf("owner edit: %d %s", st, code)
	}

	// A checkpoint on a protected design must be checkable: an update frame
	// that does not fold is refused instead of replacing the history.
	frame := base64.StdEncoding.EncodeToString(append([]byte{2}, []byte("not a yjs update")...))
	if st, code := post("/api/v1/designs/"+rec.ID+"/updates/checkpoint", memberTok.Access, map[string]any{"update": frame}); st != http.StatusConflict || !strings.HasPrefix(code, "template_lock") {
		t.Fatalf("unfoldable checkpoint on a protected design: %d %s", st, code)
	}
}
