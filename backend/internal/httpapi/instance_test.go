package httpapi

import (
	"strings"
	"testing"
)

func TestInstanceInjection(t *testing.T) {
	page := []byte(`<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="theme-color" content="#597767"/></head><body></body></html>`)
	if got := injectInstance(page, Instance{}); string(got) != string(page) {
		t.Fatal("inactive instance must not change the page")
	}
	out := string(injectInstance(page, Instance{Name: `Home <Lab>`, Accent: "#3366CC", Locale: "en-GB"}))
	if !strings.Contains(out, `<head><script>window.__HC_INSTANCE__={"locale":"en-GB","name":"Home \u003cLab\u003e"};</script><style>html:root{`) {
		t.Fatalf("snippet not right after <head> or not escaped:\n%s", out)
	}
	if !strings.Contains(out, "--color-brand-600:#3366CC;") || !strings.Contains(out, `content="#3366CC"`) {
		t.Fatalf("accent not applied:\n%s", out)
	}
	if strings.Contains(out, "<Lab>") {
		t.Fatal("name must be escaped in the script")
	}
}

func TestInstanceFromEnvValidates(t *testing.T) {
	t.Setenv("INSTANCE_NAME", "Canvas")
	t.Setenv("INSTANCE_ACCENT", "red")
	t.Setenv("INSTANCE_LOCALE", "de-DE")
	inst, problems := InstanceFromEnv()
	if inst.Name != "Canvas" || inst.Accent != "" || inst.Locale != "de-DE" || len(problems) != 1 {
		t.Fatalf("got %+v %v", inst, problems)
	}
}

func TestFaviconRecolor(t *testing.T) {
	svg := []byte(`<stop stop-color="#2444AE"/><stop stop-color="#2F55D4"/>`)
	out := string(faviconColors(svg, Instance{Accent: "#3366CC"}))
	if strings.Contains(out, "#2F55D4") || !strings.Contains(out, "#3366CC") {
		t.Fatalf("favicon not recolored: %s", out)
	}
}

func TestInstanceTitle(t *testing.T) {
	page := []byte(`<html><head><title>Sign in · danvas</title></head><body>danvas</body></html>`)
	out := string(injectInstance(page, Instance{Name: "A&B"}))
	if !strings.Contains(out, "<title>Sign in · A&amp;B</title>") || !strings.Contains(out, "<body>danvas</body>") {
		t.Fatalf("title not renamed (or body touched): %s", out)
	}
}
