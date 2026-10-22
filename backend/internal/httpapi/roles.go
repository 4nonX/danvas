// Workspace roles and permissions (F42): the page "Roles and permissions" and
// the caller's own actions. Every member reads; changes need roles.manage, and
// the accounts service enforces the guard rails (no escalation, the protected
// owner role, never one's own role).
//
// The paths differ from /workspaces/{wid}/roles and /roles/{rid}, which serve
// the design-scoped custom roles attached to share grants.
package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"hycanvas/backend/internal/accounts"
)

func mountRoles(api chi.Router, acct *accounts.Service) {
	if acct == nil {
		return
	}
	api.With(requireAuth(acct)).Get("/workspaces/{id}/me/actions", myActionsHandler(acct))
	api.With(requireAuth(acct)).Get("/workspaces/{id}/workspace-roles", rolesViewHandler(acct))
	api.With(requireAuth(acct)).Post("/workspaces/{id}/workspace-roles", createWorkspaceRoleHandler(acct))
	api.With(requireAuth(acct)).Patch("/workspace-roles/{roleId}", updateWorkspaceRoleHandler(acct))
	api.With(requireAuth(acct)).Delete("/workspace-roles/{roleId}", deleteWorkspaceRoleHandler(acct))
	api.With(requireAuth(acct)).Post("/workspaces/{id}/workspace-permissions", createPermissionHandler(acct))
	api.With(requireAuth(acct)).Patch("/workspace-permissions/{permissionId}", updatePermissionHandler(acct))
	api.With(requireAuth(acct)).Delete("/workspace-permissions/{permissionId}", deletePermissionHandler(acct))
	api.With(requireAuth(acct)).Get("/workspaces/{id}/role-events", roleEventsHandler(acct))
}

// rolesProblem maps the role management errors.
func rolesProblem(w http.ResponseWriter, r *http.Request, err error) {
	if a, ok := accounts.IsActionError(err); ok {
		actionProblem(w, r, a)
		return
	}
	switch {
	case errors.Is(err, accounts.ErrNameTaken):
		problemWithCode(w, r, http.StatusConflict, "Conflict", "another permission or role has this name", "role_name_taken")
	case errors.Is(err, accounts.ErrRoleInUse):
		problemWithCode(w, r, http.StatusConflict, "Conflict", "the role still has members; choose a role to move them to", "role_in_use")
	case errors.Is(err, accounts.ErrOwnRole):
		problemWithCode(w, r, http.StatusConflict, "Conflict", "you cannot change the role you hold", "role_is_own")
	case errors.Is(err, accounts.ErrProtectedRole):
		problemWithCode(w, r, http.StatusConflict, "Conflict", "the owner role always has every action and cannot be deleted", "role_protected")
	case errors.Is(err, accounts.ErrForbidden):
		problemWithCode(w, r, http.StatusForbidden, "Forbidden", "you can only hand out actions you hold yourself", "role_escalation")
	default:
		membersProblem(w, r, err)
	}
}

func myActionsHandler(acct *accounts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		mr, err := acct.MyActions(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "id"))
		if err != nil {
			membersProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, mr)
	}
}

func rolesViewHandler(acct *accounts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v, err := acct.Roles(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "id"))
		if err != nil {
			rolesProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, v)
	}
}

func createWorkspaceRoleHandler(acct *accounts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in accounts.RoleInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid body", "invalid_body")
			return
		}
		id, err := acct.CreateRole(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "id"), in)
		if err != nil {
			rolesProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"id": id})
	}
}

func updateWorkspaceRoleHandler(acct *accounts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in accounts.RoleInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid body", "invalid_body")
			return
		}
		if err := acct.UpdateRole(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "roleId"), in); err != nil {
			rolesProblem(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func deleteWorkspaceRoleHandler(acct *accounts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := acct.DeleteRole(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "roleId"), r.URL.Query().Get("reassignTo")); err != nil {
			rolesProblem(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func createPermissionHandler(acct *accounts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in accounts.PermissionInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid body", "invalid_body")
			return
		}
		id, err := acct.CreatePermission(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "id"), in)
		if err != nil {
			rolesProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"id": id})
	}
}

func updatePermissionHandler(acct *accounts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in accounts.PermissionInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid body", "invalid_body")
			return
		}
		if err := acct.UpdatePermission(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "permissionId"), in); err != nil {
			rolesProblem(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func deletePermissionHandler(acct *accounts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := acct.DeletePermission(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "permissionId")); err != nil {
			rolesProblem(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func roleEventsHandler(acct *accounts.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		events, err := acct.RoleEvents(r.Context(), userFrom(r.Context()).ID, chi.URLParam(r, "id"), limit)
		if err != nil {
			rolesProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, events)
	}
}
