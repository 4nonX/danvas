package httpapi

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

// TestStaticCaching pins how the frontend is cached: the hashed /_next assets
// for good, everything else revalidated on every load against an ETag of its
// content. Without that, a browser kept a page from before an update, and the
// page kept loading the previous build's assets.
func TestStaticCaching(t *testing.T) {
	dir := t.TempDir()
	write := func(rel, body string) {
		p := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("index.html", "<html><head></head><body>v1</body></html>")
	write("404.html", "<html>notfound</html>")
	write("_next/static/app.abc123.js", "console.log(1)")
	write("locales/de.json", `{"a":"b"}`)

	type reply struct {
		code         int
		cacheControl string
		etag         string
		body         string
	}
	get := func(r chi.Router, path, ifNoneMatch string) reply {
		srv := httptest.NewServer(r)
		defer srv.Close()
		req, _ := http.NewRequest(http.MethodGet, srv.URL+path, nil)
		if ifNoneMatch != "" {
			req.Header.Set("If-None-Match", ifNoneMatch)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return reply{resp.StatusCode, resp.Header.Get("Cache-Control"), resp.Header.Get("ETag"), string(b)}
	}

	for _, tc := range []struct {
		name string
		inst Instance
	}{
		{"plain", Instance{}},
		// Pages rewritten at serve time (instance identity) take the same rules.
		{"instance", Instance{Name: "Studio"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := chi.NewRouter()
			mountStaticFS(r, http.FS(os.DirFS(dir)), "", tc.inst)

			page := get(r, "/", "")
			if page.code != 200 || page.cacheControl != "no-cache" || page.etag == "" {
				t.Fatalf("page: %d %q etag %q", page.code, page.cacheControl, page.etag)
			}
			if again := get(r, "/", page.etag); again.code != http.StatusNotModified || again.body != "" {
				t.Fatalf("page revalidation: %d %q", again.code, again.body)
			}
			if stale := get(r, "/", `"something-else"`); stale.code != 200 || stale.body != page.body {
				t.Fatalf("page with another ETag: %d", stale.code)
			}

			if asset := get(r, "/_next/static/app.abc123.js", ""); asset.code != 200 || asset.cacheControl != "public, max-age=31536000, immutable" {
				t.Fatalf("hashed asset: %d %q", asset.code, asset.cacheControl)
			}
			loc := get(r, "/locales/de.json", "")
			if loc.code != 200 || loc.cacheControl != "no-cache" || loc.etag == "" {
				t.Fatalf("locale file: %d %q etag %q", loc.code, loc.cacheControl, loc.etag)
			}
			if again := get(r, "/locales/de.json", loc.etag); again.code != http.StatusNotModified {
				t.Fatalf("locale revalidation: %d", again.code)
			}
			if nf := get(r, "/no/such/page", ""); nf.code != 404 || nf.cacheControl != "no-cache" {
				t.Fatalf("404 page: %d %q", nf.code, nf.cacheControl)
			}
		})
	}

	// An updated page gets a new ETag, so the browser's old copy is replaced.
	r := chi.NewRouter()
	mountStaticFS(r, http.FS(os.DirFS(dir)), "", Instance{})
	before := get(r, "/", "")
	write("index.html", "<html><head></head><body>version two</body></html>")
	later := time.Now().Add(time.Minute)
	if err := os.Chtimes(filepath.Join(dir, "index.html"), later, later); err != nil {
		t.Fatal(err)
	}
	after := get(r, "/", before.etag)
	if after.code != 200 || after.etag == before.etag || after.body == before.body {
		t.Fatalf("updated page: %d etag %q (was %q)", after.code, after.etag, before.etag)
	}
}
