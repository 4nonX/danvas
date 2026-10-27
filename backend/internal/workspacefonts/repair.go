package workspacefonts

import "encoding/binary"

// Repair fixes two defects common in older TrueType files converted from
// other formats. Chrome reads such fonts; Firefox rejects the whole file, so
// text set in it falls back to another font there:
//
//   - the closing 0xFFFF segment of a format 4 character map points at glyph
//     65535 instead of glyph 0 ("Range glyph reference too high"): it gets
//     the delta the specification asks for (1, mapping U+FFFF to glyph 0);
//   - a version 2 glyph name table ("post") that names strings it does not
//     hold or counts other glyphs than the font ("Bad string index"): it
//     becomes version 3, which carries no glyph names. Nothing draws with
//     them; the metrics in the table stay.
//
// Both are changed in place, so the file keeps its length; the table and font
// checksums are brought up to date. It returns the font unchanged (and false)
// when there is nothing to repair or the file is not a plain TrueType/OpenType
// font it can read safely. WOFF and WOFF2 are compressed and left alone.
func Repair(font []byte) ([]byte, bool) {
	tables := sfntTables(font)
	maxp, ok := tables["maxp"]
	if !ok || maxp.length < 6 {
		return font, false
	}
	numGlyphs := int(binary.BigEndian.Uint16(font[maxp.offset+4:]))

	cmapFixes := closingSegmentFixes(font, tables, numGlyphs)
	post, hasPost := tables["post"]
	postFix := hasPost && postNamesBroken(font[post.offset:post.offset+post.length], numGlyphs)
	if len(cmapFixes) == 0 && !postFix {
		return font, false
	}

	out := append([]byte(nil), font...)
	for _, at := range cmapFixes {
		binary.BigEndian.PutUint16(out[at:], 1)
	}
	if len(cmapFixes) > 0 {
		c := tables["cmap"]
		binary.BigEndian.PutUint32(out[c.record+4:], checksum(out[c.offset:c.offset+c.length]))
	}
	if postFix {
		binary.BigEndian.PutUint32(out[post.offset:], 0x00030000)
		binary.BigEndian.PutUint32(out[post.record+4:], checksum(out[post.offset:post.offset+post.length]))
	}
	if head, ok := tables["head"]; ok && head.length >= 12 {
		binary.BigEndian.PutUint32(out[head.offset+8:], 0)
		binary.BigEndian.PutUint32(out[head.offset+8:], 0xB1B0AFBA-checksum(out))
	}
	return out, true
}

// closingSegmentFixes finds the idDelta entries of 0xFFFF segments that map
// past the last glyph, across the font's format 4 character maps.
func closingSegmentFixes(font []byte, tables map[string]sfntTable, numGlyphs int) []int {
	cmap, ok := tables["cmap"]
	if !ok || cmap.length < 4 {
		return nil
	}
	c := font[cmap.offset : cmap.offset+cmap.length]
	var fixes []int
	seen := map[int]bool{}
	n := int(binary.BigEndian.Uint16(c[2:]))
	for i := 0; i < n; i++ {
		rec := 4 + 8*i
		if rec+8 > len(c) {
			return nil
		}
		sub := int(binary.BigEndian.Uint32(c[rec+4:]))
		if seen[sub] || sub+14 > len(c) || binary.BigEndian.Uint16(c[sub:]) != 4 {
			continue
		}
		seen[sub] = true
		segX2 := int(binary.BigEndian.Uint16(c[sub+6:]))
		ends := sub + 14
		starts := ends + segX2 + 2
		deltas := starts + segX2
		ranges := deltas + segX2
		if segX2 == 0 || segX2%2 != 0 || ranges+segX2 > len(c) {
			continue
		}
		for k := 0; k < segX2/2; k++ {
			end := binary.BigEndian.Uint16(c[ends+2*k:])
			start := binary.BigEndian.Uint16(c[starts+2*k:])
			delta := binary.BigEndian.Uint16(c[deltas+2*k:])
			rangeOff := binary.BigEndian.Uint16(c[ranges+2*k:])
			if start == 0xFFFF && end == 0xFFFF && rangeOff == 0 && int(0xFFFF+uint32(delta))&0xFFFF >= numGlyphs {
				fixes = append(fixes, cmap.offset+deltas+2*k)
			}
		}
	}
	return fixes
}

// postNamesBroken tells whether a version 2 glyph name table cannot be read:
// another glyph count than the font's, an index past its strings, or strings
// running past its end. Other versions carry no names and are left alone.
func postNamesBroken(p []byte, numGlyphs int) bool {
	if len(p) < 32 || binary.BigEndian.Uint32(p) != 0x00020000 {
		return false
	}
	if len(p) < 34 || int(binary.BigEndian.Uint16(p[32:])) != numGlyphs {
		return true
	}
	idx := 34
	names := idx + 2*numGlyphs
	if names > len(p) {
		return true
	}
	strings := 0
	for at := names; at < len(p); strings++ {
		at += 1 + int(p[at])
		if at > len(p) {
			return true
		}
	}
	for g := 0; g < numGlyphs; g++ {
		i := int(binary.BigEndian.Uint16(p[idx+2*g:]))
		if i >= 258 && i-258 >= strings {
			return true
		}
	}
	return false
}

type sfntTable struct{ record, offset, length int }

// sfntTables lists the tables of a TrueType/OpenType file; empty when the
// file is something else or a table lies outside it.
func sfntTables(font []byte) map[string]sfntTable {
	if len(font) < 12 {
		return nil
	}
	switch binary.BigEndian.Uint32(font) {
	case 0x00010000, 0x4F54544F /* OTTO */, 0x74727565 /* true */ :
	default:
		return nil
	}
	n := int(binary.BigEndian.Uint16(font[4:]))
	out := make(map[string]sfntTable, n)
	for i := 0; i < n; i++ {
		rec := 12 + 16*i
		if rec+16 > len(font) {
			return nil
		}
		off := int(binary.BigEndian.Uint32(font[rec+8:]))
		length := int(binary.BigEndian.Uint32(font[rec+12:]))
		if off < 0 || length < 0 || off+length > len(font) {
			return nil
		}
		out[string(font[rec:rec+4])] = sfntTable{record: rec, offset: off, length: length}
	}
	return out
}

// checksum is the OpenType table checksum: the sum of big-endian uint32
// words, the last one padded with zeros.
func checksum(b []byte) uint32 {
	var sum uint32
	for i := 0; i < len(b); i += 4 {
		var w [4]byte
		copy(w[:], b[i:])
		sum += binary.BigEndian.Uint32(w[:])
	}
	return sum
}
