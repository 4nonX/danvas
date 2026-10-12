package canvaimport

import (
	"context"
	"reflect"
	"strconv"
	"testing"
	"time"

	"hycanvas/backend/internal/canva"
)

// root
//
//	Clients/            (F1)
//	  Acme/             (F2)
//	    Pitch           (D1)
//	  Empty/            (F3)
//	  Brief             (D2)
//	Personal/           (F4)
//	  Card              (D3)
//	Loose deck          (D4)
var tree = map[string][]canva.Item{
	"root": {{Type: "folder", ID: "F1", Name: "Clients"}, {Type: "folder", ID: "F4", Name: "Personal"}, {Type: "design", ID: "D4", Name: "Loose deck"}},
	"F1":   {{Type: "folder", ID: "F2", Name: "Acme"}, {Type: "folder", ID: "F3", Name: "Empty"}, {Type: "design", ID: "D2", Name: "Brief"}},
	"F2":   {{Type: "design", ID: "D1", Name: "Pitch"}},
	"F3":   {},
	"F4":   {{Type: "design", ID: "D3", Name: "Card"}},
}

// treeLister lists the tree one item per page, so continuation is exercised.
func treeLister(calls *[]string) lister {
	return func(_ context.Context, id, cont string) (canva.FolderPage, error) {
		*calls = append(*calls, id)
		items := tree[id]
		at := 0
		if cont != "" {
			at, _ = strconv.Atoi(cont)
		}
		page := canva.FolderPage{}
		if at < len(items) {
			page.Items = items[at : at+1]
		}
		if at+1 < len(items) {
			page.Continuation = strconv.Itoa(at + 1)
		}
		return page, nil
	}
}

func plan(t *testing.T, picks []Pick, stopped func() bool, calls *[]string) Plan {
	t.Helper()
	if calls == nil {
		calls = &[]string{}
	}
	p, err := planImport(context.Background(), picks, treeLister(calls), "Untitled", func(string) {}, stopped)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func never() bool { return false }

func TestPlan_MirrorsATickedFolderTreeEmptyFoldersIncluded(t *testing.T) {
	p := plan(t, []Pick{{Type: "folder", ID: "F1", Name: "Clients", Ancestors: []string{"root"}}}, never, nil)
	if want := [][]string{{"Clients"}, {"Clients", "Acme"}, {"Clients", "Empty"}}; !reflect.DeepEqual(p.Folders, want) {
		t.Fatalf("folders %v", p.Folders)
	}
	want := []PlannedDesign{{ID: "D1", Title: "Pitch", Path: []string{"Clients", "Acme"}}, {ID: "D2", Title: "Brief", Path: []string{"Clients"}}}
	if !reflect.DeepEqual(p.Designs, want) {
		t.Fatalf("designs %+v", p.Designs)
	}
}

func TestPlan_MixOfDesignsAndFolders(t *testing.T) {
	p := plan(t, []Pick{
		{Type: "design", ID: "D4", Name: "Loose deck", Ancestors: []string{"root"}},
		{Type: "folder", ID: "F2", Name: "Acme", Ancestors: []string{"root", "F1"}},
		{Type: "design", ID: "D3", Name: "Card", Ancestors: []string{"root", "F4"}},
	}, never, nil)
	if want := [][]string{{"Acme"}}; !reflect.DeepEqual(p.Folders, want) {
		t.Fatalf("folders %v", p.Folders)
	}
	want := []PlannedDesign{{ID: "D4", Title: "Loose deck"}, {ID: "D1", Title: "Pitch", Path: []string{"Acme"}}, {ID: "D3", Title: "Card"}}
	if !reflect.DeepEqual(p.Designs, want) {
		t.Fatalf("designs %+v", p.Designs)
	}
}

func TestPlan_EverythingMirrorsTheLibraryIntoTheTarget(t *testing.T) {
	p := plan(t, []Pick{
		{Type: "folder", ID: "root"},
		{Type: "design", ID: "D1", Name: "Pitch", Ancestors: []string{"root", "F1", "F2"}},
	}, never, nil)
	if want := [][]string{{"Clients"}, {"Clients", "Acme"}, {"Clients", "Empty"}, {"Personal"}}; !reflect.DeepEqual(p.Folders, want) {
		t.Fatalf("folders %v", p.Folders)
	}
	var got [][2]string
	for _, d := range p.Designs {
		path := ""
		for i, s := range d.Path {
			if i > 0 {
				path += "/"
			}
			path += s
		}
		got = append(got, [2]string{d.ID, path})
	}
	if want := [][2]string{{"D1", "Clients/Acme"}, {"D2", "Clients"}, {"D3", "Personal"}, {"D4", ""}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("designs %v", got)
	}
}

func TestPlan_UntitledNames(t *testing.T) {
	p, err := planImport(context.Background(), []Pick{{Type: "design", ID: "D9", Name: "  "}}, treeLister(&[]string{}), "Ohne Titel", func(string) {}, never)
	if err != nil || len(p.Designs) != 1 || p.Designs[0].Title != "Ohne Titel" {
		t.Fatalf("%+v %v", p.Designs, err)
	}
}

func TestPlan_StopsReadingWhenStopped(t *testing.T) {
	calls := []string{}
	p := plan(t, []Pick{{Type: "folder", ID: "root"}}, func() bool { return len(calls) >= 1 }, &calls)
	if len(p.Designs) != 0 {
		t.Fatalf("designs %+v", p.Designs)
	}
}

func TestEffectivePicks_DropsPicksCoveredByATickedFolder(t *testing.T) {
	got := effectivePicks([]Pick{
		{Type: "folder", ID: "F1", Ancestors: []string{"root"}},
		{Type: "folder", ID: "F2", Ancestors: []string{"root", "F1"}},
		{Type: "design", ID: "D2", Ancestors: []string{"root", "F1"}},
		{Type: "design", ID: "D4", Ancestors: []string{"root"}},
	})
	var ids []string
	for _, p := range got {
		ids = append(ids, p.ID)
	}
	if !reflect.DeepEqual(ids, []string{"F1", "D4"}) {
		t.Fatalf("%v", ids)
	}
}

func TestPacer_AllowsAtMostMaxStartsPerWindow(t *testing.T) {
	now := time.Unix(0, 0)
	var slept []time.Duration
	p := newPacer(3, time.Minute, func() time.Time { return now }, func(_ context.Context, d time.Duration) error {
		slept = append(slept, d)
		now = now.Add(d)
		return nil
	})
	for i := 0; i < 3; i++ {
		_ = p.wait(context.Background())
	}
	if len(slept) != 0 {
		t.Fatalf("slept %v", slept)
	}
	now = time.Unix(10, 0)
	_ = p.wait(context.Background())
	if !reflect.DeepEqual(slept, []time.Duration{50 * time.Second}) || !now.Equal(time.Unix(60, 0)) {
		t.Fatalf("slept %v now %v", slept, now)
	}
}
