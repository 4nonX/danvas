package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/colorlibs"
)

// mountColorLibraries attaches a workspace's colour libraries (for the colour
// list of a print export); the file is read in the browser, the entries come
// as JSON.
func mountColorLibraries(api chi.Router, c *colorlibs.Service, acct *accounts.Service) {
	api.With(requireAuth(acct)).Get("/workspaces/{id}/color-libraries", listColorLibrariesHandler(c))
	api.With(requireAuth(acct)).Post("/workspaces/{id}/color-libraries", createColorLibraryHandler(c))
	api.With(requireAuth(acct)).Get("/color-libraries/{id}/entries", colorLibraryEntriesHandler(c))
	api.With(requireAuth(acct)).Delete("/color-libraries/{id}", deleteColorLibraryHandler(c))
}

func colorLibraryProblem(w http.ResponseWriter, r *http.Request, err error) {
	if a, ok := accounts.IsActionError(err); ok {
		actionProblem(w, r, a)
		return
	}
	switch {
	case errors.Is(err, colorlibs.ErrForbidden):
		problemWithCode(w, r, http.StatusForbidden, "Forbidden", "not allowed to manage colour libraries", "color_library_forbidden")
	case errors.Is(err, colorlibs.ErrNotFound):
		problemWithCode(w, r, http.StatusNotFound, "Not Found", "colour library not found", "color_library_not_found")
	case errors.Is(err, colorlibs.ErrInvalid):
		problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid colour library", "color_library_invalid")
	default:
		problemWithCode(w, r, http.StatusInternalServerError, "Internal Server Error", "request failed", "request_failed")
	}
}

func listColorLibrariesHandler(c *colorlibs.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := c.List(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "id"))
		if err != nil {
			colorLibraryProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, list)
	}
}

func createColorLibraryHandler(c *colorlibs.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		data, err := io.ReadAll(io.LimitReader(r.Body, colorlibs.MaxBodyBytes+1))
		if err != nil || len(data) > colorlibs.MaxBodyBytes {
			problemWithCode(w, r, http.StatusRequestEntityTooLarge, "Payload Too Large", "colour library too large", "color_library_too_large")
			return
		}
		var body struct {
			Name       string            `json:"name"`
			SourceFile string            `json:"sourceFile"`
			Entries    []colorlibs.Entry `json:"entries"`
		}
		if err := json.Unmarshal(data, &body); err != nil {
			problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid body", "invalid_body")
			return
		}
		lib, err := c.Create(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "id"), body.Name, body.SourceFile, body.Entries)
		if err != nil {
			colorLibraryProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusCreated, lib)
	}
}

func colorLibraryEntriesHandler(c *colorlibs.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		entries, err := c.Entries(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "id"))
		if err != nil {
			colorLibraryProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, entries)
	}
}

func deleteColorLibraryHandler(c *colorlibs.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := c.Delete(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "id")); err != nil {
			colorLibraryProblem(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
