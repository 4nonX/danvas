package printprofiles

import (
	"encoding/binary"
	"errors"
	"fmt"
	"strings"
	"unicode/utf16"
)

// MaxProfileBytes bounds an uploaded profile; real CMYK output profiles are
// 0.5-4 MB.
const MaxProfileBytes = 16 << 20

// ErrNotPrintProfile: the file is not an ICC CMYK output profile.
var ErrNotPrintProfile = errors.New("not an ICC CMYK output profile")

// ErrIncompleteProfile: a CMYK output profile without every colour table
// danvas computes print values with. No value is ever derived another way,
// so such a profile is refused rather than used in part.
var ErrIncompleteProfile = errors.New("the profile lacks colour tables needed for exact print values")

// requiredTables are the tags print values are computed from, each with its
// ICC v4 floating-point alternative:
//   - B2A0, B2A1: into CMYK, perceptual and relative colorimetric (the two
//     intents the CMYK export offers);
//   - A2B1: out of CMYK, colorimetric: Lab values (absolute, with the media
//     white point) and the soft proof. Without it LittleCMS would fall back
//     to the perceptual table, which is no colorimetric value;
//   - A2B0: required by the ICC specification for every output profile;
//   - wtpt: the media white point, the base of absolute colorimetric Lab.
var requiredTables = [][2]string{{"A2B0", "D2B0"}, {"A2B1", "D2B1"}, {"B2A0", "B2D0"}, {"B2A1", "B2D1"}, {"wtpt", ""}}

// Header is what an upload is checked against and listed with.
type Header struct {
	ColorSpace  string // "CMYK"
	Version     string // "2.1", "4.3", ...
	Description string // the profile's own name (desc tag), may be empty
}

// ParseICC validates an ICC profile as a CMYK output (printer) profile with
// every colour table print values are computed from (requiredTables), and
// reads its version and description. Whether the tables compute is the
// client's job too (it builds every transform with LittleCMS before
// uploading); here the file must at least carry them.
func ParseICC(b []byte) (Header, error) {
	var h Header
	if len(b) < 132 || len(b) > MaxProfileBytes {
		return h, fmt.Errorf("%w: bad size", ErrNotPrintProfile)
	}
	if string(b[36:40]) != "acsp" {
		return h, fmt.Errorf("%w: missing ICC signature", ErrNotPrintProfile)
	}
	if size := binary.BigEndian.Uint32(b[0:4]); int(size) > len(b) || size < 132 {
		return h, fmt.Errorf("%w: truncated", ErrNotPrintProfile)
	}
	if string(b[12:16]) != "prtr" {
		return h, fmt.Errorf("%w: device class %q is not an output profile", ErrNotPrintProfile, strings.TrimSpace(string(b[12:16])))
	}
	if string(b[16:20]) != "CMYK" {
		return h, fmt.Errorf("%w: colour space %q is not CMYK", ErrNotPrintProfile, strings.TrimSpace(string(b[16:20])))
	}
	if pcs := string(b[20:24]); pcs != "Lab " && pcs != "XYZ " {
		return h, fmt.Errorf("%w: unknown connection space", ErrNotPrintProfile)
	}
	major := b[8]
	if major != 2 && major != 4 {
		return h, fmt.Errorf("%w: unsupported ICC version %d", ErrNotPrintProfile, major)
	}
	if missing := missingTables(b); len(missing) > 0 {
		return h, fmt.Errorf("%w: missing %s", ErrIncompleteProfile, strings.Join(missing, ", "))
	}
	h.ColorSpace = "CMYK"
	h.Version = fmt.Sprintf("%d.%d", major, b[9]>>4)
	h.Description = description(b)
	return h, nil
}

// missingTables lists the required tables the tag table lacks (a tag counts
// only when its data lies inside the file).
func missingTables(b []byte) []string {
	have := map[string]bool{}
	n := int(binary.BigEndian.Uint32(b[128:132]))
	for i := 0; i < n && 132+12*i+12 <= len(b); i++ {
		e := b[132+12*i:]
		off := int(binary.BigEndian.Uint32(e[4:8]))
		ln := int(binary.BigEndian.Uint32(e[8:12]))
		if off >= 0 && ln > 0 && off+ln <= len(b) {
			have[string(e[0:4])] = true
		}
	}
	var missing []string
	for _, t := range requiredTables {
		if !have[t[0]] && (t[1] == "" || !have[t[1]]) {
			missing = append(missing, t[0])
		}
	}
	return missing
}

// description reads the desc tag (v2 textDescriptionType or v4 mluc).
func description(b []byte) string {
	n := int(binary.BigEndian.Uint32(b[128:132]))
	for i := 0; i < n && 132+12*i+12 <= len(b); i++ {
		e := b[132+12*i:]
		if string(e[0:4]) != "desc" {
			continue
		}
		off := int(binary.BigEndian.Uint32(e[4:8]))
		ln := int(binary.BigEndian.Uint32(e[8:12]))
		if off < 0 || ln < 12 || off+ln > len(b) {
			return ""
		}
		t := b[off : off+ln]
		switch string(t[0:4]) {
		case "desc":
			cnt := int(binary.BigEndian.Uint32(t[8:12]))
			if 12+cnt > len(t) {
				return ""
			}
			return clean(string(t[12 : 12+cnt]))
		case "mluc":
			if len(t) < 28 {
				return ""
			}
			l := int(binary.BigEndian.Uint32(t[20:24]))
			o := int(binary.BigEndian.Uint32(t[24:28]))
			if o+l > len(t) || l%2 != 0 {
				return ""
			}
			u := make([]uint16, l/2)
			for k := range u {
				u[k] = binary.BigEndian.Uint16(t[o+2*k:])
			}
			return clean(string(utf16.Decode(u)))
		}
	}
	return ""
}

func clean(s string) string {
	return strings.TrimSpace(strings.TrimRight(s, "\x00"))
}
