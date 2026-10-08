// Import from Canva (docs/roadmap/41-canva-import.md): the workspace's Canva
// integration (admin), each member's Canva connection (OAuth with PKCE), and
// the calls the browser-driven import makes (list a folder, start and poll an
// export, download its file, record what was imported).

package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/canva"
)

func mountCanva(api chi.Router, svc *canva.Service, acct *accounts.Service) {
	api.Group(func(r chi.Router) {
		r.Use(requireAuth(acct))
		r.Get("/workspaces/{id}/canva/integration", canvaGetIntegrationHandler(svc, acct))
		r.Put("/workspaces/{id}/canva/integration", canvaSetIntegrationHandler(svc, acct))
		r.Delete("/workspaces/{id}/canva/integration", canvaDeleteIntegrationHandler(svc, acct))
		r.Get("/workspaces/{id}/canva/connection", canvaConnectionHandler(svc, acct))
		r.Post("/workspaces/{id}/canva/connect", canvaConnectHandler(svc, acct))
		r.Delete("/workspaces/{id}/canva/connection", canvaDisconnectHandler(svc, acct))
		r.Get("/workspaces/{id}/canva/folders/{folderId}/items", canvaFolderHandler(svc, acct))
		r.Post("/workspaces/{id}/canva/designs/{designId}/export", canvaExportHandler(svc, acct))
		r.Get("/workspaces/{id}/canva/exports/{jobId}", canvaExportStatusHandler(svc, acct))
		r.Get("/workspaces/{id}/canva/exports/{jobId}/files/{index}", canvaExportFileHandler(svc, acct))
		r.Get("/workspaces/{id}/canva/imports", canvaImportsHandler(svc, acct))
		r.Post("/workspaces/{id}/canva/imports", canvaRecordImportHandler(svc, acct))
		// Canva sends the browser back here after consent (top-level GET, so
		// the Lax session cookie comes along).
		r.Get("/canva/callback", canvaCallbackHandler(svc))
	})
}

// canvaRedirectURI is this instance's OAuth redirect URL as the browser sees
// it, the one to register in Canva: scheme and host of the request, taking a
// reverse proxy's X-Forwarded-Proto/Host into account.
func canvaRedirectURI(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0]), "https") {
		scheme = "https"
	}
	host := r.Host
	if fh := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Host"), ",")[0]); fh != "" {
		host = fh
	}
	return scheme + "://" + host + canva.CallbackPath
}

// canvaProblem maps the module's errors to coded problem+json responses.
func canvaProblem(w http.ResponseWriter, r *http.Request, err error) {
	var rl *canva.RateLimitError
	switch {
	case errors.As(err, &rl):
		w.Header().Set("Retry-After", strconv.Itoa(int(rl.RetryAfter.Seconds())))
		if rl.Daily {
			problemWithCode(w, r, http.StatusTooManyRequests, "Too Many Requests", "Canva's daily export limit is reached; continue the import tomorrow", "canva_daily_limit")
			return
		}
		problemWithCode(w, r, http.StatusTooManyRequests, "Too Many Requests", "Canva asked to slow down; the import waits and continues", "canva_rate_limited")
	case errors.Is(err, canva.ErrNotConfigured):
		problemWithCode(w, r, http.StatusConflict, "Conflict", "no Canva integration is set up for this workspace; an admin adds it in the workspace settings", "canva_not_configured")
	case errors.Is(err, canva.ErrNotConnected):
		problemWithCode(w, r, http.StatusConflict, "Conflict", "connect your Canva account first", "canva_not_connected")
	case errors.Is(err, canva.ErrSecretRequired):
		problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "enter the client secret of the Canva integration", "canva_secret_required")
	case errors.Is(err, canva.ErrNoExport):
		problemWithCode(w, r, http.StatusUnprocessableEntity, "Unprocessable Entity", "Canva cannot export this design as a presentation or as images", "canva_no_export")
	case errors.Is(err, canva.ErrBadRequest):
		problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid Canva request", "canva_bad_request")
	case errors.Is(err, canva.ErrUpstream):
		problemWithCode(w, r, http.StatusBadGateway, "Bad Gateway", "the request to Canva failed", "canva_request_failed")
	default:
		problemWithCode(w, r, http.StatusInternalServerError, "Internal Server Error", "Canva import error", "canva_internal_error")
	}
}

// canvaMember checks the caller's role in the workspace of the URL.
func canvaMember(w http.ResponseWriter, r *http.Request, acct *accounts.Service, minRole string) (ws, userID string, ok bool) {
	ws = chi.URLParam(r, "id")
	u := userFrom(r.Context())
	if acct.AssertMember(r.Context(), u.ID, ws, minRole) != nil {
		if minRole == "admin" {
			problemWithCode(w, r, http.StatusForbidden, "Forbidden", "admin access required", "admin_access_required")
		} else {
			problemWithCode(w, r, http.StatusForbidden, "Forbidden", "not a member of this workspace", "not_workspace_member")
		}
		return "", "", false
	}
	return ws, u.ID, true
}

type canvaIntegrationResponse struct {
	canva.IntegrationView
	RedirectURI string `json:"redirectUri"`
}

func canvaGetIntegrationHandler(svc *canva.Service, acct *accounts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ws, _, ok := canvaMember(w, r, acct, "viewer")
		if !ok {
			return
		}
		v, err := svc.GetIntegration(r.Context(), ws)
		if err != nil {
			canvaProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, canvaIntegrationResponse{IntegrationView: v, RedirectURI: canvaRedirectURI(r)})
	}
}

func canvaSetIntegrationHandler(svc *canva.Service, acct *accounts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ws, _, ok := canvaMember(w, r, acct, "admin")
		if !ok {
			return
		}
		var body struct {
			ClientID     string `json:"clientId"`
			ClientSecret string `json:"clientSecret"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 16<<10)).Decode(&body); err != nil {
			problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid body", "invalid_body")
			return
		}
		v, err := svc.SetIntegration(r.Context(), ws, body.ClientID, body.ClientSecret)
		if err != nil {
			canvaProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, canvaIntegrationResponse{IntegrationView: v, RedirectURI: canvaRedirectURI(r)})
	}
}

func canvaDeleteIntegrationHandler(svc *canva.Service, acct *accounts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ws, _, ok := canvaMember(w, r, acct, "admin")
		if !ok {
			return
		}
		if err := svc.DeleteIntegration(r.Context(), ws); err != nil {
			canvaProblem(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func canvaConnectionHandler(svc *canva.Service, acct *accounts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ws, userID, ok := canvaMember(w, r, acct, "member")
		if !ok {
			return
		}
		v, err := svc.Connection(r.Context(), ws, userID)
		if err != nil {
			canvaProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, v)
	}
}

func canvaConnectHandler(svc *canva.Service, acct *accounts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ws, userID, ok := canvaMember(w, r, acct, "member")
		if !ok {
			return
		}
		var body struct {
			ReturnTo string `json:"returnTo"`
		}
		_ = json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&body)
		authURL, err := svc.StartConnect(r.Context(), ws, userID, canvaRedirectURI(r), body.ReturnTo)
		if err != nil {
			canvaProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"authorizeUrl": authURL})
	}
}

func canvaCallbackHandler(svc *canva.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// In development the app runs on its own origin; in production it is
		// served by this binary, so a relative path lands on the same host
		// Canva just sent the browser to (whatever APP_URL says).
		front := strings.TrimRight(os.Getenv("FRONTEND_URL"), "/")
		q := r.URL.Query()
		if q.Get("error") != "" { // the user declined, or Canva refused
			http.Redirect(w, r, front+"/dashboard/?canva=declined", http.StatusFound)
			return
		}
		ret, err := svc.FinishConnect(r.Context(), userFrom(r.Context()).ID, q.Get("state"), q.Get("code"))
		if err != nil {
			http.Redirect(w, r, front+"/dashboard/?canva=failed", http.StatusFound)
			return
		}
		sep := "?"
		if strings.Contains(ret, "?") {
			sep = "&"
		}
		http.Redirect(w, r, front+ret+sep+"canva=connected", http.StatusFound)
	}
}

func canvaDisconnectHandler(svc *canva.Service, acct *accounts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ws, userID, ok := canvaMember(w, r, acct, "member")
		if !ok {
			return
		}
		if err := svc.Disconnect(r.Context(), ws, userID); err != nil {
			canvaProblem(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func canvaFolderHandler(svc *canva.Service, acct *accounts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ws, userID, ok := canvaMember(w, r, acct, "member")
		if !ok {
			return
		}
		page, err := svc.ListFolder(r.Context(), ws, userID, chi.URLParam(r, "folderId"), r.URL.Query().Get("continuation"))
		if err != nil {
			canvaProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, page)
	}
}

func canvaExportHandler(svc *canva.Service, acct *accounts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ws, userID, ok := canvaMember(w, r, acct, "member")
		if !ok {
			return
		}
		exp, err := svc.StartExport(r.Context(), ws, userID, chi.URLParam(r, "designId"))
		if err != nil {
			canvaProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, exp)
	}
}

func canvaExportStatusHandler(svc *canva.Service, acct *accounts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ws, userID, ok := canvaMember(w, r, acct, "member")
		if !ok {
			return
		}
		st, err := svc.GetExport(r.Context(), ws, userID, chi.URLParam(r, "jobId"))
		if err != nil {
			canvaProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, st)
	}
}

func canvaExportFileHandler(svc *canva.Service, acct *accounts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ws, userID, ok := canvaMember(w, r, acct, "member")
		if !ok {
			return
		}
		index, err := strconv.Atoi(chi.URLParam(r, "index"))
		if err != nil {
			canvaProblem(w, r, canva.ErrBadRequest)
			return
		}
		body, ctype, err := svc.ExportFile(r.Context(), ws, userID, chi.URLParam(r, "jobId"), index)
		if err != nil {
			canvaProblem(w, r, err)
			return
		}
		defer body.Close()
		if ctype == "" {
			ctype = "application/octet-stream"
		}
		w.Header().Set("Content-Type", ctype)
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		_, _ = io.Copy(w, body)
	}
}

func canvaImportsHandler(svc *canva.Service, acct *accounts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ws, _, ok := canvaMember(w, r, acct, "member")
		if !ok {
			return
		}
		m, err := svc.Imported(r.Context(), ws)
		if err != nil {
			canvaProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"imported": m})
	}
}

func canvaRecordImportHandler(svc *canva.Service, acct *accounts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ws, _, ok := canvaMember(w, r, acct, "member")
		if !ok {
			return
		}
		var body struct {
			CanvaDesignID string `json:"canvaDesignId"`
			DesignID      string `json:"designId"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&body); err != nil {
			problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid body", "invalid_body")
			return
		}
		if _, err := uuid.Parse(body.DesignID); err != nil {
			canvaProblem(w, r, canva.ErrBadRequest)
			return
		}
		if err := svc.RecordImport(r.Context(), ws, body.CanvaDesignID, body.DesignID); err != nil {
			canvaProblem(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
