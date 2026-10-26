package httpapi

import (
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/uiprefs"
)

// mountUIPrefs attaches the caller's interface preferences (the editor's
// element rows and the like), kept with the account so they follow the
// person to every device.
func mountUIPrefs(api chi.Router, p *uiprefs.Service, acct *accounts.Service) {
	api.With(requireAuth(acct)).Get("/me/ui-prefs", getUIPrefsHandler(p))
	api.With(requireAuth(acct)).Put("/me/ui-prefs/{key}", setUIPrefHandler(p))
}

func uiPrefProblem(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, uiprefs.ErrInvalid):
		problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid preference", "ui_pref_invalid")
	case errors.Is(err, uiprefs.ErrTooLarge):
		problemWithCode(w, r, http.StatusRequestEntityTooLarge, "Payload Too Large", "preference too large", "ui_pref_too_large")
	default:
		problemWithCode(w, r, http.StatusInternalServerError, "Internal Server Error", "request failed", "request_failed")
	}
}

func getUIPrefsHandler(p *uiprefs.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		all, err := p.All(r.Context(), userFrom(r.Context()).ID)
		if err != nil {
			uiPrefProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, all)
	}
}

func setUIPrefHandler(p *uiprefs.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		data, err := io.ReadAll(io.LimitReader(r.Body, uiprefs.MaxValueBytes+1))
		if err != nil {
			uiPrefProblem(w, r, uiprefs.ErrInvalid)
			return
		}
		if len(data) > uiprefs.MaxValueBytes {
			uiPrefProblem(w, r, uiprefs.ErrTooLarge)
			return
		}
		if err := p.Set(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "key"), data); err != nil {
			uiPrefProblem(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
