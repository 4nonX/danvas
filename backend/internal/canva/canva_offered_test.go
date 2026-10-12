package canva

import (
	"errors"
	"reflect"
	"testing"
)

func TestNoExportError_ListsOfferedFormatsAndMatchesErrNoExport(t *testing.T) {
	got := offeredFormats(map[string]exportFormat{
		"pdf":     {},
		"pptx":    {PageNumbers: []int{1, 3}},
		"jpg":     {},
		"../evil": {},
	})
	if want := []string{"jpg", "pdf", "pptx [1,3]"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("offered %v", got)
	}
	var err error = &NoExportError{Offered: got}
	if !errors.Is(err, ErrNoExport) {
		t.Fatal("does not match ErrNoExport")
	}
}
