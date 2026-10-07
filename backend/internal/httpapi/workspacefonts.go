package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/workspacefonts"
)

// mountWorkspaceFonts attaches the workspace font library.
func mountWorkspaceFonts(api chi.Router, f *workspacefonts.Service, acct *accounts.Service) {
	api.With(requireAuth(acct)).Get("/workspaces/{id}/fonts", listWorkspaceFontsHandler(f))
	api.With(requireAuth(acct)).Post("/workspaces/{id}/fonts", uploadWorkspaceFontHandler(f))
	api.With(requireAuth(acct)).Patch("/workspace-fonts/{id}", updateWorkspaceFontHandler(f))
	api.With(requireAuth(acct)).Delete("/workspace-fonts/{id}", deleteWorkspaceFontHandler(f))
	api.With(requireAuth(acct)).Get("/workspace-fonts/{id}/file", workspaceFontFileHandler(f))
}

func workspaceFontProblem(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, workspacefonts.ErrForbidden):
		problemWithCode(w, r, http.StatusForbidden, "Forbidden", "workspace admins manage fonts", "workspace_font_forbidden")
	case errors.Is(err, workspacefonts.ErrNotFound):
		problemWithCode(w, r, http.StatusNotFound, "Not Found", "font not found", "workspace_font_not_found")
	case errors.Is(err, workspacefonts.ErrNotFont):
		problemWithCode(w, r, http.StatusUnprocessableEntity, "Unprocessable Entity", "not a WOFF2, WOFF, TrueType or OpenType font", "workspace_font_not_font")
	case errors.Is(err, workspacefonts.ErrDuplicate):
		problemWithCode(w, r, http.StatusConflict, "Conflict", "this font file is already uploaded", "workspace_font_duplicate")
	case errors.Is(err, workspacefonts.ErrInvalid):
		problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid family, weight or style", "workspace_font_invalid")
	default:
		problemWithCode(w, r, http.StatusInternalServerError, "Internal Server Error", "request failed", "request_failed")
	}
}

func listWorkspaceFontsHandler(f *workspacefonts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := f.List(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "id"))
		if err != nil {
			workspaceFontProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, list)
	}
}

// uploadWorkspaceFontHandler takes the raw font file as the body; family,
// weight, style and the original file name come as query parameters (the
// client reads them from the font's own name table).
func uploadWorkspaceFontHandler(f *workspacefonts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		data, err := io.ReadAll(io.LimitReader(r.Body, workspacefonts.MaxFontBytes+1))
		if err != nil || len(data) > workspacefonts.MaxFontBytes {
			problemWithCode(w, r, http.StatusRequestEntityTooLarge, "Payload Too Large", "font too large", "workspace_font_too_large")
			return
		}
		q := r.URL.Query()
		weight, _ := strconv.Atoi(q.Get("weight"))
		face := workspacefonts.Face{Family: q.Get("family"), Weight: weight, Style: strings.ToLower(q.Get("style"))}
		font, err := f.Create(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "id"), face, q.Get("fileName"), data)
		if err != nil {
			workspaceFontProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusCreated, font)
	}
}

func updateWorkspaceFontHandler(f *workspacefonts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Family string `json:"family"`
			Weight int    `json:"weight"`
			Style  string `json:"style"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid body", "invalid_body")
			return
		}
		face := workspacefonts.Face{Family: body.Family, Weight: body.Weight, Style: strings.ToLower(body.Style)}
		if err := f.Update(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "id"), face); err != nil {
			workspaceFontProblem(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func deleteWorkspaceFontHandler(f *workspacefonts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := f.Delete(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "id")); err != nil {
			workspaceFontProblem(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func workspaceFontFileHandler(f *workspacefonts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		data, format, checksum, err := f.File(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "id"))
		if err != nil {
			workspaceFontProblem(w, r, err)
			return
		}
		w.Header().Set("ETag", `"`+checksum+`"`)
		w.Header().Set("Cache-Control", "private, max-age=0, must-revalidate")
		if strings.Contains(r.Header.Get("If-None-Match"), checksum) {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("Content-Type", workspacefonts.ContentType(format))
		_, _ = w.Write(data)
	}
}
