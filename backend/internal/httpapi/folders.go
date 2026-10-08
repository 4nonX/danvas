package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/home"
)

// mountFolders attaches the dashboard design folders (home.Folder).
func mountFolders(api chi.Router, h *home.Service, acct *accounts.Service) {
	api.With(requireAuth(acct)).Get("/workspaces/{id}/folders", listDesignFoldersHandler(h))
	api.With(requireAuth(acct)).Post("/workspaces/{id}/folders", createDesignFolderHandler(h))
	api.With(requireAuth(acct)).Post("/workspaces/{id}/folders/move", moveToFolderHandler(h))
	api.With(requireAuth(acct)).Patch("/folders/{id}", updateDesignFolderHandler(h))
	api.With(requireAuth(acct)).Delete("/folders/{id}", deleteDesignFolderHandler(h))
}

func folderProblem(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, home.ErrForbidden):
		problemWithCode(w, r, http.StatusForbidden, "Forbidden", "not a member of this workspace", "not_workspace_member")
	case errors.Is(err, home.ErrNotFound):
		problemWithCode(w, r, http.StatusNotFound, "Not Found", "folder not found", "folder_not_found")
	case errors.Is(err, home.ErrInvalid):
		problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid folder request", "folder_invalid")
	default:
		problemWithCode(w, r, http.StatusInternalServerError, "Internal Server Error", "request failed", "request_failed")
	}
}

func listDesignFoldersHandler(h *home.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := userFrom(r.Context())
		list, err := h.ListFolders(r.Context(), u.ID, chi.URLParam(r, "id"))
		if err != nil {
			folderProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, list)
	}
}

func createDesignFolderHandler(h *home.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Name     string  `json:"name"`
			ParentID *string `json:"parentId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid body", "invalid_body")
			return
		}
		u := userFrom(r.Context())
		f, err := h.CreateFolder(r.Context(), u.ID, chi.URLParam(r, "id"), body.Name, body.ParentID)
		if err != nil {
			folderProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusCreated, f)
	}
}

// updateDesignFolderHandler renames and/or moves a folder. A present
// "parentId" key moves it (null = workspace root); an absent one leaves it.
func updateDesignFolderHandler(h *home.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var raw map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
			problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid body", "invalid_body")
			return
		}
		var name *string
		if v, ok := raw["name"]; ok {
			if err := json.Unmarshal(v, &name); err != nil {
				problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid name", "invalid_folder_name")
				return
			}
		}
		var parent *string
		v, move := raw["parentId"]
		if move {
			if err := json.Unmarshal(v, &parent); err != nil {
				problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid parentId", "invalid_folder_parent")
				return
			}
		}
		u := userFrom(r.Context())
		if err := h.UpdateFolder(r.Context(), u.ID, chi.URLParam(r, "id"), name, move, parent); err != nil {
			folderProblem(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func deleteDesignFolderHandler(h *home.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := userFrom(r.Context())
		if err := h.DeleteFolder(r.Context(), u.ID, chi.URLParam(r, "id")); err != nil {
			folderProblem(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// moveToFolderHandler moves designs and folders into a folder in one step
// ("folderId": null = workspace root).
func moveToFolderHandler(h *home.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			DesignIDs []string `json:"designIds"`
			FolderIDs []string `json:"folderIds"`
			FolderID  *string  `json:"folderId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.DesignIDs)+len(body.FolderIDs) == 0 || len(body.DesignIDs)+len(body.FolderIDs) > 1000 {
			problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid body", "invalid_body")
			return
		}
		u := userFrom(r.Context())
		if err := h.Move(r.Context(), u.ID, chi.URLParam(r, "id"), body.DesignIDs, body.FolderIDs, body.FolderID); err != nil {
			folderProblem(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
