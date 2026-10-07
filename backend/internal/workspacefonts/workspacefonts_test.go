package workspacefonts

import (
	"errors"
	"testing"
)

func TestFormatBySignature(t *testing.T) {
	pad := func(sig string) []byte { return append([]byte(sig), make([]byte, 20)...) }
	cases := map[string]string{
		"wOF2":             "woff2",
		"wOFF":             "woff",
		"OTTO":             "otf",
		"\x00\x01\x00\x00": "ttf",
		"true":             "ttf",
		"ttcf":             "ttc",
		"%PDF":             "",
		"\x89PNG":          "",
	}
	for sig, want := range cases {
		if got := Format(pad(sig)); got != want {
			t.Errorf("%q: got %q, want %q", sig, got, want)
		}
	}
	if Format([]byte("wOF2")) != "" {
		t.Errorf("a 4-byte stub is not a font")
	}
}

func TestFaceClean(t *testing.T) {
	f, err := Face{Family: "  Titillium MAG ", Style: ""}.clean()
	if err != nil || f.Family != "Titillium MAG" || f.Weight != 400 || f.Style != "normal" {
		t.Fatalf("defaults not applied: %+v %v", f, err)
	}
	for _, bad := range []Face{
		{Family: ""},
		{Family: "x", Weight: 1200},
		{Family: "x", Style: "oblique"},
		{Family: `Evil"; }`},
	} {
		if _, err := bad.clean(); !errors.Is(err, ErrInvalid) {
			t.Errorf("%+v accepted", bad)
		}
	}
}
