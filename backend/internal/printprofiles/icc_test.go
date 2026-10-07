package printprofiles

import (
	"encoding/binary"
	"errors"
	"testing"
)

// profile builds a minimal ICC header (+ optional v2 desc tag).
func profile(class, space, pcs string, major byte, desc string) []byte {
	tagData := []byte{}
	if desc != "" {
		tagData = append([]byte("desc\x00\x00\x00\x00"), make([]byte, 4)...)
		binary.BigEndian.PutUint32(tagData[8:12], uint32(len(desc)+1))
		tagData = append(tagData, []byte(desc+"\x00")...)
	}
	n := 132
	if desc != "" {
		n += 12
	}
	b := make([]byte, n+len(tagData))
	binary.BigEndian.PutUint32(b[0:4], uint32(len(b)))
	b[8] = major
	b[9] = 0x10
	copy(b[12:16], class)
	copy(b[16:20], space)
	copy(b[20:24], pcs)
	copy(b[36:40], "acsp")
	if desc != "" {
		binary.BigEndian.PutUint32(b[128:132], 1)
		copy(b[132:136], "desc")
		binary.BigEndian.PutUint32(b[136:140], uint32(n))
		binary.BigEndian.PutUint32(b[140:144], uint32(len(tagData)))
		copy(b[n:], tagData)
	}
	return b
}

func TestParseICCAcceptsCMYKOutputProfiles(t *testing.T) {
	h, err := ParseICC(profile("prtr", "CMYK", "Lab ", 2, "PSO Coated v3"))
	if err != nil {
		t.Fatal(err)
	}
	if h.ColorSpace != "CMYK" || h.Version != "2.1" || h.Description != "PSO Coated v3" {
		t.Fatalf("unexpected header %+v", h)
	}
	if _, err := ParseICC(profile("prtr", "CMYK", "XYZ ", 4, "")); err != nil {
		t.Fatalf("v4 XYZ profile rejected: %v", err)
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
	trunc := profile("prtr", "CMYK", "Lab ", 2, "")
	binary.BigEndian.PutUint32(trunc[0:4], uint32(len(trunc)+100))
	if _, err := ParseICC(trunc); !errors.Is(err, ErrNotPrintProfile) {
		t.Errorf("truncated file accepted")
	}
}
