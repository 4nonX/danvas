package outputcheck

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

// A one-page PDF, 100 x 100 pt: the left half 100 % cyan, the right half a
// four-colour 340 % black, and a 1 pt line in the spot colour "Stanze".
func testPDF() []byte {
	content := "1 0 0 0 k 0 0 50 100 re f\n0.8 0.7 0.6 0.94 k 50 0 50 100 re f\n/CS0 CS 1 SCN 1 w 10 10 m 90 10 l S\n"
	objs := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ColorSpace << /CS0 [/Separation /Stanze /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [0 1 0 0] /N 1 >>] >> >> /Contents 4 0 R >>",
		fmt.Sprintf("<< /Length %d >>\nstream\n%sendstream", len(content), content),
	}
	var b strings.Builder
	b.WriteString("%PDF-1.4\n")
	offsets := make([]int, len(objs))
	for i, o := range objs {
		offsets[i] = b.Len()
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", i+1, o)
	}
	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(objs)+1)
	for _, off := range offsets {
		fmt.Fprintf(&b, "%010d 00000 n \n", off)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objs)+1, xref)
	return []byte(b.String())
}

func TestSeparatesAndMeasuresAFile(t *testing.T) {
	c := New("")
	if !c.Available() {
		t.Skip("ghostscript not installed")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	res, err := c.Check(ctx, testPDF(), 300)
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if len(res.Pages) != 1 || res.Truncated {
		t.Fatalf("pages %+v", res)
	}
	p := res.Pages[0]
	if p.WidthMm < 35 || p.WidthMm > 36 {
		t.Fatalf("width %v mm, want about 35.3", p.WidthMm)
	}
	names := []string{}
	cov := map[string]float64{}
	for _, pl := range p.Plates {
		names = append(names, pl.Name)
		cov[pl.Name] = pl.CoveragePct
		if !strings.HasPrefix(pl.PNG, "data:image/png;base64,") {
			t.Fatalf("plate %s has no picture", pl.Name)
		}
	}
	if strings.Join(names, ",") != "Cyan,Magenta,Yellow,Black,Stanze" {
		t.Fatalf("plates %v", names)
	}
	// Cyan: half the page at 100 % plus half at 80 %.
	if cov["Cyan"] < 85 || cov["Cyan"] > 95 {
		t.Fatalf("cyan coverage %v", cov["Cyan"])
	}
	if cov["Stanze"] <= 0 || cov["Stanze"] > 5 {
		t.Fatalf("spot coverage %v", cov["Stanze"])
	}
	// The four-colour black is 314 %: above 300 on half the page.
	if p.TacMaxPct < 300 || p.TacMaxPct > 330 {
		t.Fatalf("tac max %v", p.TacMaxPct)
	}
	if p.TacOverPct < 45 || p.TacOverPct > 55 {
		t.Fatalf("tac over %v", p.TacOverPct)
	}
	if res2, _ := c.Check(ctx, testPDF(), 350); res2.Pages[0].TacOverPct != 0 {
		t.Fatalf("over a 350 limit: %v", res2.Pages[0].TacOverPct)
	}
}

func TestRejectsWhatIsNotAPrintFile(t *testing.T) {
	c := New("")
	if !c.Available() {
		t.Skip("ghostscript not installed")
	}
	if _, err := c.Check(context.Background(), []byte("hello"), 300); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("got %v", err)
	}
	if _, err := c.Check(context.Background(), []byte("%PDF-1.4\nnot really"), 300); !errors.Is(err, ErrFailed) {
		t.Fatalf("broken pdf: %v", err)
	}
}

func TestUnavailableWithoutGhostscript(t *testing.T) {
	c := New("/nonexistent/gs")
	if _, err := c.Check(context.Background(), testPDF(), 300); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("got %v", err)
	}
}
