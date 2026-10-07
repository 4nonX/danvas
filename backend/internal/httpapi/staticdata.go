package httpapi

import (
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
)

// mountStaticData serves files from dir at /static-data/: large client-side
// assets that should not be baked into the binary (the background-removal
// model and its ONNX runtime, ~120 MB) but must not come from a third-party
// CDN either. Files only: no directory listings, no dotfiles. The content is
// versioned by path (e.g. bg-removal/1.7.0/...), so it is cached for a year.
func mountStaticData(r chi.Router, dir string) {
	fs := http.FileServer(filesOnly{http.Dir(dir)})
	r.Get("/static-data/*", func(w http.ResponseWriter, req *http.Request) {
		rel := chi.URLParam(req, "*")
		for _, part := range strings.Split(rel, "/") {
			if strings.HasPrefix(part, ".") {
				http.NotFound(w, req)
				return
			}
		}
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
		http.StripPrefix("/static-data", fs).ServeHTTP(w, req)
	})
}

// filesOnly refuses directories, so http.FileServer never lists one.
type filesOnly struct{ root http.FileSystem }

func (f filesOnly) Open(name string) (http.File, error) {
	file, err := f.root.Open(name)
	if err != nil {
		return nil, err
	}
	if info, err := file.Stat(); err != nil || info.IsDir() {
		_ = file.Close()
		return nil, os.ErrNotExist
	}
	return file, nil
}
