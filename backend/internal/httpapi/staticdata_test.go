package httpapi

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestStaticDataServesFilesOnly(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "bg", "1.0"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "bg", "1.0", "model.bin"), []byte("weights"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".secret"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	r := chi.NewRouter()
	mountStaticData(r, dir)

	get := func(path string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		return rec
	}
	if rec := get("/static-data/bg/1.0/model.bin"); rec.Code != http.StatusOK || rec.Body.String() != "weights" {
		t.Fatalf("file: got %d %q", rec.Code, rec.Body.String())
	} else if cc := rec.Header().Get("Cache-Control"); cc == "" {
		t.Fatal("file: no cache header")
	}
	for _, p := range []string{"/static-data/bg/", "/static-data/bg/1.0", "/static-data/.secret", "/static-data/../staticdata.go"} {
		if rec := get(p); rec.Code == http.StatusOK {
			t.Fatalf("%s: want refusal, got 200 %q", p, rec.Body.String())
		}
	}
}
