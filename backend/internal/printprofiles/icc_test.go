package printprofiles

import (
	"encoding/binary"
	"errors"
	"strings"
	"testing"
)

// allTables are the colour tables a complete CMYK output profile carries.
var allTables = []string{"wtpt", "A2B0", "A2B1", "A2B2", "B2A0", "B2A1", "B2A2"}

// profile builds a minimal ICC header with an optional v2 desc tag and the
// given tags (each with a few bytes of data inside the file).
func profile(class, space, pcs string, major byte, desc string, tags ...string) []byte {
	type tag struct {
		sig  string
		data []byte
	}
	var all []tag
	if desc != "" {
		d := append([]byte("desc\x00\x00\x00\x00"), make([]byte, 4)...)
		binary.BigEndian.PutUint32(d[8:12], uint32(len(desc)+1))
		all = append(all, tag{"desc", append(d, []byte(desc+"\x00")...)})
	}
	for _, s := range tags {
		all = append(all, tag{s, []byte("data")})
	}
	n := 132 + 12*len(all)
	size := n
	for _, t := range all {
		size += len(t.data)
	}
	b := make([]byte, size)
	binary.BigEndian.PutUint32(b[0:4], uint32(len(b)))
	b[8] = major
	b[9] = 0x10
	copy(b[12:16], class)
	copy(b[16:20], space)
	copy(b[20:24], pcs)
	copy(b[36:40], "acsp")
	binary.BigEndian.PutUint32(b[128:132], uint32(len(all)))
	at := n
	for i, t := range all {
		e := 132 + 12*i
		copy(b[e:e+4], t.sig)
		binary.BigEndian.PutUint32(b[e+4:e+8], uint32(at))
		binary.BigEndian.PutUint32(b[e+8:e+12], uint32(len(t.data)))
		copy(b[at:], t.data)
		at += len(t.data)
	}
	return b
}

func TestParseICCAcceptsCMYKOutputProfiles(t *testing.T) {
	h, err := ParseICC(profile("prtr", "CMYK", "Lab ", 2, "PSO Coated v3", allTables...))
	if err != nil {
		t.Fatal(err)
	}
	if h.ColorSpace != "CMYK" || h.Version != "2.1" || h.Description != "PSO Coated v3" {
		t.Fatalf("unexpected header %+v", h)
	}
	if _, err := ParseICC(profile("prtr", "CMYK", "XYZ ", 4, "", allTables...)); err != nil {
		t.Fatalf("v4 XYZ profile rejected: %v", err)
	}
	// ICC v4 floating-point tables stand in for the integer ones.
	if _, err := ParseICC(profile("prtr", "CMYK", "Lab ", 4, "", "wtpt", "D2B0", "D2B1", "B2D0", "B2D1")); err != nil {
		t.Fatalf("v4 floating-point profile rejected: %v", err)
	}
}

func TestParseICCRefusesProfilesWithoutEveryTable(t *testing.T) {
	without := func(drop string) []string {
		var out []string
		for _, s := range allTables {
			if s != drop {
				out = append(out, s)
			}
		}
		return out
	}
	// Each of these is used for a print value; none may be filled in.
	for _, drop := range []string{"A2B0", "A2B1", "B2A0", "B2A1", "wtpt"} {
		_, err := ParseICC(profile("prtr", "CMYK", "Lab ", 2, "", without(drop)...))
		if !errors.Is(err, ErrIncompleteProfile) || !strings.Contains(err.Error(), drop) {
			t.Errorf("without %s: want ErrIncompleteProfile naming it, got %v", drop, err)
		}
	}
	// The saturation tables are not used: a profile may leave them out.
	if _, err := ParseICC(profile("prtr", "CMYK", "Lab ", 2, "", "wtpt", "A2B0", "A2B1", "B2A0", "B2A1")); err != nil {
		t.Errorf("profile without saturation tables refused: %v", err)
	}
	// A tag whose data lies outside the file does not count.
	b := profile("prtr", "CMYK", "Lab ", 2, "", allTables...)
	for i := 0; i < len(allTables); i++ {
		e := 132 + 12*i
		if string(b[e:e+4]) == "A2B1" {
			binary.BigEndian.PutUint32(b[e+4:e+8], uint32(len(b)+10))
		}
	}
	if _, err := ParseICC(b); !errors.Is(err, ErrIncompleteProfile) {
		t.Errorf("table pointing outside the file accepted: %v", err)
	}
}

func TestParseICCRejectsOtherFiles(t *testing.T) {
	cases := map[string][]byte{
		"monitor profile": profile("mntr", "RGB ", "XYZ ", 2, "sRGB"),
		"RGB printer":     profile("prtr", "RGB ", "Lab ", 2, ""),
		"device link":     profile("link", "CMYK", "CMYK", 4, ""),
		"not ICC":         []byte("this is not a profile at all, just some text padded out to a reasonable length for the header checks ......"),
		"too short":       []byte("acsp"),
	}
	for name, b := range cases {
		if _, err := ParseICC(b); !errors.Is(err, ErrNotPrintProfile) {
			t.Errorf("%s: want ErrNotPrintProfile, got %v", name, err)
		}
	}
	trunc := profile("prtr", "CMYK", "Lab ", 2, "", allTables...)
	binary.BigEndian.PutUint32(trunc[0:4], uint32(len(trunc)+100))
	if _, err := ParseICC(trunc); !errors.Is(err, ErrNotPrintProfile) {
		t.Errorf("truncated file accepted")
	}
}
