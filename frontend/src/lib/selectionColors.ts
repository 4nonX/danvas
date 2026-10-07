// The solid colours used inside a selection (fills, borders, text runs), and
// recolouring every use of one of them. Backs the context toolbar's colour
// swatches for groups and multi-selections: imported artwork is mostly
// groups, and picking a colour there should change it everywhere inside.

import type { Color, Fill, Node } from "@hc/schema";

type Slot = { get: () => Color; set: (c: Color) => void };

const hexOf = (c: Color): string => {
  const ch = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return `#${ch(c.srgb.r)}${ch(c.srgb.g)}${ch(c.srgb.b)}`;
};

function solidSlot(holder: { fill?: Fill } | Fill[], key: number | "fill"): Slot | null {
  const f = (Array.isArray(holder) ? holder[key as number] : (holder as { fill?: Fill }).fill) as Fill | undefined;
  if (!f || f.type !== "solid") return null;
  return {
    get: () => (f as Extract<Fill, { type: "solid" }>).color,
    set: (c) => { (f as Extract<Fill, { type: "solid" }>).color = c; },
  };
}

/** Every solid colour slot in the nodes and their descendants. */
function slots(nodes: Node[]): Slot[] {
  const out: Slot[] = [];
  const walk = (n: Node) => {
    const any = n as unknown as {
      fills?: Fill[];
      stroke?: { fill?: Fill };
      content?: { runs?: { style?: { fill?: Fill } }[] }[];
      children?: Node[];
      child?: Node;
    };
    if (n.hidden) return;
    any.fills?.forEach((_, i) => { const s = solidSlot(any.fills!, i); if (s) out.push(s); });
    if (any.stroke) { const s = solidSlot(any.stroke, "fill"); if (s) out.push(s); }
    for (const p of any.content ?? []) for (const r of p.runs ?? []) if (r.style) { const s = solidSlot(r.style, "fill"); if (s) out.push(s); }
    any.children?.forEach(walk);
    if (any.child) walk(any.child);
  };
  nodes.forEach(walk);
  return out;
}

/** Distinct colours (hex) in the selection, most used first. */
export function selectionColors(nodes: Node[], max = 6): { hex: string; color: Color }[] {
  const counts = new Map<string, { color: Color; n: number }>();
  for (const s of slots(nodes)) {
    const c = s.get();
    if ((c.srgb.a ?? 1) <= 0) continue;
    const hex = hexOf(c);
    const e = counts.get(hex);
    if (e) e.n++;
    else counts.set(hex, { color: c, n: 1 });
  }
  return [...counts].sort((a, b) => b[1].n - a[1].n).slice(0, max).map(([hex, e]) => ({ hex, color: e.color }));
}

/** Set every slot whose colour is `fromHex` to `to`. Each slot keeps its own
 *  alpha unless `to` changes it (the picker's opacity slider), in which case
 *  all of them take the new alpha. Returns an undo function, or null when
 *  nothing matched. */
export function recolor(nodes: Node[], fromHex: string, to: Color): (() => void) | null {
  const hits = slots(nodes).filter((s) => hexOf(s.get()) === fromHex.toLowerCase());
  if (!hits.length) return null;
  const before = hits.map((s) => s.get());
  const alphaChanged = Math.abs((to.srgb.a ?? 1) - (before[0].srgb.a ?? 1)) > 1e-3;
  hits.forEach((s, i) => s.set({ srgb: { ...to.srgb, a: alphaChanged ? (to.srgb.a ?? 1) : (before[i].srgb.a ?? 1) } }));
  return () => hits.forEach((s, i) => s.set(before[i]));
}
