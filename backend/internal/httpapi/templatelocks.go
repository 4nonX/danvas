package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/persistence"
	"hycanvas/backend/internal/sharing"
	"hycanvas/backend/internal/templatelock"
)

// mountTemplateLocks serves who stands behind the template locks in a design:
// for each workspace a lock names, its name, the people who may lift its locks,
// and whether the caller is one of them. The editor shows this when a user hits
// a lock, and offers the rights holder the switch to edit the template.
func mountTemplateLocks(api chi.Router, p *persistence.Service, sh *sharing.Service, acct *accounts.Service) {
	api.With(requireAuth(acct)).Get("/designs/{id}/template-locks", templateLocksHandler(p, sh, acct))
}

func templateLocksHandler(p *persistence.Service, sh *sharing.Service, acct *accounts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		ws, err := authorizeDesignRead(r, p, acct, sh, id)
		if err != nil {
			authProblem(w, r, err)
			return
		}
		// Described: the workspaces the saved design names, plus any asked for
		// (?ws=, locks from a template applied since the last save) that the
		// caller belongs to. The route never reveals who administers a
		// workspace the caller has no tie to.
		u := userFrom(r.Context())
		seen := map[string]bool{}
		named := []string{}
		if cur, err := p.LoadFile(r.Context(), id, ws); err == nil && cur.File != nil {
			for _, lw := range templatelock.Workspaces(cur.File) {
				if !seen[lw] {
					seen[lw] = true
					named = append(named, lw)
				}
			}
		}
		for _, lw := range r.URL.Query()["ws"] {
			if lw != "" && !seen[lw] && len(named) < 20 && sh.IsActiveMember(r.Context(), u.ID, lw) {
				seen[lw] = true
				named = append(named, lw)
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"workspaces":    sh.TemplateLockInfo(r.Context(), id, u.ID, named),
			"workspaceName": sh.WorkspaceName(r.Context(), ws),
			// Whether the caller may lock objects for the design's own workspace.
			"canManage":   sh.CanLiftTemplateLocks(r.Context(), id, u.ID, ws),
			"workspaceId": ws,
		})
	}
}
