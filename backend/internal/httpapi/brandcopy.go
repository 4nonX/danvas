package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/brandcopy"
	"hycanvas/backend/internal/jobs"
)

// mountBrandCopy attaches POST /brand-kits/copy: copy brand kits (some or
// all of a workspace) into other workspaces, with the uploads and fonts they
// use. Every upload is copied, so it runs as a job the client polls via
// GET /jobs/:id; the job's interim result is {done, total}.
func mountBrandCopy(api chi.Router, svc *brandcopy.Service, reg *jobs.Registry, acct *accounts.Service) {
	api.With(requireAuth(acct)).Post("/brand-kits/copy", func(w http.ResponseWriter, r *http.Request) {
		var in brandcopy.Input
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in); err != nil {
			problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid request", "invalid_request")
			return
		}
		u := userFrom(r.Context())
		kits, err := svc.Prepare(r.Context(), u.ID, in)
		switch {
		case errors.Is(err, brandcopy.ErrForbidden):
			problemWithCode(w, r, http.StatusForbidden, "Forbidden", "not permitted", "not_permitted")
			return
		case err != nil:
			problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid request", "invalid_request")
			return
		}
		job := reg.Start(u.ID, "brand-copy")
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
			defer cancel()
			res, err := svc.Copy(ctx, u.ID, in, kits, func(done, total int) {
				reg.Progress(job.ID, map[string]int{"done": done, "total": total})
			})
			if err != nil {
				reg.Fail(job.ID, "copy failed")
				return
			}
			reg.Complete(job.ID, res, nil)
		}()
		writeJSON(w, http.StatusOK, map[string]any{"jobId": job.ID})
	})
}
