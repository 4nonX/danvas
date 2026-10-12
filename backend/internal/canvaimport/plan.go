// Package canvaimport runs imports from Canva on the server
// (docs/roadmap/41-canva-import.md): a run started from the import dialog
// keeps going with the browser closed, survives a restart, and is shown to its
// owner on every device. One design at a time, as the browser did before:
// Canva exports it (PPTX when every page supports it, else PNG pages), the
// server converts it with the browser's own importers (internal/pptxconv),
// creates the design in the run's folder tree and records it, so a later run
// skips it. Exports are paced under Canva's limits; a rate limit waits, the
// daily limit pauses the run until Canva allows more.
package canvaimport

import (
	"context"
	"strings"

	"hycanvas/backend/internal/canva"
)

// Pick is a ticked entry of the import dialog's tree: a design or a folder
// ("root" = everything), with the ids of the folders above it.
type Pick struct {
	Type      string   `json:"type"` // "folder" or "design"
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Ancestors []string `json:"ancestors"`
}

// PlannedDesign is one design to import and its folder path below the target.
type PlannedDesign struct {
	ID    string
	Title string
	Path  []string
}

// Plan is what a run imports: every folder path to mirror (parents before
// children, empty folders too) and the designs.
type Plan struct {
	Folders [][]string
	Designs []PlannedDesign
}

// effectivePicks drops picks already covered by a ticked folder above them.
func effectivePicks(picks []Pick) []Pick {
	ticked := map[string]bool{}
	for _, p := range picks {
		if p.Type == "folder" {
			ticked[p.ID] = true
		}
	}
	out := make([]Pick, 0, len(picks))
	for _, p := range picks {
		covered := false
		for _, a := range p.Ancestors {
			if ticked[a] {
				covered = true
				break
			}
		}
		if !covered {
			out = append(out, p)
		}
	}
	return out
}

// lister lists one page of a Canva folder.
type lister func(ctx context.Context, folderID, continuation string) (canva.FolderPage, error)

// planImport builds the plan for a selection: a ticked design goes straight
// into the target, a ticked folder becomes a folder of the same name with
// everything below it mirrored, and "root" mirrors the whole library into the
// target. A design reached twice is planned once. onFolder reports progress
// (the folder being read); stopped ends the walk early.
func planImport(ctx context.Context, picks []Pick, list lister, untitled string, onFolder func(string), stopped func() bool) (Plan, error) {
	var plan Plan
	seenDesigns := map[string]bool{}
	seenFolders := map[string]bool{}
	folderName := func(name string) string {
		if n := strings.TrimSpace(name); n != "" {
			return n
		}
		return untitled
	}
	addFolder := func(path []string) {
		if len(path) == 0 {
			return
		}
		key := strings.ToLower(strings.Join(path, "\x00"))
		if !seenFolders[key] {
			seenFolders[key] = true
			plan.Folders = append(plan.Folders, append([]string(nil), path...))
		}
	}
	addDesign := func(id, name string, path []string) {
		if seenDesigns[id] {
			return
		}
		seenDesigns[id] = true
		title := strings.TrimSpace(name)
		if title == "" {
			title = untitled
		}
		plan.Designs = append(plan.Designs, PlannedDesign{ID: id, Title: title, Path: append([]string(nil), path...)})
	}
	var walk func(folderID string, path []string, visiting map[string]bool) error
	walk = func(folderID string, path []string, visiting map[string]bool) error {
		if stopped() || visiting[folderID] {
			return nil
		}
		visiting[folderID] = true
		defer delete(visiting, folderID)
		addFolder(path)
		last := ""
		if len(path) > 0 {
			last = path[len(path)-1]
		}
		onFolder(last)
		cont := ""
		for {
			if stopped() {
				return nil
			}
			page, err := list(ctx, folderID, cont)
			if err != nil {
				return err
			}
			for _, it := range page.Items {
				if it.Type == "design" {
					addDesign(it.ID, it.Name, path)
					continue
				}
				child := append(append([]string(nil), path...), folderName(it.Name))
				if err := walk(it.ID, child, visiting); err != nil {
					return err
				}
			}
			if page.Continuation == "" {
				return nil
			}
			cont = page.Continuation
		}
	}
	for _, p := range effectivePicks(picks) {
		if stopped() {
			break
		}
		if p.Type == "design" {
			addDesign(p.ID, p.Name, nil)
			continue
		}
		var path []string
		if p.ID != "root" {
			path = []string{folderName(p.Name)}
		}
		if err := walk(p.ID, path, map[string]bool{}); err != nil {
			return Plan{}, err
		}
	}
	return plan, nil
}
