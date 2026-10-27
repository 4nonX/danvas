package workspacefonts

import (
	"bytes"
	"encoding/binary"
	"testing"
)

// testFont builds a minimal sfnt with head, maxp, a format 4 cmap whose
// segments are A-Z (delta to glyphs 1..26) and the closing 0xFFFF one with
// the given delta, and the given post table (none when nil).
func testFont(closingDelta uint16, post []byte) []byte {
	be := binary.BigEndian
	head := make([]byte, 54)
	be.PutUint32(head[12:], 0x5F0F3CF5)
	maxp := make([]byte, 6)
	be.PutUint32(maxp, 0x00005000)
	be.PutUint16(maxp[4:], 27)

	sub := make([]byte, 14+4*2*2+2)
	be.PutUint16(sub[0:], 4)
	be.PutUint16(sub[2:], uint16(len(sub)))
	be.PutUint16(sub[6:], 4) // segCountX2
	p := 14
	for _, v := range []uint16{'Z', 0xFFFF, 0, 'A', 0xFFFF, uint16(0x10000 + 1 - 'A'), closingDelta, 0, 0} {
		be.PutUint16(sub[p:], v)
		p += 2
	}
	cmap := make([]byte, 12)
	be.PutUint16(cmap[2:], 1)
	be.PutUint16(cmap[4:], 3)
	be.PutUint16(cmap[6:], 1)
	be.PutUint32(cmap[8:], 12)
	cmap = append(cmap, sub...)

	tables := []struct {
		tag  string
		data []byte
	}{{"cmap", cmap}, {"head", head}, {"maxp", maxp}}
	if post != nil {
		tables = append(tables, struct {
			tag  string
			data []byte
		}{"post", post})
	}
	out := make([]byte, 12+16*len(tables))
	be.PutUint32(out, 0x00010000)
	be.PutUint16(out[4:], uint16(len(tables)))
	for i, t := range tables {
		rec := 12 + 16*i
		copy(out[rec:], t.tag)
		be.PutUint32(out[rec+4:], checksum(t.data))
		be.PutUint32(out[rec+8:], uint32(len(out)))
		be.PutUint32(out[rec+12:], uint32(len(t.data)))
		out = append(out, t.data...)
		for len(out)%4 != 0 {
			out = append(out, 0)
		}
	}
	return out
}

func closingDelta(t *testing.T, font []byte) uint16 {
	t.Helper()
	c := sfntTables(font)["cmap"]
	return binary.BigEndian.Uint16(font[c.offset+12+14+2*2+2+2*2+2:])
}

func TestRepairFixesTheClosingCmapSegment(t *testing.T) {
	broken := testFont(0, nil)
	fixed, ok := Repair(broken)
	if !ok {
		t.Fatal("expected a repair")
	}
	if got := closingDelta(t, fixed); got != 1 {
		t.Fatalf("closing delta = %d, want 1", got)
	}
	if closingDelta(t, broken) != 0 {
		t.Fatal("the input was changed")
	}
	tbl := sfntTables(fixed)
	c := tbl["cmap"]
	if binary.BigEndian.Uint32(fixed[c.record+4:]) != checksum(fixed[c.offset:c.offset+c.length]) {
		t.Fatal("cmap checksum not updated")
	}
	if checksum(fixed) != 0xB1B0AFBA {
		t.Fatalf("font checksum = %#x, want 0xB1B0AFBA", checksum(fixed))
	}
	if len(fixed) != len(broken) {
		t.Fatal("length changed")
	}
}

func TestRepairLeavesGoodAndForeignFilesAlone(t *testing.T) {
	good := testFont(1, nil)
	if out, ok := Repair(good); ok || !bytes.Equal(out, good) {
		t.Fatal("a correct font was changed")
	}
	for _, b := range [][]byte{nil, []byte("wOF2...."), []byte("not a font at all")} {
		if out, ok := Repair(b); ok || !bytes.Equal(out, b) {
			t.Fatalf("%q was changed", b)
		}
	}
	trunc := testFont(0, nil)[:40]
	if _, ok := Repair(trunc); ok {
		t.Fatal("a truncated font was repaired")
	}
}

// postV2 is a version 2 glyph name table for 27 glyphs: standard names for
// all but the last, which names the first of the given strings (index 258).
func postV2(numGlyphs int, lastIndex uint16, names ...string) []byte {
	p := make([]byte, 34+2*numGlyphs)
	binary.BigEndian.PutUint32(p, 0x00020000)
	binary.BigEndian.PutUint16(p[32:], uint16(numGlyphs))
	binary.BigEndian.PutUint16(p[34+2*(numGlyphs-1):], lastIndex)
	for _, n := range names {
		p = append(p, byte(len(n)))
		p = append(p, n...)
	}
	return p
}

func TestRepairDropsUnreadableGlyphNames(t *testing.T) {
	for name, post := range map[string][]byte{
		"index past the strings": postV2(27, 65277, "uni00A0"),
		"other glyph count":      postV2(26, 258, "uni00A0"),
		"string past the end":    append(postV2(27, 258), 9, 'x'),
	} {
		font := testFont(1, post)
		fixed, ok := Repair(font)
		if !ok {
			t.Fatalf("%s: expected a repair", name)
		}
		p := sfntTables(fixed)["post"]
		if v := binary.BigEndian.Uint32(fixed[p.offset:]); v != 0x00030000 {
			t.Fatalf("%s: post version = %#x, want 3.0", name, v)
		}
		if binary.BigEndian.Uint32(fixed[p.record+4:]) != checksum(fixed[p.offset:p.offset+p.length]) || checksum(fixed) != 0xB1B0AFBA {
			t.Fatalf("%s: checksums not updated", name)
		}
		if len(fixed) != len(font) {
			t.Fatalf("%s: length changed", name)
		}
	}
}

func TestRepairKeepsReadableGlyphNames(t *testing.T) {
	font := testFont(1, postV2(27, 258, "uni00A0"))
	if out, ok := Repair(font); ok || !bytes.Equal(out, font) {
		t.Fatal("a readable post table was changed")
	}
}
