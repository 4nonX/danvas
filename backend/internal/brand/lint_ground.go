package brand

import "math"

// What lies behind a text, for the contrast check: the elements of a page in
// paint order with their boxes on the page, so a text is measured against
// the topmost element under it (a coloured panel), not the page background.
// An element whose look cannot be reduced to one colour (an image, a
// gradient, something translucent) makes the ground unknown, and the check
// leaves that text alone rather than guess.

// affine is a 2D transform: x' = a*x + c*y + e, y' = b*x + d*y + f.
type affine struct{ a, b, c, d, e, f float64 }

var identity = affine{1, 0, 0, 1, 0, 0}

func (m affine) mul(n affine) affine {
	return affine{
		a: m.a*n.a + m.c*n.b, b: m.b*n.a + m.d*n.b,
		c: m.a*n.c + m.c*n.d, d: m.b*n.c + m.d*n.d,
		e: m.a*n.e + m.c*n.f + m.e, f: m.b*n.e + m.d*n.f + m.f,
	}
}

func (m affine) apply(x, y float64) (float64, float64) {
	return m.a*x + m.c*y + m.e, m.b*x + m.d*y + m.f
}

// local is a node's transform: translate to (x, y), rotate clockwise by
// rotation degrees about that origin, then scale.
func local(t map[string]any) affine {
	if t == nil {
		return identity
	}
	r := numAt(t, "rotation") * math.Pi / 180
	sx, sy := scaleOr1(t, "scaleX"), scaleOr1(t, "scaleY")
	cos, sin := math.Cos(r), math.Sin(r)
	return affine{a: cos * sx, b: sin * sx, c: -sin * sy, d: cos * sy, e: numAt(t, "x"), f: numAt(t, "y")}
}

type box struct{ x0, y0, x1, y1 float64 }

func (b box) contains(x, y float64) bool { return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 }

// bounds is the page box of a node's own rectangle (0,0)-(w,h) under m.
func bounds(m affine, n map[string]any) box {
	sz := asObjMap(n["size"])
	w, h := numAt(sz, "width"), numAt(sz, "height")
	b := box{math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)}
	for _, p := range [][2]float64{{0, 0}, {w, 0}, {0, h}, {w, h}} {
		x, y := m.apply(p[0], p[1])
		b.x0, b.y0, b.x1, b.y1 = math.Min(b.x0, x), math.Min(b.y0, y), math.Max(b.x1, x), math.Max(b.y1, y)
	}
	return b
}

// layer is one painted element: where it is, and its colour when it is one
// opaque solid colour (known false: an image, a gradient, translucency).
type layer struct {
	box   box
	color rgb
	known bool
	text  map[string]any // set for a text node
}

func nodeOpacity(n map[string]any) float64 {
	if v, ok := n["opacity"].(float64); ok {
		return v
	}
	return 1
}

// solidGround returns a node's one opaque solid fill colour. paints is false
// for a node that paints nothing (no fills, all hidden), so what is under it
// shows through.
func solidGround(n map[string]any) (c rgb, ok bool, paints bool) {
	var visible []map[string]any
	for _, f := range asArrAny(n["fills"]) {
		fm := asObjMap(f)
		if fm == nil || fm["visible"] == false {
			continue
		}
		visible = append(visible, fm)
	}
	if len(visible) == 0 {
		return rgb{}, false, false
	}
	top := visible[len(visible)-1]
	if top["type"] != "solid" {
		return rgb{}, false, true
	}
	col := asObjMap(top["color"])
	if a, ok := asObjMap(col["srgb"])["a"].(float64); ok && a < 0.99 {
		return rgb{}, false, true
	}
	if o, ok := top["opacity"].(float64); ok && o < 0.99 {
		return rgb{}, false, true
	}
	c, ok = srgbOf(col)
	return c, ok, true
}

// paintOrder lists a page's elements bottom to top with their page boxes.
func paintOrder(nodes []any, parent affine, out *[]layer) {
	for _, raw := range nodes {
		n := asObjMap(raw)
		if n == nil || n["visible"] == false {
			continue
		}
		m := parent.mul(local(asObjMap(n["transform"])))
		switch n["type"] {
		case "group":
			if nodeOpacity(n) < 0.99 {
				// Its children blend with what is under them: unknown ground.
				*out = append(*out, layer{box: bounds(m, n)})
				continue
			}
			paintOrder(asArrAny(n["children"]), m, out)
		case "text":
			*out = append(*out, layer{box: bounds(m, n), text: n})
		case "shape", "path", "frame":
			c, ok, paints := solidGround(n)
			if paints {
				// Only an upright rectangle covers its whole box; a path (a
				// leaf pattern), an ellipse or a turned shape may leave its
				// box partly open, so the ground there is not known.
				rect := n["type"] == "frame" || (n["type"] == "shape" && (n["shape"] == nil || n["shape"] == "rect"))
				// Upright on the page: its parents' turns count too (a quarter
				// turn keeps the box exact).
				upright := (math.Abs(m.b) < 1e-6 && math.Abs(m.c) < 1e-6) || (math.Abs(m.a) < 1e-6 && math.Abs(m.d) < 1e-6)
				*out = append(*out, layer{box: bounds(m, n), color: c, known: ok && rect && upright && nodeOpacity(n) >= 0.99})
			}
			if n["type"] == "frame" {
				paintOrder(asArrAny(n["children"]), m, out)
			}
		default:
			// Images, video and anything else paint something we cannot
			// reduce to one colour.
			*out = append(*out, layer{box: bounds(m, n)})
		}
	}
}

// textGrounds returns, for each text node of a page (by its id), the colour
// behind its centre, or no entry when that is not one known colour.
func textGrounds(page map[string]any) map[string]rgb {
	var layers []layer
	paintOrder(asArrAny(page["children"]), identity, &layers)
	pageBg, hasBg := pageBackground(page)
	if !hasBg {
		pageBg, hasBg = rgb{1, 1, 1}, true
	}
	out := map[string]rgb{}
	for i, l := range layers {
		if l.text == nil {
			continue
		}
		cx, cy := (l.box.x0+l.box.x1)/2, (l.box.y0+l.box.y1)/2
		ground, known := pageBg, hasBg
		for j := i - 1; j >= 0; j-- {
			under := layers[j]
			if under.text != nil || !under.box.contains(cx, cy) {
				continue
			}
			ground, known = under.color, under.known
			break
		}
		if known {
			out[strAt(l.text["id"])] = ground
		}
	}
	return out
}
