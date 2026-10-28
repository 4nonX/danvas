// Print roles of single elements, kept in the node's `data` (no schema
// change: older files lack it, older clients keep it untouched):
//
// - overprint: the element prints over what is under it instead of
//   knocking it out (vector PDF and EPS; a soft proof shows it).
// - dieLine: the element is a cut contour, not artwork. It is never
//   printed; the vector print files draw its outline in the die line's spot
//   colour when the download includes a die line.

import type { DesignFile, Node, Page } from "@hc/schema";

export const PRINT_ROLE_KEY = "print";

export interface PrintRole {
  overprint?: boolean;
  dieLine?: boolean;
}

export function printRoleOf(n: Node | null | undefined): PrintRole {
  const raw = n?.data?.[PRINT_ROLE_KEY];
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  return { ...(r.overprint === true ? { overprint: true } : {}), ...(r.dieLine === true ? { dieLine: true } : {}) };
}

export const isOverprint = (n: Node | null | undefined) => !!printRoleOf(n).overprint;
export const isDieLine = (n: Node | null | undefined) => !!printRoleOf(n).dieLine;

/** The node's data with the role changed (in place on a copy of `data`);
 *  the key goes when nothing is left in it. */
export function withPrintRole(n: Node, patch: PrintRole): Record<string, unknown> | undefined {
  const next: PrintRole = { ...printRoleOf(n) };
  for (const k of ["overprint", "dieLine"] as const) {
    if (k in patch) {
      if (patch[k]) next[k] = true;
      else delete next[k];
    }
  }
  const data = { ...(n.data ?? {}) };
  if (next.overprint || next.dieLine) data[PRINT_ROLE_KEY] = next;
  else delete data[PRINT_ROLE_KEY];
  return Object.keys(data).length ? data : undefined;
}

const kids = (n: Node) => (n as unknown as { children?: Node[] }).children;

/** Whether any node of the pages (all when not given) is a die line. */
export function hasDieLines(doc: DesignFile, pages?: number[]): boolean {
  const any = (nodes: Node[]): boolean => nodes.some((n) => isDieLine(n) || any(kids(n) ?? []));
  return (pages ?? doc.pages.map((_, i) => i)).some((i) => !!doc.pages[i] && any(doc.pages[i].children));
}

/** Whether any visible node of the pages overprints. */
export function hasOverprint(doc: DesignFile, pages?: number[]): boolean {
  const any = (nodes: Node[]): boolean => nodes.some((n) => !n.hidden && !isDieLine(n) && (isOverprint(n) || any(kids(n) ?? [])));
  return (pages ?? doc.pages.map((_, i) => i)).some((i) => !!doc.pages[i] && any(doc.pages[i].children));
}

function filterNodes(nodes: Node[], keep: (n: Node) => boolean): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    const c = kids(n);
    if (!Array.isArray(c)) {
      if (keep(n)) out.push(n);
      continue;
    }
    if (keep(n) && !c.length) { out.push(n); continue; }
    const inner = filterNodes(c, keep);
    if (inner.length !== c.length || inner.some((x, i) => x !== c[i])) {
      if (inner.length) out.push({ ...n, children: inner } as Node);
    } else {
      out.push(n);
    }
  }
  return out;
}

/** The design without its die line elements: the artwork every export
 *  prints. Returns the design itself when it has none. */
export function withoutDieLines(doc: DesignFile): DesignFile {
  if (!hasDieLines(doc)) return doc;
  return { ...doc, pages: doc.pages.map((p) => ({ ...p, children: filterNodes(p.children, (n) => !isDieLine(n)) })) } as DesignFile;
}

/**
 * Only the die line elements of one page, drawn as cut lines: no fill, no
 * effects, a hairline stroke of `strokePx` (the colour does not matter, the
 * writer paints it in the die line's spot colour). Groups around them keep
 * their transform and clipping but lose their own paint. Null when the page
 * has none.
 */
export function dieLinePage(page: Page, strokePx: number): Page | null {
  const style = (n: Node): Node => {
    const out = { ...n } as Record<string, unknown>;
    delete out.effects;
    out.opacity = 1;
    out.blendMode = "normal";
    if ("fills" in out) out.fills = [];
    if ("fill" in out) delete out.fill;
    out.stroke = { fill: { type: "solid", color: { srgb: { r: 1, g: 0, b: 1, a: 1 } } }, width: strokePx, align: "center", join: "round", cap: "round" };
    return out as unknown as Node;
  };
  const walk = (nodes: Node[]): Node[] => {
    const out: Node[] = [];
    for (const n of nodes) {
      if (n.hidden) continue;
      if (isDieLine(n)) { out.push(style(n)); continue; }
      const c = kids(n);
      if (!Array.isArray(c)) continue;
      const inner = walk(c);
      if (!inner.length) continue;
      const g = { ...n, children: inner } as Record<string, unknown>;
      delete g.effects;
      if ("fills" in g) g.fills = [];
      delete g.stroke;
      g.opacity = 1;
      out.push(g as unknown as Node);
    }
    return out;
  };
  const children = walk(page.children);
  if (!children.length) return null;
  const { background: _bg, ...rest } = page;
  void _bg;
  return { ...rest, children } as Page;
}
