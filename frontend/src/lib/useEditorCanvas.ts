// Binds the editor store to a real <canvas>: builds @hc/engine scenes from the
// document and renders them through the Canvas2D path at the store viewport
// (with device-pixel-ratio handling), re-rendering on document/viewport/resize.
//
// Continuous multi-page scroll: all pages are drawn stacked vertically (each at
// a cumulative page-space offset), so scrolling reveals the whole document.
// Editing still targets the ACTIVE page: the coordinate helpers map
// screen <-> the active page's local space at its stacked offset, so selection,
// the gizmo, and hit-testing keep working unchanged. A single-page document has
// offset 0, so it behaves exactly as before.

import { useCallbackRef } from "@/lib/useCallbackRef";
import { useEffect, useRef, useState, type RefObject } from "react";
import { createScene, type CanvasLike, type Point, type Scene, type Viewport } from "@hc/engine";
import { pageToScreen, screenToPage } from "@hc/engine";
import { renderScene } from "@hc/engine";
import { locate } from "@hc/editor";
import { useEditor } from "@/store/editor";
import { imageAssets } from "@/lib/assetProvider";
import { fonts } from "@/lib/fontProvider";
import { pageGap, pageOffsets } from "@/lib/pageLayout";
import { createFrameScheduler, type FrameScheduler } from "@/lib/frameScheduler";

export interface CanvasApi {
  scene: () => Scene | null;
  viewport: () => Viewport;
  toPage: (screen: Point) => Point;
  toScreen: (page: Point) => Point;
  /** Index of the page whose stacked band contains a screen point (for
   *  click-to-activate in continuous-scroll mode). */
  pageIndexAt: (screen: Point) => number;
}

/**
 * During a gesture on the active page, its top-level elements split into those
 * below the moving ones, the moving ones (from the lowest to the highest moving
 * element, so anything between them is redrawn too and the order stays exact)
 * and those above. Null when the selection is not all on the active page.
 */
export function gestureLayers(
  doc: { pages: { children: { id: string }[] }[] },
  activeIdx: number,
  selection: readonly string[],
  topAncestor: (id: string) => string,
): { below: string[]; moving: string[]; above: string[]; key: string } | null {
  const kids = doc.pages[activeIdx]?.children ?? [];
  if (!selection.length || !kids.length) return null;
  const index = new Map(kids.map((n, i) => [n.id, i]));
  let lo = Infinity, hi = -Infinity;
  for (const id of selection) {
    const i = index.get(topAncestor(id));
    if (i === undefined) return null;
    lo = Math.min(lo, i);
    hi = Math.max(hi, i);
  }
  // An element above that blends (multiply, screen, ...) must blend with what
  // moves under it, so from the first such one up everything is drawn live.
  for (let i = hi + 1; i < kids.length; i++) if (blends(kids[i])) { hi = kids.length - 1; break; }
  const ids = kids.map((n) => n.id);
  return { below: ids.slice(0, lo), moving: ids.slice(lo, hi + 1), above: ids.slice(hi + 1), key: `${lo}-${hi}-${ids.length}-${ids[lo]}` };
}

/** Whether a node or anything inside it uses a blend mode other than normal. */
function blends(node: unknown): boolean {
  const n = node as { blendMode?: string; children?: unknown[]; child?: unknown; operands?: unknown[] };
  if (n.blendMode && n.blendMode !== "normal") return true;
  for (const c of [...(n.children ?? []), ...(n.operands ?? []), ...(n.child ? [n.child] : [])]) if (blends(c)) return true;
  return false;
}

/** A canvas of the given size, reusing `old` when it fits. */
function layerCanvas(w: number, h: number, old?: HTMLCanvasElement): HTMLCanvasElement {
  const c = old ?? document.createElement("canvas");
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  return c;
}

export function useEditorCanvas(canvasRef: RefObject<HTMLCanvasElement | null>): CanvasApi {
  // Lazily-built, per-page scene cache, invalidated when the doc rev changes.
  // Only pages that are drawn (visible) get built, so a 100+ page document does
  // O(visible) work per edit/scroll instead of O(all pages).
  const sceneCacheRef = useRef<{ rev: number; scenes: Map<number, Scene> }>({ rev: -1, scenes: new Map() });
  const sizeRef = useRef({ width: 1, height: 1, dpr: 1 });
  // The pictures of what does not move during a gesture (see renderNow).
  const layersRef = useRef<{ key: string; below: HTMLCanvasElement; above: HTMLCanvasElement; hasAbove: boolean } | null>(null);
  const fittedRef = useRef(false);
  const viewport = useEditor((s) => s.viewport);
  const activePage = useEditor((s) => s.activePage);
  const editingTextId = useEditor((s) => s.editingTextId);
  const maskRefining = useEditor((s) => s.maskRefining);
  const croppingId = useEditor((s) => s.cropping);
  const transforming = useEditor((s) => s.transforming);
  const hoverId = useEditor((s) => s.hoverId);
  const docId = useEditor((s) => s.doc.id);

  // Re-arm the one-time center+fit when a different document is loaded in place.
  useEffect(() => {
    fittedRef.current = false;
  }, [docId]);

  // Base (global stacked space) viewport.
  const buildViewport = (): Viewport => ({
    zoom: viewport.zoom,
    panX: viewport.panX,
    panY: viewport.panY,
    dpr: sizeRef.current.dpr,
    width: sizeRef.current.width,
    height: sizeRef.current.height,
  });

  // Viewport whose origin is the ACTIVE page's top-left in the stack, so the
  // coordinate helpers (and thus the gizmo/hit-testing) work in active-page
  // local space exactly as in the single-page model.
  const coordViewport = (): Viewport => {
    const st = useEditor.getState();
    const offs = pageOffsets(st.doc);
    // Read the LIVE active page (not the render closure) so a setActivePage()
    // earlier in the same event maps coordinates against the just-clicked page.
    const i = Math.max(0, Math.min(st.activePage, st.doc.pages.length - 1));
    return { ...buildViewport(), panY: viewport.panY - (offs[i] ?? 0) };
  };

  // Build (or reuse) the scene for one page. The cache is dropped whenever the
  // doc rev changes, so an edit rebuilds only the pages that get drawn.
  const getScene = (i: number): Scene => {
    const st = useEditor.getState();
    const cache = sceneCacheRef.current;
    if (cache.rev !== st.rev) { cache.rev = st.rev; cache.scenes.clear(); }
    let s = cache.scenes.get(i);
    if (!s) { s = createScene(st.doc, i); cache.scenes.set(i, s); }
    return s;
  };

  const renderNow = useCallbackRef(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    sizeRef.current = { width: rect.width, height: rect.height, dpr };
    useEditor.getState().setViewportSize(rect.width, rect.height);
    if (!fittedRef.current && rect.width > 0 && rect.height > 0) {
      fittedRef.current = true;
      useEditor.getState().fitToScreen();
      return; // fitToScreen changes the viewport, which re-invokes render()
    }
    const bw = Math.max(1, Math.round(rect.width * dpr));
    const bh = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const base = buildViewport();
    const doc = useEditor.getState().doc;
    if (!doc.pages.length) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
    const offs = pageOffsets(doc);
    // Content is clipped to its own page (clean edges): an element that
    // overflows the artboard is hidden on the pasteboard, EXCEPT the current
    // selection, which draws unclipped so a selected element reveals the parts
    // hidden past the edge (and can be resized back). Fade the element being
    // dragged/resized so the page shows through it during the gesture.
    const live = useEditor.getState().transforming;
    const selection = useEditor.getState().selection;
    const fadeIds = live ? new Set(selection) : undefined;
    // The element being cropped shows its hidden parts (the crop overlay dims
    // them); other clipping containers clip as usual.
    const cropping = useEditor.getState().cropping;
    const unclipIds = cropping ? new Set([cropping]) : undefined;
    // Reveal (draw unclipped) the selection's TOP-LEVEL ancestors, since the page
    // clip is applied per top-level element. Whiteboards are an unbounded surface,
    // so never page-clip them.
    const isBoard = (doc.meta as { kind?: string } | undefined)?.kind === "whiteboard";
    const clipToPage = !isBoard;
    const topAncestor = (id: string): string => {
      let cur = id;
      for (let i = 0; i < 64; i++) {
        const loc = locate(doc, cur);
        if (!loc || !loc.parent) return cur;
        cur = loc.parent.id;
      }
      return cur;
    };
    // Reveal the selection AND the hovered element, so an overflowing element
    // shows its off-page overflow (dimmed) on hover, matching the hover outline.
    // Skip hover-reveal during a live transform: hoverId isn't updated mid-drag,
    // so a stale hover could otherwise reveal an unrelated element.
    const hovered = !live ? useEditor.getState().hoverId : null;
    const revealSrc = hovered ? [...selection, hovered] : selection;
    const revealIds = clipToPage && revealSrc.length
      ? new Set(revealSrc.map(topAncestor))
      : undefined;
    // Viewport culling: only draw pages whose stacked band intersects the visible
    // area (plus a half-screen buffer so scrolling reveals neighbors smoothly).
    const z = base.zoom || 1;
    const viewTop = base.panY;
    const viewBottom = base.panY + (base.height || 0) / z;
    const buf = ((base.height || 0) / z) * 0.5;
    // Skip the node being text-edited (the DOM overlay shows it) and the image
    // whose mask is being brush-refined: the refine overlay draws the LIVE
    // composite itself, and the engine's committed render underneath would show
    // the old mask through every freshly erased region.
    const skipNodeId = useEditor.getState().editingTextId ?? useEditor.getState().maskRefining ?? undefined;
    // Private mode (FR-15): visually hide other participants' new contributions
    // (empty set unless a private round is hiding, so the common path is free).
    const hiddenIds = useEditor.getState().privateHiddenIds();
    const activeIdx = Math.max(0, Math.min(useEditor.getState().activePage, doc.pages.length - 1));
    const visible: number[] = [];
    for (let i = 0; i < doc.pages.length; i++) {
      const top = offs[i];
      const bottom = top + doc.pages[i].height;
      if (bottom < viewTop - buf || top > viewBottom + buf) continue;
      visible.push(i);
    }
    if (visible.length === 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    } else {
      // Draws the visible pages into `c`: the backgrounds (unless left out), then
      // the content, with `activeHidden` left out of the active page and
      // `onlyActive` drawing the active page's content alone.
      const draw = (c: CanvasRenderingContext2D, o: { activeHidden?: ReadonlySet<string>; backgrounds: boolean; onlyActive?: boolean }) => {
        // Two-pass render so no page's content is ever clipped or covered by another
        // page's background: pass 1 draws every visible page's background (bottom),
        // pass 2 draws all content on top. Content that overflows a page edge stays
        // visible on the pasteboard and above neighbouring pages' backgrounds.
        if (o.backgrounds) {
          visible.forEach((i, k) => {
            const vp: Viewport = { ...base, panY: base.panY - offs[i] };
            renderScene(getScene(i), c as unknown as CanvasLike, vp, { assets: imageAssets, clear: k === 0 ? undefined : false, backgroundOnly: true });
          });
        }
        // Content pass. During a drag, draw the active page's content last so the
        // dragged element sits above other pages' content too.
        const order = live ? [...visible].sort((a, b) => (a === activeIdx ? 1 : 0) - (b === activeIdx ? 1 : 0)) : visible;
        for (const i of order) {
          if (o.onlyActive && i !== activeIdx) continue;
          const vp: Viewport = { ...base, panY: base.panY - offs[i] };
          const hid = i === activeIdx && o.activeHidden ? new Set([...(hiddenIds ?? []), ...o.activeHidden]) : hiddenIds;
          renderScene(getScene(i), c as unknown as CanvasLike, vp, { assets: imageAssets, clear: false, skipBackground: true, skipNodeId, hiddenIds: hid, fadeIds, clipToPage, revealIds, unclipIds });
        }
      };
      const layers = live ? gestureLayers(doc, activeIdx, selection, topAncestor) : null;
      if (!layers) {
        layersRef.current = null;
        draw(ctx, { backgrounds: true });
      } else {
        // A gesture: what does not move is drawn once into two pictures (below
        // and above the moving elements, so the stacking stays exact), and each
        // frame draws picture, moving elements, picture.
        const key = [bw, bh, base.zoom, base.panX, base.panY, activeIdx, layers.key, skipNodeId ?? "", [...(revealIds ?? [])].join(","), [...(hiddenIds ?? [])].join(",")].join("|");
        let cache = layersRef.current;
        if (!cache || cache.key !== key) {
          const below = layerCanvas(bw, bh, cache?.below);
          const above = layerCanvas(bw, bh, cache?.above);
          const bctx = below.getContext("2d");
          const actx = above.getContext("2d");
          if (!bctx || !actx) { layersRef.current = null; draw(ctx, { backgrounds: true }); return; }
          draw(bctx, { backgrounds: true, activeHidden: new Set([...layers.moving, ...layers.above]) });
          actx.setTransform(1, 0, 0, 1, 0, 0);
          actx.clearRect(0, 0, bw, bh);
          if (layers.above.length) draw(actx, { backgrounds: false, onlyActive: true, activeHidden: new Set([...layers.below, ...layers.moving]) });
          cache = { key, below, above, hasAbove: layers.above.length > 0 };
          layersRef.current = cache;
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, bw, bh);
        ctx.drawImage(cache.below, 0, 0);
        draw(ctx, { backgrounds: false, onlyActive: true, activeHidden: new Set([...layers.below, ...layers.above]) });
        if (cache.hasAbove) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.drawImage(cache.above, 0, 0);
        }
      }
    }
  });

  // Every reason to repaint (an edit, the viewport, hover, an image or font
  // that finished loading, a resize) asks the scheduler; it draws once per
  // frame at most, and after a slow drawing waits as long again, so a heavy
  // design makes the canvas update less often instead of freezing the page.
  const [scheduler] = useState<FrameScheduler>(() => createFrameScheduler(() => renderNow()));
  const render = useCallbackRef(() => scheduler.request());
  useEffect(() => () => scheduler.cancel(), [scheduler]);

  // On a doc change, (re)register assets/fonts and repaint. Scenes rebuild lazily
  // per visible page via getScene (the cache invalidates on the rev change).
  // Subscribed directly, so an edit does not re-render the canvas component.
  useEffect(() => {
    const onDoc = () => {
      const doc = useEditor.getState().doc;
      imageAssets.registerAll(doc.assets ?? []);
      fonts.ensureForDoc(doc);
      render();
    };
    onDoc();
    return useEditor.subscribe((s, prev) => { if (s.rev !== prev.rev || s.doc !== prev.doc) onDoc(); });
  }, [render]);

  // Repaint when an image asset or a web font finishes loading (the stored
  // pictures of a gesture would show it missing, so they go).
  useEffect(() => imageAssets.onChange(() => { layersRef.current = null; render(); }), [render]);
  useEffect(() => fonts.onChange(() => { layersRef.current = null; render(); }), [render]);

  // Repaint on viewport, active-page, text-edit (skip), mask-refine (skip),
  // live-transform, or hover change (hover reveals a selected/overflowing
  // element's off-page overflow).
  useEffect(() => {
    render();
  }, [viewport, activePage, editingTextId, maskRefining, croppingId, transforming, hoverId, render]);

  // Repaint on container resize.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => render());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [canvasRef, render]);

  // Repaint on window resize / device-pixel-ratio change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => render();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [render]);

  return {
    scene: () => {
      const st = useEditor.getState();
      if (!st.doc.pages.length) return null;
      return getScene(Math.max(0, Math.min(st.activePage, st.doc.pages.length - 1)));
    },
    viewport: buildViewport,
    toPage: (screen) => screenToPage(coordViewport(), screen),
    toScreen: (page) => pageToScreen(coordViewport(), page),
    pageIndexAt: (screen) => {
      const doc = useEditor.getState().doc;
      const offs = pageOffsets(doc);
      const gy = screenToPage(buildViewport(), screen).y; // global stacked Y
      for (let i = 0; i < doc.pages.length; i++) {
        const top = offs[i];
        const bottom = top + doc.pages[i].height + pageGap / 2;
        if (gy < bottom) return i;
      }
      return doc.pages.length - 1;
    },
  };
}
