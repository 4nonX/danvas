package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/exportprofiles"
)

// mountExportProfiles attaches the export profiles and print presets
// (?kind=print, "kind" in a body): the workspace's and the signed-in user's
// own, listed and created per workspace (or /me for personal ones), changed
// and deleted by id.
func mountExportProfiles(api chi.Router, p *exportprofiles.Service, acct *accounts.Service) {
	api.With(requireAuth(acct)).Get("/me/export-profiles", listPersonalExportProfilesHandler(p))
	api.With(requireAuth(acct)).Post("/me/export-profiles", createExportProfileHandler(p))
	api.With(requireAuth(acct)).Get("/workspaces/{id}/export-profiles", listExportProfilesHandler(p))
	api.With(requireAuth(acct)).Post("/workspaces/{id}/export-profiles", createExportProfileHandler(p))
	api.With(requireAuth(acct)).Put("/workspaces/{id}/export-profiles/settings", exportProfileSettingsHandler(p))
	api.With(requireAuth(acct)).Patch("/export-profiles/{id}", updateExportProfileHandler(p))
	api.With(requireAuth(acct)).Delete("/export-profiles/{id}", deleteExportProfileHandler(p))
}

func exportProfileProblem(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, exportprofiles.ErrForbidden):
		problemWithCode(w, r, http.StatusForbidden, "Forbidden", "not allowed to manage these export profiles", "export_profile_forbidden")
	case errors.Is(err, exportprofiles.ErrNotFound):
		problemWithCode(w, r, http.StatusNotFound, "Not Found", "export profile not found", "export_profile_not_found")
	case errors.Is(err, exportprofiles.ErrNameTaken):
		problemWithCode(w, r, http.StatusConflict, "Conflict", "a profile with this name already exists", "export_profile_name_taken")
	case errors.Is(err, exportprofiles.ErrInvalid):
		problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid export profile", "export_profile_invalid")
	default:
		problemWithCode(w, r, http.StatusInternalServerError, "Internal Server Error", "request failed", "request_failed")
	}
}

func listExportProfilesHandler(p *exportprofiles.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		kind, err := exportprofiles.KindOf(r.URL.Query().Get("kind"))
		if err != nil {
			exportProfileProblem(w, r, err)
			return
		}
		v, err := p.List(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "id"), kind)
		if err != nil {
			exportProfileProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, v)
	}
}

func listPersonalExportProfilesHandler(p *exportprofiles.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		kind, err := exportprofiles.KindOf(r.URL.Query().Get("kind"))
		if err != nil {
			exportProfileProblem(w, r, err)
			return
		}
		list, err := p.ListPersonal(r.Context(), userFrom(r.Context()).ID, kind)
		if err != nil {
			exportProfileProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, list)
	}
}

// createExportProfileHandler serves both routes: per workspace, and /me for
// a personal profile (no workspace id, so the scope must be personal).
func createExportProfileHandler(p *exportprofiles.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in exportprofiles.Input
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&in); err != nil {
			problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid body", "invalid_body")
			return
		}
		prof, err := p.Create(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "id"), in)
		if err != nil {
			exportProfileProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusCreated, prof)
	}
}

func updateExportProfileHandler(p *exportprofiles.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var patch exportprofiles.Patch
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&patch); err != nil {
			problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid body", "invalid_body")
			return
		}
		prof, err := p.Update(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "id"), patch)
		if err != nil {
			exportProfileProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, prof)
	}
}

func deleteExportProfileHandler(p *exportprofiles.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := p.Delete(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "id")); err != nil {
			exportProfileProblem(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// exportProfileSettingsHandler sets who may manage the workspace's profiles.
func exportProfileSettingsHandler(p *exportprofiles.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Kind      string `json:"kind"`
			ManagedBy string `json:"managedBy"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body); err != nil {
			problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid body", "invalid_body")
			return
		}
		if err := p.SetManagedBy(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "id"), body.Kind, body.ManagedBy); err != nil {
			exportProfileProblem(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
