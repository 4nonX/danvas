package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/designtransfer"
	"hycanvas/backend/internal/jobs"
)

// mountDesignTransfer attaches POST /designs/transfer: copy or move designs
// and folders to another workspace, with the uploads they use, or copy them
// to a folder of their own workspace. It is long
// work (every upload is copied), so it runs as a job the client polls via
// GET /jobs/:id; the job's interim result is {done, total}.
func mountDesignTransfer(api chi.Router, svc *designtransfer.Service, reg *jobs.Registry, acct *accounts.Service) {
	api.With(requireAuth(acct)).Post("/designs/transfer", func(w http.ResponseWriter, r *http.Request) {
		var in designtransfer.Input
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in); err != nil {
			problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid request", "invalid_request")
			return
		}
		u := userFrom(r.Context())
		src, err := svc.Prepare(r.Context(), u.ID, in)
		switch {
		case errors.Is(err, designtransfer.ErrForbidden):
			problemWithCode(w, r, http.StatusForbidden, "Forbidden", "not permitted", "not_permitted")
			return
		case err != nil:
			problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid request", "invalid_request")
			return
		}
		job := reg.Start(u.ID, "design-transfer")
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
			defer cancel()
			res, err := svc.Transfer(ctx, u.ID, src, in, func(done, total int) {
				reg.Progress(job.ID, map[string]int{"done": done, "total": total})
			})
			if err != nil {
				reg.Fail(job.ID, "transfer failed")
				return
			}
			reg.Complete(job.ID, res, nil)
		}()
		writeJSON(w, http.StatusOK, map[string]any{"jobId": job.ID})
	})
}
