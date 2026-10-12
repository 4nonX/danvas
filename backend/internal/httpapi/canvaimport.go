// Canva imports that run on the server (docs/roadmap/41-canva-import.md): a
// member starts a run for a selection of their Canva library, the server works
// through it with the browser closed, and the owner sees, stops and dismisses
// their runs from any device.

package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/canvaimport"
)

func mountCanvaImport(api chi.Router, svc *canvaimport.Service, acct *accounts.Service) {
	api.Group(func(r chi.Router) {
		r.Use(requireAuth(acct))
		r.Post("/workspaces/{id}/canva/runs", canvaRunStartHandler(svc, acct))
		r.Get("/canva/runs", canvaRunsHandler(svc))
		r.Post("/canva/runs/{runId}/stop", canvaRunStopHandler(svc))
		r.Post("/canva/runs/{runId}/dismiss", canvaRunDismissHandler(svc))
	})
}

func canvaRunProblem(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, canvaimport.ErrNotFound):
		problemWithCode(w, r, http.StatusNotFound, "Not Found", "import run not found", "canva_run_not_found")
	case errors.Is(err, canvaimport.ErrBadRequest):
		problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid import selection", "canva_run_invalid")
	default:
		canvaProblem(w, r, err)
	}
}

// canvaRunStartHandler queues an import of the ticked entries into a folder
// of the workspace (or its root).
func canvaRunStartHandler(svc *canvaimport.Service, acct *accounts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ws, userID, ok := canvaMember(w, r, acct, "member")
		if !ok {
			return
		}
		var body struct {
			Picks          []canvaimport.Pick `json:"picks"`
			TargetFolderID *string            `json:"targetFolderId"`
			Untitled       string             `json:"untitled"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 4<<20)).Decode(&body); err != nil {
			problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid body", "invalid_body")
			return
		}
		run, err := svc.Start(r.Context(), ws, userID, body.TargetFolderID, body.Picks, body.Untitled)
		if errors.Is(err, canvaimport.ErrForbidden) {
			problemWithCode(w, r, http.StatusForbidden, "Forbidden", "not a member of this workspace", "not_workspace_member")
			return
		}
		if err != nil {
			canvaRunProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusAccepted, run)
	}
}

// canvaRunsHandler lists the caller's runs that are not dismissed, in every
// workspace.
func canvaRunsHandler(svc *canvaimport.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		runs, err := svc.Mine(r.Context(), userFrom(r.Context()).ID)
		if err != nil {
			canvaRunProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"runs": runs})
	}
}

func canvaRunStopHandler(svc *canvaimport.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		run, err := svc.Stop(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "runId"))
		if err != nil {
			canvaRunProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, run)
	}
}

func canvaRunDismissHandler(svc *canvaimport.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := svc.Dismiss(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "runId")); err != nil {
			canvaRunProblem(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
