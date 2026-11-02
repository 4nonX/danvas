package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/authz"
	"hycanvas/backend/internal/colorlibs"
	"hycanvas/backend/internal/exportprofiles"
	"hycanvas/backend/internal/home"
	"hycanvas/backend/internal/printprofiles"
)

// mountSettingsExport attaches the parts of a workspace's settings file. Each
// part has a right of its own, checked here; the file is put together in the
// browser (lib/settingsPackage). Keys, tokens and passwords are not among them.
func mountSettingsExport(api chi.Router, acct *accounts.Service, p *printprofiles.Service, c *colorlibs.Service, e *exportprofiles.Service, h *home.Service) {
	api.With(requireAuth(acct)).Get("/workspaces/{id}/settings-export/{part}", settingsExportHandler(acct, p, c, e, h))
}

type exportedProfile struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Settings    json.RawMessage `json:"settings"`
	IsDefault   bool            `json:"isDefault"`
}

type exportedColorProfile struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	IsDefault   bool   `json:"isDefault"`
	Data        string `json:"data"`
}

type exportedLibrary struct {
	Name       string            `json:"name"`
	SourceFile string            `json:"sourceFile"`
	Entries    []colorlibs.Entry `json:"entries"`
}

func settingsExportHandler(acct *accounts.Service, p *printprofiles.Service, c *colorlibs.Service, e *exportprofiles.Service, h *home.Service) http.HandlerFunc {
	actionOf := map[string]authz.Action{
		"exportProfiles": authz.ExportExportProfiles,
		"printPresets":   authz.ExportPrintPresets,
		"colorProfiles":  authz.ExportColorProfiles,
		"colorLibraries": authz.ExportColorLibraries,
		"roles":          authz.ExportRoles,
		"workspaceRules": authz.ExportWorkspaceRules,
		"folderDefaults": authz.ExportFolderDefaults,
		"memberEmails":   authz.ExportMemberEmails,
	}
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID := userFrom(ctx).ID
		ws, part := chi.URLParam(r, "id"), chi.URLParam(r, "part")
		action, ok := actionOf[part]
		if !ok {
			problemWithCode(w, r, http.StatusNotFound, "Not Found", "not found", "not_found")
			return
		}
		if err := acct.Require(ctx, userID, ws, action, ""); err != nil {
			if a, isAction := accounts.IsActionError(err); isAction {
				actionProblem(w, r, a)
				return
			}
			problemWithCode(w, r, http.StatusForbidden, "Forbidden", "you do not have permission for this action", "forbidden_action")
			return
		}
		failed := func(err error) {
			if errors.Is(err, printprofiles.ErrForbidden) || errors.Is(err, colorlibs.ErrForbidden) {
				problemWithCode(w, r, http.StatusForbidden, "Forbidden", "you do not have permission for this action", "forbidden_action")
				return
			}
			problemWithCode(w, r, http.StatusInternalServerError, "Internal Server Error", "request failed", "request_failed")
		}
		switch part {
		case "exportProfiles", "printPresets":
			kind := "export"
			if part == "printPresets" {
				kind = "print"
			}
			view, err := e.List(ctx, userID, ws, kind)
			if err != nil {
				failed(err)
				return
			}
			out := []exportedProfile{}
			for _, pr := range view.Profiles {
				// The workspace's, not the caller's personal ones.
				if pr.Scope == "workspace" {
					out = append(out, exportedProfile{Name: pr.Name, Description: pr.Description, Settings: pr.Settings, IsDefault: pr.IsDefault})
				}
			}
			writeJSON(w, http.StatusOK, map[string]any{"profiles": out})
		case "colorProfiles":
			list, err := p.List(ctx, userID, ws)
			if err != nil {
				failed(err)
				return
			}
			out := []exportedColorProfile{}
			for _, pr := range list {
				data, _, err := p.Data(ctx, userID, pr.ID)
				if err != nil {
					failed(err)
					return
				}
				out = append(out, exportedColorProfile{Name: pr.Name, Description: pr.Description, IsDefault: pr.IsDefault, Data: base64.StdEncoding.EncodeToString(data)})
			}
			writeJSON(w, http.StatusOK, map[string]any{"profiles": out})
		case "colorLibraries":
			list, err := c.List(ctx, userID, ws)
			if err != nil {
				failed(err)
				return
			}
			out := []exportedLibrary{}
			for _, l := range list {
				entries, err := c.Entries(ctx, userID, l.ID)
				if err != nil {
					failed(err)
					return
				}
				out = append(out, exportedLibrary{Name: l.Name, SourceFile: l.SourceFile, Entries: entries})
			}
			writeJSON(w, http.StatusOK, map[string]any{"libraries": out})
		case "roles":
			view, err := acct.Roles(ctx, userID, ws)
			if err != nil {
				failed(err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"permissions": view.Permissions, "roles": view.Roles})
		case "workspaceRules":
			policy, err := e.GetPrintPolicy(ctx, userID, ws, nil)
			if err != nil {
				failed(err)
				return
			}
			exports, err := e.List(ctx, userID, ws, "export")
			if err != nil {
				failed(err)
				return
			}
			presets, err := e.List(ctx, userID, ws, "print")
			if err != nil {
				failed(err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"rules": map[string]any{
				"requireApproval": policy.RequireApproval, "exportManagedBy": exports.ManagedBy, "printManagedBy": presets.ManagedBy,
			}})
		case "folderDefaults":
			folders, err := h.ListFolders(ctx, userID, ws)
			if err != nil {
				failed(err)
				return
			}
			nameOf := map[string]string{}
			for _, kind := range []string{"export", "print"} {
				view, err := e.List(ctx, userID, ws, kind)
				if err != nil {
					failed(err)
					return
				}
				for _, pr := range view.Profiles {
					nameOf[pr.ID] = pr.Name
				}
			}
			type folderDefault struct {
				FolderID string `json:"folderId"`
				Kind     string `json:"kind"`
				Profile  string `json:"profile"`
			}
			defaults := []folderDefault{}
			for _, f := range folders {
				d, err := h.GetFolderDefaults(ctx, userID, f.ID)
				if err != nil {
					failed(err)
					return
				}
				for kind, id := range d.Own {
					if name, ok := nameOf[id]; ok {
						defaults = append(defaults, folderDefault{FolderID: f.ID, Kind: kind, Profile: name})
					}
				}
			}
			writeJSON(w, http.StatusOK, map[string]any{"folders": folders, "defaults": defaults})
		case "memberEmails":
			members, err := acct.ListMembers(ctx, userID, ws)
			if err != nil {
				failed(err)
				return
			}
			view, err := acct.Roles(ctx, userID, ws)
			if err != nil {
				failed(err)
				return
			}
			// How the role is recognised on another instance (lib/settingsPackage).
			keyOf := map[string]string{}
			for _, ro := range view.Roles {
				if ro.SeedKey != "" {
					keyOf[ro.ID] = "seed:" + ro.SeedKey
				} else {
					keyOf[ro.ID] = "name:" + strings.ToLower(strings.TrimSpace(ro.Name))
				}
			}
			type exportedMember struct {
				Email   string `json:"email"`
				Name    string `json:"name"`
				RoleKey string `json:"roleKey"`
			}
			out := []exportedMember{}
			for _, m := range members {
				out = append(out, exportedMember{Email: m.Email, Name: m.Name, RoleKey: keyOf[m.RoleID]})
			}
			writeJSON(w, http.StatusOK, map[string]any{"members": out})
		}
	}
}
