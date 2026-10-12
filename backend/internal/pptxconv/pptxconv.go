// Package pptxconv turns imported files into designs on the server, with the
// exact code the browser runs: @hc/export's PPTX importer and its page-images
// design are bundled into pptxconv.js (scripts/build-pptx-convert.mjs,
// committed) and executed in-process under goja. The server-side Canva import
// uses it, so a design imported there is the same file a browser import makes
// (the parity test proves it against a Node-generated fixture).
//
// The importers need a few platform APIs goja lacks; they are provided in Go:
// raw-deflate (with decompression limits enforced here, before any bytes
// reach the VM), UTF-8 decoding, base64 for embedded images (encoding a
// multi-megabyte picture in the interpreter took seconds) and random ids.
package pptxconv

import (
	"bytes"
	"compress/flate"
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	_ "image/gif"  // page images: register decoders for DecodeConfig
	_ "image/jpeg" //
	_ "image/png"  //
	"io"
	"strings"
	"sync"
	"time"

	"github.com/dop251/goja"
)

//go:embed pptxconv.js
var bundleJS string

var (
	progOnce sync.Once
	prog     *goja.Program
	progErr  error
)

// program compiles the embedded bundle once per process; each conversion
// then runs in a fresh, throwaway VM (goja VMs are not goroutine-safe).
func program() (*goja.Program, error) {
	progOnce.Do(func() {
		prog, progErr = goja.Compile("pptxconv.js", bundleJS, true)
	})
	return prog, progErr
}

// MaxInputBytes bounds one file handed to a conversion.
const MaxInputBytes = 256 << 20

// convertTimeout stops a conversion that will not finish. Real decks take
// well under a second; a 10 MB deck of photos about two seconds.
const convertTimeout = 2 * time.Minute

// maxEntryBytes / maxTotalBytes bound what one archive may inflate to. Lower
// than the browser's (512 MiB / 1 GiB): this runs inside the server, next to
// everyone else's work. Variables so the tests can exercise the limit.
var (
	maxEntryBytes = 256 << 20
	maxTotalBytes = 512 << 20
)

// ErrTooLarge is an input or archive over the limits.
var ErrTooLarge = errors.New("file too large to convert")

// PPTX converts a .pptx file into design file JSON (the open format), titled
// as given. Errors are the importer's own (a malformed or unsupported file),
// a limit, or the timeout.
func PPTX(ctx context.Context, data []byte, title string) ([]byte, error) {
	if len(data) > MaxInputBytes {
		return nil, ErrTooLarge
	}
	var out []byte
	err := run(ctx, func(vm *goja.Runtime) error {
		vm.Set("__bytes", vm.NewArrayBuffer(data))
		vm.Set("__title", title)
		if _, err := vm.RunString(`__pptxToDesign(new Uint8Array(__bytes), __title)`); err != nil {
			return err
		}
		// goja drains its job queue before RunString returns, so the
		// importer's promise chain (its awaits resolve synchronously here)
		// has settled by now.
		r := vm.Get("__result")
		if r == nil || goja.IsUndefined(r) {
			return errors.New("conversion did not complete")
		}
		o := r.ToObject(vm)
		if ok := o.Get("ok"); ok != nil && !goja.IsUndefined(ok) {
			out = []byte(ok.String())
			return nil
		}
		msg := o.Get("err").String()
		if strings.Contains(msg, ErrTooLarge.Error()) {
			return ErrTooLarge
		}
		return errors.New(msg)
	})
	return out, err
}

// Page is one exported page image.
type Page struct {
	Bytes []byte
	// MIME is the image's type; empty means image/png.
	MIME string
}

// ImagePages makes a design of full-bleed page images, one page per image at
// its own pixel size (how a design without a full PowerPoint export arrives).
func ImagePages(ctx context.Context, title string, pages []Page) ([]byte, error) {
	if len(pages) == 0 {
		return nil, errors.New("the export has no pages")
	}
	total := 0
	type sized struct {
		page Page
		w, h int
	}
	measured := make([]sized, 0, len(pages))
	for i, p := range pages {
		total += len(p.Bytes)
		if total > MaxInputBytes {
			return nil, ErrTooLarge
		}
		cfg, _, err := image.DecodeConfig(bytes.NewReader(p.Bytes))
		if err != nil {
			return nil, fmt.Errorf("page %d is not a readable image: %w", i+1, err)
		}
		measured = append(measured, sized{p, cfg.Width, cfg.Height})
	}
	var out []byte
	err := run(ctx, func(vm *goja.Runtime) error {
		arr := vm.NewArray()
		for i, m := range measured {
			obj := vm.NewObject()
			buf := vm.NewArrayBuffer(m.page.Bytes)
			u8, err := vm.New(vm.Get("Uint8Array"), vm.ToValue(buf))
			if err != nil {
				return err
			}
			_ = obj.Set("bytes", u8)
			_ = obj.Set("mime", m.page.MIME)
			_ = obj.Set("width", m.w)
			_ = obj.Set("height", m.h)
			_ = arr.Set(fmt.Sprint(i), obj)
		}
		vm.Set("__pages", arr)
		fn, ok := goja.AssertFunction(vm.Get("__imagePagesDesign"))
		if !ok {
			return errors.New("bundle has no __imagePagesDesign")
		}
		v, err := fn(goja.Undefined(), vm.ToValue(title))
		if err != nil {
			return err
		}
		out = []byte(v.String())
		return nil
	})
	return out, err
}

// run executes the bundle in a fresh VM with the host functions installed,
// then f, interrupting the VM when ctx ends or the timeout elapses.
func run(ctx context.Context, f func(vm *goja.Runtime) error) (err error) {
	p, err := program()
	if err != nil {
		return fmt.Errorf("compile converter bundle: %w", err)
	}
	vm := goja.New()
	inflated := 0
	install(vm, &inflated)

	ctx, cancel := context.WithTimeout(ctx, convertTimeout)
	defer cancel()
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			vm.Interrupt(ctx.Err())
		case <-done:
		}
	}()
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("converter failed: %v", r)
		}
	}()
	if _, err := vm.RunProgram(p); err != nil {
		return fmt.Errorf("load converter bundle: %w", err)
	}
	if err := f(vm); err != nil {
		var ie *goja.InterruptedError
		if errors.As(err, &ie) {
			return fmt.Errorf("conversion stopped: %w", ctx.Err())
		}
		if errors.Is(err, ErrTooLarge) {
			return ErrTooLarge
		}
		return err
	}
	return nil
}

// install puts the host functions the bundle's polyfill expects into vm.
func install(vm *goja.Runtime, inflated *int) {
	bytesOf := func(v goja.Value) []byte {
		switch x := v.Export().(type) {
		case []byte:
			return x
		case goja.ArrayBuffer:
			return x.Bytes()
		}
		o := v.ToObject(vm)
		buf, ok := o.Get("buffer").Export().(goja.ArrayBuffer)
		if !ok {
			panic(vm.NewTypeError("expected bytes"))
		}
		off := int(o.Get("byteOffset").ToInteger())
		n := int(o.Get("byteLength").ToInteger())
		return buf.Bytes()[off : off+n]
	}
	vm.Set("__goInflateRaw", func(c goja.FunctionCall) goja.Value {
		in := bytesOf(c.Argument(0))
		r := flate.NewReader(bytes.NewReader(in))
		defer r.Close()
		out, err := io.ReadAll(io.LimitReader(r, int64(maxEntryBytes)+1))
		if err != nil {
			panic(vm.NewGoError(fmt.Errorf("inflate: %w", err)))
		}
		*inflated += len(out)
		if len(out) > maxEntryBytes || *inflated > maxTotalBytes {
			panic(vm.NewGoError(ErrTooLarge))
		}
		return vm.ToValue(vm.NewArrayBuffer(out))
	})
	vm.Set("__goUtf8", func(c goja.FunctionCall) goja.Value {
		return vm.ToValue(string(bytesOf(c.Argument(0))))
	})
	vm.Set("__hostBytesToBase64", func(c goja.FunctionCall) goja.Value {
		return vm.ToValue(base64.StdEncoding.EncodeToString(bytesOf(c.Argument(0))))
	})
	vm.Set("__goRandomFill", func(c goja.FunctionCall) goja.Value {
		_, _ = rand.Read(bytesOf(c.Argument(0)))
		return goja.Undefined()
	})
	vm.Set("__goUUID", func(goja.FunctionCall) goja.Value {
		var u [16]byte
		_, _ = rand.Read(u[:])
		u[6] = u[6]&0x0f | 0x40
		u[8] = u[8]&0x3f | 0x80
		h := hex.EncodeToString(u[:])
		return vm.ToValue(h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:])
	})
}
