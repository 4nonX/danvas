package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/printprofiles"
)

// mountPrintProfiles attaches the ICC print profiles: a workspace's and the
// user's own (/me/print-profiles); update, delete and data take either id.
func mountPrintProfiles(api chi.Router, p *printprofiles.Service, acct *accounts.Service) {
	api.With(requireAuth(acct)).Get("/me/print-profiles", listMyPrintProfilesHandler(p))
	api.With(requireAuth(acct)).Post("/me/print-profiles", uploadMyPrintProfileHandler(p))
	api.With(requireAuth(acct)).Get("/workspaces/{id}/print-profiles", listPrintProfilesHandler(p))
	api.With(requireAuth(acct)).Post("/workspaces/{id}/print-profiles", uploadPrintProfileHandler(p))
	api.With(requireAuth(acct)).Patch("/print-profiles/{id}", updatePrintProfileHandler(p))
	api.With(requireAuth(acct)).Delete("/print-profiles/{id}", deletePrintProfileHandler(p))
	api.With(requireAuth(acct)).Get("/print-profiles/{id}/data", printProfileDataHandler(p))
}

func printProfileProblem(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, printprofiles.ErrForbidden):
		problemWithCode(w, r, http.StatusForbidden, "Forbidden", "workspace admins manage print profiles", "print_profile_forbidden")
	case errors.Is(err, printprofiles.ErrNotFound):
		problemWithCode(w, r, http.StatusNotFound, "Not Found", "print profile not found", "print_profile_not_found")
	case errors.Is(err, printprofiles.ErrNotPrintProfile):
		problemWithCode(w, r, http.StatusUnprocessableEntity, "Unprocessable Entity", err.Error(), "print_profile_not_cmyk")
	case errors.Is(err, printprofiles.ErrDuplicate):
		problemWithCode(w, r, http.StatusConflict, "Conflict", "this profile is already uploaded", "print_profile_duplicate")
	case errors.Is(err, printprofiles.ErrInvalid):
		problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid print profile request", "print_profile_invalid")
	default:
		problemWithCode(w, r, http.StatusInternalServerError, "Internal Server Error", "request failed", "request_failed")
	}
}

func listMyPrintProfilesHandler(p *printprofiles.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := p.ListPersonal(r.Context(), userFrom(r.Context()).ID)
		if err != nil {
			printProfileProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, list)
	}
}

// uploadMyPrintProfileHandler: a personal profile, raw .icc bytes as the body
// and the name from ?name=, as for a workspace's.
func uploadMyPrintProfileHandler(p *printprofiles.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		data, err := io.ReadAll(io.LimitReader(r.Body, printprofiles.MaxProfileBytes+1))
		if err != nil || len(data) > printprofiles.MaxProfileBytes {
			problemWithCode(w, r, http.StatusRequestEntityTooLarge, "Payload Too Large", "profile too large", "print_profile_too_large")
			return
		}
		prof, err := p.CreatePersonal(r.Context(), userFrom(r.Context()).ID, r.URL.Query().Get("name"), data)
		if err != nil {
			printProfileProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusCreated, prof)
	}
}

func listPrintProfilesHandler(p *printprofiles.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := p.List(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "id"))
		if err != nil {
			printProfileProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, list)
	}
}

// uploadPrintProfileHandler takes the raw .icc bytes as the body; the display
// name comes from ?name= (else the profile's own description).
func uploadPrintProfileHandler(p *printprofiles.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		data, err := io.ReadAll(io.LimitReader(r.Body, printprofiles.MaxProfileBytes+1))
		if err != nil || len(data) > printprofiles.MaxProfileBytes {
			problemWithCode(w, r, http.StatusRequestEntityTooLarge, "Payload Too Large", "profile too large", "print_profile_too_large")
			return
		}
		prof, err := p.Create(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "id"), r.URL.Query().Get("name"), data)
		if err != nil {
			printProfileProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusCreated, prof)
	}
}

func updatePrintProfileHandler(p *printprofiles.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Name      *string `json:"name"`
			IsDefault *bool   `json:"isDefault"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid body", "invalid_body")
			return
		}
		makeDefault := body.IsDefault != nil && *body.IsDefault
		clearDefault := body.IsDefault != nil && !*body.IsDefault
		if err := p.Update(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "id"), body.Name, makeDefault, clearDefault); err != nil {
			printProfileProblem(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func deletePrintProfileHandler(p *printprofiles.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := p.Delete(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "id")); err != nil {
			printProfileProblem(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func printProfileDataHandler(p *printprofiles.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		data, checksum, err := p.Data(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "id"))
		if err != nil {
			printProfileProblem(w, r, err)
			return
		}
		etag := `"` + checksum + `"`
		w.Header().Set("ETag", etag)
		w.Header().Set("Cache-Control", "private, max-age=0, must-revalidate")
		if strings.Contains(r.Header.Get("If-None-Match"), checksum) {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("Content-Type", "application/vnd.iccprofile")
		_, _ = w.Write(data)
	}
}
