package httpapi

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/jobs"
	"hycanvas/backend/internal/outputcheck"
)

// mountOutputCheck attaches the output check: an exported PDF or EPS sent as
// the body is separated by Ghostscript in a job (poll GET /jobs/:id). GET
// tells the client whether this instance can do it.
func mountOutputCheck(api chi.Router, c *outputcheck.Checker, reg *jobs.Registry, acct *accounts.Service) {
	api.With(requireAuth(acct)).Get("/output-check", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"available": c.Available()})
	})
	api.With(requireAuth(acct)).Post("/output-check", func(w http.ResponseWriter, r *http.Request) {
		if !c.Available() {
			problemWithCode(w, r, http.StatusNotImplemented, "Not Implemented", "Ghostscript is not installed on this instance", "output_check_unavailable")
			return
		}
		data, err := io.ReadAll(io.LimitReader(r.Body, outputcheck.MaxBytes+1))
		if err != nil || len(data) > outputcheck.MaxBytes {
			problemWithCode(w, r, http.StatusRequestEntityTooLarge, "Payload Too Large", "file too large", "output_check_too_large")
			return
		}
		limit, _ := strconv.Atoi(r.URL.Query().Get("tac"))
		u := userFrom(r.Context())
		job := reg.Start(u.ID, "output-check")
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
			defer cancel()
			res, err := c.Check(ctx, data, limit)
			switch {
			case errors.Is(err, outputcheck.ErrUnsupported):
				reg.Fail(job.ID, "output_check_unsupported")
			case err != nil:
				reg.Fail(job.ID, "output_check_failed")
			default:
				reg.Complete(job.ID, res, nil)
			}
		}()
		writeJSON(w, http.StatusOK, map[string]any{"jobId": job.ID})
	})
}
