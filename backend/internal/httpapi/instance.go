package httpapi

import (
	"encoding/json"
	"fmt"
	"html"
	"os"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Instance is the per-installation identity an operator can set without
// rebuilding: the app name shown in the logo and page titles, the accent
// color of the app chrome, and the interface language for users who have not
// picked one. All optional; unset fields keep what the build carries.
//
// It is applied at serve time, like the analytics id: HTML pages get a small
// script (name, language) and a <style> that overrides the brand tokens, the
// theme-color meta follows the accent, and so does the SVG favicon.
type Instance struct {
	Name   string // INSTANCE_NAME (replaces "danvas"), at most 60 characters
	Accent string // INSTANCE_ACCENT, "#rrggbb": the main interactive color (brand-600)
	Locale string // INSTANCE_LOCALE, a BCP 47 tag such as "de" or "en-GB"
}

var (
	instanceAccentRe = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
	localeRe         = regexp.MustCompile(`^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$`)
	titleRe          = regexp.MustCompile(`<title>[^<]*</title>`)
	themeMeta        = regexp.MustCompile(`(<meta name="theme-color" content=")[^"]*(")`)
)

// InstanceFromEnv reads and validates the INSTANCE_* settings. An invalid
// value is dropped (with the reason returned), never served.
func InstanceFromEnv() (Instance, []string) {
	var inst Instance
	var problems []string
	if v := strings.TrimSpace(os.Getenv("INSTANCE_NAME")); v != "" {
		if utf8.RuneCountInString(v) > 60 {
			problems = append(problems, "INSTANCE_NAME longer than 60 characters; ignored")
		} else {
			inst.Name = v
		}
	}
	if v := strings.TrimSpace(os.Getenv("INSTANCE_ACCENT")); v != "" {
		if instanceAccentRe.MatchString(v) {
			inst.Accent = strings.ToUpper(v)
		} else {
			problems = append(problems, "INSTANCE_ACCENT must look like #20603D; ignored")
		}
	}
	if v := strings.TrimSpace(os.Getenv("INSTANCE_LOCALE")); v != "" {
		if localeRe.MatchString(v) {
			inst.Locale = v
		} else {
			problems = append(problems, "INSTANCE_LOCALE must be a language tag such as de or en-GB; ignored")
		}
	}
	return inst, problems
}

func (i Instance) active() bool { return i.Name != "" || i.Accent != "" || i.Locale != "" }

type rgb struct{ r, g, b float64 }

func parseHex(h string) rgb {
	v, _ := strconv.ParseUint(strings.TrimPrefix(h, "#"), 16, 32)
	return rgb{float64(v >> 16 & 255), float64(v >> 8 & 255), float64(v & 255)}
}

func (c rgb) mix(o rgb, t float64) rgb {
	return rgb{c.r + (o.r-c.r)*t, c.g + (o.g-c.g)*t, c.b + (o.b-c.b)*t}
}

func (c rgb) hex() string {
	clamp := func(v float64) int {
		if v < 0 {
			return 0
		}
		if v > 255 {
			return 255
		}
		return int(v + 0.5)
	}
	return fmt.Sprintf("#%02X%02X%02X", clamp(c.r), clamp(c.g), clamp(c.b))
}

// scale derives the 50..950 steps from the accent as step 600: lighter steps
// mix toward white, darker ones toward black.
func scale(accent string) map[string]string {
	c := parseHex(accent)
	white, black := rgb{255, 255, 255}, rgb{0, 0, 0}
	return map[string]string{
		"50": c.mix(white, 0.92).hex(), "100": c.mix(white, 0.84).hex(), "200": c.mix(white, 0.68).hex(),
		"300": c.mix(white, 0.50).hex(), "400": c.mix(white, 0.30).hex(), "500": c.mix(white, 0.14).hex(),
		"600": c.hex(), "700": c.mix(black, 0.22).hex(), "800": c.mix(black, 0.38).hex(),
		"900": c.mix(black, 0.52).hex(), "950": c.mix(black, 0.68).hex(),
	}
}

var steps = []string{"50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"}

// headSnippet is inserted right after <head>: before the locale boot script
// (which reads the language) and before the stylesheets. The style selectors
// are more specific than the stylesheet's own (:root, .dark, .light), so the
// override wins wherever it is placed.
func (i Instance) headSnippet() string {
	var b strings.Builder
	cfg := map[string]string{}
	if i.Name != "" {
		cfg["name"] = i.Name
	}
	if i.Locale != "" {
		cfg["locale"] = i.Locale
	}
	if len(cfg) > 0 {
		js, _ := json.Marshal(cfg) // escapes <, > and & for a script context
		b.WriteString(`<script>window.__HC_INSTANCE__=` + string(js) + `;</script>`)
	}
	if i.Accent != "" {
		s := scale(i.Accent)
		dark := parseHex("#111114")
		c := parseHex(i.Accent)
		b.WriteString(`<style>html:root{`)
		for _, k := range steps {
			b.WriteString("--color-brand-" + k + ":" + s[k] + ";--color-accent-" + k + ":" + s[k] + ";")
		}
		b.WriteString("--oc-brand-start:" + s["700"] + ";--oc-brand-end:" + s["400"] + ";--color-brand-ink:" + s["700"] + ";}")
		b.WriteString("html.dark:root{--color-brand-ink:" + s["300"] +
			";--color-brand-50:" + dark.mix(c, 0.15).hex() + ";--color-brand-100:" + dark.mix(c, 0.22).hex() + ";--color-brand-200:" + dark.mix(c, 0.32).hex() + ";}")
		b.WriteString("html .light{--color-brand-ink:" + s["700"] + ";}</style>")
	}
	return b.String()
}

// injectInstance applies the instance identity to an HTML page.
func injectInstance(html []byte, i Instance) []byte {
	if !i.active() {
		return html
	}
	s := string(html)
	if i.Name != "" {
		s = titleRe.ReplaceAllStringFunc(s, func(t string) string { return strings.ReplaceAll(t, "danvas", htmlEscape(i.Name)) })
	}
	if i.Accent != "" {
		s = themeMeta.ReplaceAllString(s, "${1}"+i.Accent+"${2}")
	}
	lower := strings.ToLower(s)
	at := strings.Index(lower, "<head")
	if at < 0 {
		return []byte(s)
	}
	end := strings.IndexByte(s[at:], '>')
	if end < 0 {
		return []byte(s)
	}
	cut := at + end + 1
	return []byte(s[:cut] + i.headSnippet() + s[cut:])
}

// faviconColors recolors the SVG favicon's tile gradient and mark to the
// accent (the build's default colors are replaced; anything else is left alone).
func faviconColors(svg []byte, i Instance) []byte {
	if i.Accent == "" {
		return svg
	}
	s := scale(i.Accent)
	return []byte(strings.NewReplacer(
		"#2444AE", s["700"], "#2F55D4", s["600"], "#3FA9E0", s["400"],
	).Replace(string(svg)))
}

func htmlEscape(s string) string { return html.EscapeString(s) }
