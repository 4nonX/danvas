package pptxconv

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"regexp"
	"testing"
)

var uuidRe = regexp.MustCompile(`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`)

// decode parses design JSON with random ids replaced by "U", as the fixture
// generator does.
func decode(t *testing.T, raw []byte) any {
	t.Helper()
	var v any
	if err := json.Unmarshal(uuidRe.ReplaceAll(raw, []byte("U")), &v); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return v
}

// same compares decoded JSON; numbers may differ in the last digits, where
// Go's and V8's trigonometry round differently (positions of rotated shapes).
func same(a, b any, path string) error {
	switch x := a.(type) {
	case map[string]any:
		y, ok := b.(map[string]any)
		if !ok || len(x) != len(y) {
			return fmt.Errorf("%s: object differs", path)
		}
		for k, v := range x {
			if err := same(v, y[k], path+"."+k); err != nil {
				return err
			}
		}
	case []any:
		y, ok := b.([]any)
		if !ok || len(x) != len(y) {
			return fmt.Errorf("%s: array differs", path)
		}
		for i := range x {
			if err := same(x[i], y[i], fmt.Sprintf("%s[%d]", path, i)); err != nil {
				return err
			}
		}
	case float64:
		y, ok := b.(float64)
		if !ok || math.Abs(x-y) > 1e-9*math.Max(1, math.Abs(x)) {
			return fmt.Errorf("%s: %v != %v", path, a, b)
		}
	default:
		if a != b {
			return fmt.Errorf("%s: %v != %v", path, a, b)
		}
	}
	return nil
}

func read(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	return b
}

// The deck converts under goja to what the browser's importer makes of it
// (testdata/deck-expected.json is generated under Node by
// scripts/gen-pptx-convert-fixture.mjs; regenerate it alongside
// `npm run gen:pptx-convert` when the importer changes intentionally).
func TestPPTX_ParityWithNode(t *testing.T) {
	got, err := PPTX(context.Background(), read(t, "deck.pptx"), "Fixture")
	if err != nil {
		t.Fatalf("PPTX: %v", err)
	}
	if err := same(decode(t, read(t, "deck-expected.json")), decode(t, got), ""); err != nil {
		t.Fatalf("goja conversion diverged from the Node-generated fixture: %v", err)
	}
}

func TestImagePages_ParityWithNode(t *testing.T) {
	got, err := ImagePages(context.Background(), "Pages", []Page{
		{Bytes: read(t, "page1.png"), MIME: "image/png"},
		{Bytes: read(t, "page2.png"), MIME: "image/png"},
	})
	if err != nil {
		t.Fatalf("ImagePages: %v", err)
	}
	if err := same(decode(t, read(t, "pages-expected.json")), decode(t, got), ""); err != nil {
		t.Fatalf("goja page images diverged from the Node-generated fixture: %v", err)
	}
}

func TestPPTX_RefusesWhatItCannotRead(t *testing.T) {
	if _, err := PPTX(context.Background(), []byte("not a zip"), "x"); err == nil {
		t.Fatal("a file that is no archive must fail")
	}
	if _, err := ImagePages(context.Background(), "x", []Page{{Bytes: []byte("no image")}}); err == nil {
		t.Fatal("a page that is no image must fail")
	}
	if _, err := ImagePages(context.Background(), "x", nil); err == nil {
		t.Fatal("an export without pages must fail")
	}
}

// An archive whose entry inflates past the limit is refused while inflating,
// before the bytes reach the VM.
func TestPPTX_DecompressionLimit(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.CreateHeader(&zip.FileHeader{Name: "ppt/presentation.xml", Method: zip.Deflate})
	_, _ = w.Write(bytes.Repeat([]byte("a"), 64<<10))
	_ = zw.Close()

	old := maxEntryBytes
	maxEntryBytes = 16 << 10
	defer func() { maxEntryBytes = old }()
	_, err := PPTX(context.Background(), buf.Bytes(), "x")
	if !errors.Is(err, ErrTooLarge) {
		t.Fatalf("want ErrTooLarge, got %v", err)
	}
}

func TestPPTX_StopsWithItsContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := PPTX(ctx, read(t, "deck.pptx"), "x"); err == nil {
		t.Fatal("a cancelled conversion must not succeed")
	}
}
