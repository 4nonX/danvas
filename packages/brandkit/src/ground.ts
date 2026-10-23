// What lies behind a text, for the contrast check (mirrors the backend's
// lint_ground.go): a page's elements in paint order with their boxes on the
// page; a text is measured against the topmost element under its centre. Only
// an upright, opaque, solid rectangle (or frame) counts as a known colour; an
// image, a gradient, a path (a leaf pattern), an ellipse, a turned shape or
// anything translucent makes the ground unknown, and the text is left alone.

import type { Color, Page } from "@hc/schema";

type Affine = [number, number, number, number, number, number]; // a b c d e f
const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

const mul = (m: Affine, n: Affine): Affine => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

interface Loose {
  id?: string;
  type?: string;
  shape?: string;
  visible?: boolean;
  opacity?: number;
  transform?: { x?: number; y?: number; scaleX?: number; scaleY?: number; rotation?: number };
  size?: { width?: number; height?: number };
  fills?: { type?: string; visible?: boolean; opacity?: number; color?: Color }[];
  children?: Loose[];
}

function local(t: Loose["transform"]): Affine {
  if (!t) return IDENTITY;
  const r = ((t.rotation ?? 0) * Math.PI) / 180, sx = t.scaleX ?? 1, sy = t.scaleY ?? 1;
  const cos = Math.cos(r), sin = Math.sin(r);
  return [cos * sx, sin * sx, -sin * sy, cos * sy, t.x ?? 0, t.y ?? 0];
}

interface Box { x0: number; y0: number; x1: number; y1: number }

function bounds(m: Affine, n: Loose): Box {
  const w = n.size?.width ?? 0, h = n.size?.height ?? 0;
  const b: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [px, py] of [[0, 0], [w, 0], [0, h], [w, h]]) {
    const x = m[0] * px + m[2] * py + m[4], y = m[1] * px + m[3] * py + m[5];
    b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y);
  }
  return b;
}

interface Layer { box: Box; color?: Color; text?: Loose }

/** A node's one opaque solid fill; paints is false when nothing shows. */
function solidGround(n: Loose): { color?: Color; paints: boolean } {
  const visible = (n.fills ?? []).filter((f) => f && f.visible !== false);
  if (!visible.length) return { paints: false };
  const top = visible[visible.length - 1];
  if (top.type !== "solid" || !top.color) return { paints: true };
  if ((top.color.srgb?.a ?? 1) < 0.99 || (top.opacity ?? 1) < 0.99) return { paints: true };
  return { color: top.color, paints: true };
}

function paintOrder(nodes: Loose[], parent: Affine, out: Layer[]) {
  for (const n of nodes) {
    if (!n || n.visible === false) continue;
    const m = mul(parent, local(n.transform));
    const opaque = (n.opacity ?? 1) >= 0.99;
    if (n.type === "group") {
      if (!opaque) { out.push({ box: bounds(m, n) }); continue; }
      paintOrder(n.children ?? [], m, out);
    } else if (n.type === "text") {
      out.push({ box: bounds(m, n), text: n });
    } else if (n.type === "shape" || n.type === "path" || n.type === "frame") {
      const g = solidGround(n);
      if (g.paints) {
        const rect = n.type === "frame" || (n.type === "shape" && (n.shape === undefined || n.shape === "rect"));
        const upright = (Math.abs(m[1]) < 1e-6 && Math.abs(m[2]) < 1e-6) || (Math.abs(m[0]) < 1e-6 && Math.abs(m[3]) < 1e-6);
        out.push({ box: bounds(m, n), color: g.color && rect && upright && opaque ? g.color : undefined });
      }
      if (n.type === "frame") paintOrder(n.children ?? [], m, out);
    } else {
      out.push({ box: bounds(m, n) });
    }
  }
}

/** The colour behind each text of a page (by id), where it is one known colour. */
export function textGrounds(page: Page, pageBg: Color | null): Map<string, Color> {
  const layers: Layer[] = [];
  paintOrder(page.children as unknown as Loose[], IDENTITY, layers);
  const bg: Color = pageBg ?? { srgb: { r: 1, g: 1, b: 1, a: 1 } };
  const out = new Map<string, Color>();
  layers.forEach((l, i) => {
    if (!l.text?.id) return;
    const cx = (l.box.x0 + l.box.x1) / 2, cy = (l.box.y0 + l.box.y1) / 2;
    let ground: Color | undefined = bg;
    for (let j = i - 1; j >= 0; j--) {
      const u = layers[j];
      if (u.text || cx < u.box.x0 || cx > u.box.x1 || cy < u.box.y0 || cy > u.box.y1) continue;
      ground = u.color;
      break;
    }
    if (ground) out.set(l.text.id, ground);
  });
  return out;
}
