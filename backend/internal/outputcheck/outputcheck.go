// Package outputcheck separates an exported print file (PDF or EPS) the way a
// print shop's RIP does, with Ghostscript's tiffsep device, and reports per
// page: every plate (the four process inks and each spot colour) with its
// ink coverage and a small picture of it, the total ink coverage (TAC)
// against a limit, and where it exceeds it. It checks the file that goes
// out, so overprint, black on the black plate alone and spot colours come
// out exactly as printed.
//
// The file comes from a signed-in user's own export and is processed on the
// instance; nothing leaves it. Ghostscript runs with -dSAFER in a temporary
// directory, with page, size and time limits.
package outputcheck

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"golang.org/x/image/draw"
	"golang.org/x/image/tiff"
)

var (
	// ErrUnavailable: Ghostscript is not installed on this instance.
	ErrUnavailable = errors.New("ghostscript not available")
	// ErrUnsupported: not a PDF or EPS file.
	ErrUnsupported = errors.New("not a PDF or EPS file")
	// ErrFailed: Ghostscript could not render the file.
	ErrFailed = errors.New("the file could not be separated")
)

const (
	// MaxBytes is the largest file accepted.
	MaxBytes = 200 << 20
	// MaxPages are separated; a longer file is checked up to there.
	MaxPages = 20
	// Resolution of the separation, dpi: enough for coverage and a preview.
	Resolution = 100
	// PreviewSide is the longest side of a plate picture, pixels.
	PreviewSide = 900
)

// Plate is one separation of a page.
type Plate struct {
	Name string `json:"name"`
	// Process: one of Cyan, Magenta, Yellow, Black (else a spot colour).
	Process bool `json:"process"`
	// CoveragePct is the plate's mean ink over the page, per cent.
	CoveragePct float64 `json:"coveragePct"`
	// PNG is a grey picture of the plate (ink dark), a data URL.
	PNG string `json:"png"`
}

// Page is one separated page.
type Page struct {
	Page     int     `json:"page"`
	WidthMm  float64 `json:"widthMm"`
	HeightMm float64 `json:"heightMm"`
	Plates   []Plate `json:"plates"`
	// TacMaxPct is the highest total of the four process inks, per cent.
	TacMaxPct int `json:"tacMaxPct"`
	// TacOverPct is the share of the inked area above the limit, per cent.
	TacOverPct float64 `json:"tacOverPct"`
	// Over marks the pixels above the limit (red on transparent), a data
	// URL the size of the plate pictures.
	Over string `json:"over"`
}

// Result is the whole check.
type Result struct {
	Pages      []Page `json:"pages"`
	TacLimit   int    `json:"tacLimit"`
	Resolution int    `json:"resolution"`
	// Truncated: the file has more than MaxPages pages.
	Truncated bool `json:"truncated"`
}

// Checker runs Ghostscript.
type Checker struct{ gs string }

// New uses the Ghostscript binary at path ("" finds "gs" on PATH).
func New(path string) *Checker {
	if strings.TrimSpace(path) == "" {
		path = "gs"
	}
	return &Checker{gs: path}
}

// Available reports whether Ghostscript can be run.
func (c *Checker) Available() bool {
	_, err := exec.LookPath(c.gs)
	return err == nil
}

// kindOf tells PDF from EPS by the file's signature.
func kindOf(data []byte) (string, error) {
	switch {
	case bytes.HasPrefix(data, []byte("%PDF-")):
		return "pdf", nil
	case bytes.HasPrefix(data, []byte("%!PS")), bytes.HasPrefix(data, []byte{0xC5, 0xD0, 0xD3, 0xC6}):
		return "eps", nil
	}
	return "", ErrUnsupported
}

var plateFile = regexp.MustCompile(`^p(\d{3})\((.+)\)\.tif$`)

var processNames = map[string]int{"Cyan": 0, "Magenta": 1, "Yellow": 2, "Black": 3}

// Check separates the file and measures it against tacLimit (per cent).
func (c *Checker) Check(ctx context.Context, data []byte, tacLimit int) (Result, error) {
	if !c.Available() {
		return Result{}, ErrUnavailable
	}
	if len(data) > MaxBytes {
		return Result{}, ErrUnsupported
	}
	kind, err := kindOf(data)
	if err != nil {
		return Result{}, err
	}
	if tacLimit < 100 || tacLimit > 400 {
		tacLimit = 300
	}
	dir, err := os.MkdirTemp("", "outputcheck-")
	if err != nil {
		return Result{}, err
	}
	defer os.RemoveAll(dir)
	in := filepath.Join(dir, "input."+kind)
	if err := os.WriteFile(in, data, 0o600); err != nil {
		return Result{}, err
	}
	out := filepath.Join(dir, "out")
	if err := os.Mkdir(out, 0o700); err != nil {
		return Result{}, err
	}
	args := []string{
		"-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-dNOPROMPT", "-dNOPLATFONTS",
		"-sDEVICE=tiffsep", "-sCompression=none", fmt.Sprintf("-r%d", Resolution),
		// One page past the limit, to know whether there are more.
		"-dFirstPage=1", fmt.Sprintf("-dLastPage=%d", MaxPages+1),
	}
	if kind == "eps" {
		args = append(args, "-dEPSCrop")
	}
	args = append(args, "-sOutputFile="+filepath.Join(out, "p%03d.tif"), in)
	cmd := exec.CommandContext(ctx, c.gs, args...)
	cmd.Dir = dir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return Result{}, fmt.Errorf("%w: %v", ErrFailed, strings.TrimSpace(firstLine(stderr.String())))
	}
	return analyse(out, tacLimit)
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}

type plateFileRef struct {
	page int
	name string
	path string
}

// analyse reads the plates tiffsep wrote into dir.
func analyse(dir string, tacLimit int) (Result, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return Result{}, err
	}
	byPage := map[int][]plateFileRef{}
	for _, e := range entries {
		m := plateFile.FindStringSubmatch(e.Name())
		if m == nil {
			continue // the CMYK composite p001.tif
		}
		page, _ := strconv.Atoi(m[1])
		name, err := url.PathUnescape(m[2]) // non-ASCII bytes arrive as %XX
		if err != nil {
			name = m[2]
		}
		byPage[page] = append(byPage[page], plateFileRef{page: page, name: name, path: filepath.Join(dir, e.Name())})
	}
	pages := make([]int, 0, len(byPage))
	for p := range byPage {
		pages = append(pages, p)
	}
	sort.Ints(pages)
	res := Result{TacLimit: tacLimit, Resolution: Resolution, Pages: []Page{}}
	if len(pages) > MaxPages {
		res.Truncated = true
		pages = pages[:MaxPages]
	}
	if len(pages) == 0 {
		return res, ErrFailed
	}
	for _, p := range pages {
		pg, err := analysePage(p, byPage[p], tacLimit)
		if err != nil {
			return res, err
		}
		res.Pages = append(res.Pages, pg)
	}
	return res, nil
}

func readGray(path string) (*image.Gray, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	img, err := tiff.Decode(f)
	if err != nil {
		return nil, err
	}
	if g, ok := img.(*image.Gray); ok {
		return g, nil
	}
	b := img.Bounds()
	g := image.NewGray(b)
	draw.Draw(g, b, img, b.Min, draw.Src)
	return g, nil
}

func analysePage(page int, refs []plateFileRef, tacLimit int) (Page, error) {
	// Process plates first, in press order, then the spot colours by name.
	sort.Slice(refs, func(i, j int) bool {
		pi, iok := processNames[refs[i].name]
		pj, jok := processNames[refs[j].name]
		switch {
		case iok && jok:
			return pi < pj
		case iok != jok:
			return iok
		}
		return refs[i].name < refs[j].name
	})
	out := Page{Page: page, Plates: []Plate{}}
	var process [4]*image.Gray
	var w, h int
	for _, r := range refs {
		g, err := readGray(r.path)
		if err != nil {
			return out, fmt.Errorf("%w: %v", ErrFailed, err)
		}
		b := g.Bounds()
		w, h = b.Dx(), b.Dy()
		// tiffsep plates: 255 is no ink, 0 is full ink.
		var sum float64
		for _, v := range g.Pix {
			sum += float64(255 - v)
		}
		cov := 0.0
		if len(g.Pix) > 0 {
			cov = math.Round(sum/float64(len(g.Pix))/255*1000) / 10
		}
		idx, isProcess := processNames[r.name]
		if isProcess {
			process[idx] = g
		}
		pic, err := pngDataURL(scaled(g))
		if err != nil {
			return out, err
		}
		out.Plates = append(out.Plates, Plate{Name: r.name, Process: isProcess, CoveragePct: cov, PNG: pic})
	}
	out.WidthMm = math.Round(float64(w)/Resolution*25.4*10) / 10
	out.HeightMm = math.Round(float64(h)/Resolution*25.4*10) / 10
	maxPct, overPct, over := tac(process, w, h, tacLimit)
	out.TacMaxPct, out.TacOverPct = maxPct, overPct
	pic, err := pngDataURL(scaledMask(over))
	if err != nil {
		return out, err
	}
	out.Over = pic
	return out, nil
}

// tac sums the four process inks per pixel.
func tac(plates [4]*image.Gray, w, h, limitPct int) (int, float64, *image.Alpha) {
	over := image.NewAlpha(image.Rect(0, 0, w, h))
	limit := float64(limitPct) / 100 * 255
	maxSum, inked, above := 0, 0, 0
	for i := 0; i < w*h; i++ {
		s := 0
		for _, g := range plates {
			if g != nil && i < len(g.Pix) {
				s += 255 - int(g.Pix[i])
			}
		}
		if s > maxSum {
			maxSum = s
		}
		if s > 0 {
			inked++
		}
		if float64(s) > limit+0.5 {
			above++
			over.Pix[i] = 255
		}
	}
	overPct := 0.0
	if inked > 0 {
		overPct = math.Round(float64(above)/float64(inked)*1000) / 10
	}
	return int(math.Round(float64(maxSum) / 255 * 100)), overPct, over
}

func previewSize(b image.Rectangle) image.Rectangle {
	w, h := b.Dx(), b.Dy()
	if w <= PreviewSide && h <= PreviewSide {
		return image.Rect(0, 0, w, h)
	}
	f := float64(PreviewSide) / math.Max(float64(w), float64(h))
	return image.Rect(0, 0, int(math.Max(1, math.Round(float64(w)*f))), int(math.Max(1, math.Round(float64(h)*f))))
}

func scaled(g *image.Gray) image.Image {
	r := previewSize(g.Bounds())
	if r.Dx() == g.Bounds().Dx() {
		return g
	}
	dst := image.NewGray(r)
	draw.ApproxBiLinear.Scale(dst, r, g, g.Bounds(), draw.Src, nil)
	return dst
}

// scaledMask turns the over-limit pixels into red on transparent, at the
// plate pictures' size (any marked pixel keeps its preview pixel red).
func scaledMask(a *image.Alpha) image.Image {
	r := previewSize(a.Bounds())
	dst := image.NewNRGBA(r)
	sx := float64(a.Bounds().Dx()) / float64(r.Dx())
	sy := float64(a.Bounds().Dy()) / float64(r.Dy())
	red := color.NRGBA{R: 230, G: 30, B: 40, A: 255}
	for y := 0; y < a.Bounds().Dy(); y++ {
		for x := 0; x < a.Bounds().Dx(); x++ {
			if a.Pix[y*a.Stride+x] != 0 {
				dst.SetNRGBA(int(float64(x)/sx), int(float64(y)/sy), red)
			}
		}
	}
	return dst
}

func pngDataURL(img image.Image) (string, error) {
	var buf bytes.Buffer
	enc := png.Encoder{CompressionLevel: png.BestSpeed}
	if err := enc.Encode(&buf, img); err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}
