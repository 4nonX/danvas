// Context toolbar: a floating pill centered above the canvas whose
// controls follow the selection (text / image / shape / group / several /
// nothing = page), in Canva's order. Element actions (lock, duplicate, delete,
// more) live in the SelectionToolbar mini bar at the element instead.
// Every control calls the same store actions as the properties panel, which
// stays available (collapsed by default) for the less common settings.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Crop, FlipHorizontal2, FlipVertical2,
  Eraser, Group, Italic, List, Loader2, PenTool, ListOrdered, Minus, MoreHorizontal, PanelRightOpen, Paintbrush, Plus, Strikethrough, Underline, Ungroup, MoveVertical,
} from "lucide-react";
import type { CharStyle, Color, Fill, Node, ParagraphStyle, Stroke } from "@hc/schema";
import { locate } from "@hc/editor";
import { weightFromFontStyle } from "@hc/engine";
import { useEditor } from "@/store/editor";
import { useBrand, colorsLockedFor, fontsLockedFor, brandHexColors, brandFontFamilies } from "@/store/brand";
import { fonts } from "@/lib/fontProvider";
import { tr } from "@/lib/i18n";
import { ColorField } from "./ColorField";
import { selectionColors } from "@/lib/selectionColors";
import { svgSourceOf } from "@/lib/svgImage";
import { removeImageBackground, useBgRemoval } from "@/lib/backgroundRemoval";
import { userMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/Toast";
import {
  FONT_FAMILY_OPTIONS, PALETTE, colorFromHex, colorHex, firstFill, firstParaStyle, firstRunStyle,
  pageBgOf, recentColorList, rememberColor, runColorHex,
} from "./PropertiesPanel";
import { useWorkspaceFontFamilies } from "@/lib/workspaceFonts";

const btn =
  "flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-sm text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-40 disabled:hover:bg-transparent";
const ico = `${btn} w-8 px-0`;
const on = "bg-brand-50 text-brand-ink hover:bg-brand-50";
const sep = <span className="mx-1 h-5 w-px shrink-0 bg-neutral-200" />;
type Rgb = { srgb: { r: number; g: number; b: number } };

/** Canva's transparency icon: a small checkerboard. */
function Checker() {
  return (
    <span
      aria-hidden
      className="h-4 w-4 rounded-[3px] border border-neutral-300"
      style={{ backgroundImage: "conic-gradient(#9ca3af 25%, transparent 0 50%, #9ca3af 0 75%, transparent 0)", backgroundSize: "8px 8px" }}
    />
  );
}

/** A toolbar button that opens a small panel below it; closes on outside click. */
function Pop({ label, title, children, width = 240, square, closeOnClick }: { label: ReactNode; title: string; children: ReactNode; width?: number; square?: boolean; closeOnClick?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as globalThis.Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" title={title} aria-label={title} aria-expanded={open} onClick={() => setOpen((v) => !v)} className={`${square ? ico : btn} ${open ? on : ""}`}>
        {label}
      </button>
      {open && (
        <div className="absolute left-1/2 top-full z-40 mt-2 -translate-x-1/2 rounded-xl border border-neutral-200 bg-surface p-3 shadow-xl" style={{ width }} onClick={closeOnClick ? () => setOpen(false) : undefined}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Number input that commits on Enter/blur (no store write per keystroke). */
function NumIn({ value, onCommit, min, width = 56, label }: { value: number; onCommit: (n: number) => void; min?: number; width?: number; label: string }) {
  const [v, setV] = useState(String(value));
  // Follow outside changes to the value (adjusting state during render).
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setV(String(Math.round(value * 100) / 100)); }
  const commit = () => {
    const n = Number(v.replace(",", "."));
    if (Number.isFinite(n)) onCommit(min != null ? Math.max(min, n) : n);
    else setV(String(value));
  };
  return (
    <input
      aria-label={label}
      title={label}
      value={v}
      inputMode="decimal"
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { commit(); (e.target as HTMLInputElement).blur(); } }}
      className="h-8 rounded-md border border-neutral-200 bg-surface px-1 text-center text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
      style={{ width }}
    />
  );
}

export function ContextToolbar({ propsOpen, onToggleProps }: { propsOpen: boolean; onToggleProps: () => void }) {
  useEditor((s) => s.rev);
  const selection = useEditor((s) => s.selection);
  const activePage = useEditor((s) => s.activePage);
  const cropping = useEditor((s) => s.cropping);
  const workspaceFamilies = useWorkspaceFontFamilies();
  const brand = useBrand((s) => s.kit);
  const brandCanManage = useBrand((s) => s.canManage);
  const st = useEditor.getState();
  const doc = st.doc;

  // Format painter: copy the style, then the NEXT selection receives it.
  const [painting, setPainting] = useState<string | null>(null);
  useEffect(() => {
    if (!painting) return;
    return useEditor.subscribe((s) => {
      const key = s.selection.join("|");
      if (!key || key === painting) return;
      useEditor.getState().pasteStyle();
      setPainting(null);
    });
  }, [painting]);
  useEffect(() => {
    if (!painting) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPainting(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [painting]);


  const brandState = { kit: brand, canManage: brandCanManage } as Parameters<typeof colorsLockedFor>[0];
  const brandSwatches = colorsLockedFor(brandState) ? brandHexColors(brand) : null;
  const brandFonts = fontsLockedFor(brandState) ? brandFontFamilies(brand) : null;

  const single = selection.length === 1 ? locate(doc, selection[0]) : null;
  const node = single?.node as Node | undefined;
  const type = node?.type;
  const locked = !!node?.locked;

  // SVG files placed as images can become editable shapes (then recolored
  // like any vector); which images are SVGs is only known once fetched.
  const imageAsset = type === "image" ? (node as unknown as { source: { assetId: string } }).source.assetId : null;
  const [svgAsset, setSvgAsset] = useState<string | null>(null);
  useEffect(() => {
    if (!imageAsset) return;
    let live = true;
    void svgSourceOf(imageAsset).then((svg) => { if (live) setSvgAsset(svg ? imageAsset : null); });
    return () => { live = false; };
  }, [imageAsset]);
  const isSvgImage = !!imageAsset && svgAsset === imageAsset;

  // Background removal, shared with the properties panel (same progress).
  const toast = useToast();
  const bgWorking = useBgRemoval((s2) => s2.nodeId);
  const bgProgress = useBgRemoval((s2) => s2.progress);
  const bgWorkspace = useBrand((s2) => s2.workspaceId);
  const hasMask = type === "image" && !!(node as unknown as { alphaMask?: unknown }).alphaMask;
  const openPanel = () => { if (!propsOpen) onToggleProps(); };

  // When the canvas column is too narrow for the full pill (properties panel
  // open, small window), the secondary tools fold into a "more" menu instead
  // of wrapping onto a second line. The full width is measured per selection
  // kind while expanded and compared against the available width.
  const outerRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const fullWidth = useRef(0);
  // Compact is remembered per selection kind, so a different kind starts
  // expanded and gets measured afresh.
  const kindKey = `${selection.length > 1 ? "multi" : (selection.length ? "one" : "none")}:${type ?? ""}`;
  const [compactKey, setCompactKey] = useState<string | null>(null);
  const compact = compactKey === kindKey;
  useLayoutEffect(() => {
    const outer = outerRef.current;
    const pill = pillRef.current;
    if (!outer || !pill) return;
    if (!compact) fullWidth.current = pill.scrollWidth;
    // The observer also fires once on observe, before paint.
    const ro = new ResizeObserver(() => setCompactKey(outer.clientWidth - 24 >= fullWidth.current ? null : kindKey));
    ro.observe(outer);
    return () => ro.disconnect();
  });

  /** A color control: free picker, or the brand swatches when colors are locked. */
  const colorControl = (value: Color, onPick: (c: Color) => void, title: string, face?: ReactNode) =>
    brandSwatches || face ? (
      <Pop title={title} square label={face ?? <span className="h-5 w-5 rounded border border-neutral-300" style={{ background: colorHex(value as Rgb) }} />}>
        {brandSwatches ? (
          <div className="flex flex-wrap gap-1.5">
            {brandSwatches.map((c) => (
              <button key={c} type="button" title={c} onClick={() => onPick(colorFromHex(c))} className="h-6 w-6 rounded border border-neutral-300" style={{ background: c }} />
            ))}
          </div>
        ) : (
          <ColorField
            value={value}
            onChange={(c) => { rememberColor(colorHex(c as Rgb)); onPick(c); }}
            bg={pageBgOf(doc, activePage)}
            palette={PALETTE}
            recents={recentColorList()}
            title={title}
          />
        )}
      </Pop>
    ) : (
      // ColorField's trigger shrunk to a round swatch for the toolbar.
      <div className="grid h-8 w-8 shrink-0 place-items-center [&_.oc-color-trigger]:h-6 [&_.oc-color-trigger]:w-6 [&_.oc-color-trigger]:rounded-full [&_.oc-color-trigger]:border-neutral-300">
        <ColorField
          value={value}
          onChange={(c) => { rememberColor(colorHex(c as Rgb)); onPick(c); }}
          bg={pageBgOf(doc, activePage)}
          palette={PALETTE}
          recents={recentColorList()}
          title={title}
        />
      </div>
    );

  /** One swatch per colour used in the selection (groups, several elements);
   *  changing a swatch recolours every use of it. Keyed by position so an
   *  open picker survives the colour it is editing changing its hex. */
  const colorsOfSelection = () => {
    const nodes = selection.map((id) => locate(doc, id)?.node).filter(Boolean) as Node[];
    const list = selectionColors(nodes);
    if (!list.length) return null;
    return (
      <>
        {list.map(({ hex, color }, i) => (
          <span key={i} className="contents">{colorControl(color, (c) => st.recolorSelection(hex, c), `${tr("editor.color")} ${hex.toUpperCase()}`)}</span>
        ))}
        {sep}
      </>
    );
  };

  const opacity = node ? node.opacity : 1;
  const transparency = (
    <Pop title={tr("editor.opacity")} square label={<Checker />}>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(opacity * 100)}
          onChange={(e) => st.setOpacitySel(Number(e.target.value) / 100)}
          className="flex-1 accent-brand-600"
          aria-label={tr("editor.opacity")}
        />
        <NumIn value={Math.round(opacity * 100)} min={0} onCommit={(n) => st.setOpacitySel(Math.min(100, n) / 100)} label={tr("editor.opacity")} width={52} />
      </div>
    </Pop>
  );
  // Effects, Animation and image editing open focused side panels on the
  // left (SelectionPanels); everything else stays in the properties panel.
  const effects = <button type="button" className={btn} onClick={() => st.requestRail("effects")}>{tr("editor.effects")}</button>;
  const animation = <button type="button" className={btn} onClick={() => st.requestRail("animation")}>{tr("editor.animation")}</button>;
  const position = <button type="button" className={btn} onClick={() => st.requestRail("position")}>{tr("editor.position")}</button>;
  /** The secondary tools: inline when there is room, else behind "more". */
  const more = (els: ReactNode) => compact ? (
    <Pop title={tr("editor.more_actions")} square closeOnClick width={180} label={<MoreHorizontal size={16} />}>
      <div className="flex flex-col gap-0.5 [&>button]:justify-start">{els}</div>
    </Pop>
  ) : els;
  const painter = (
    <button
      type="button"
      title={tr("editor.copy_style")}
      aria-label={tr("editor.copy_style")}
      aria-pressed={!!painting}
      className={`${compact ? btn : ico} ${painting ? on : ""}`}
      onClick={() => {
        if (painting) { setPainting(null); return; }
        st.copyStyle();
        setPainting(selection.join("|"));
      }}
    ><Paintbrush size={16} />{compact && tr("editor.copy_style")}</button>
  );

  // Crop for every element: images crop their source, everything else crops
  // to a clipping group. An element already cropped that way (the only child
  // of a clipping group) re-crops that group.
  const cropTarget = (() => {
    if (!node) return null;
    const p = single?.parent as { id: string; type: string; clip?: boolean; children?: unknown[] } | null | undefined;
    return p && p.type === "group" && p.clip && p.children?.length === 1 ? p.id : node.id;
  })();
  const cropBtn = (
    <button type="button" disabled={locked} className={`${btn} ${cropping && cropping === cropTarget ? on : ""}`} onClick={() => cropTarget && st.setCropping(cropTarget)}>
      <Crop size={15} />{tr("editor.crop")}
    </button>
  );

  let items: ReactNode = null;

  if (selection.length === 0) {
    // Nothing selected: the page itself (Canva shows the background color).
    items = colorControl(pageBgOf(doc, activePage), (c) => st.setPageBackground({ type: "solid", color: c } as Fill), tr("editor.color"));
  } else if (node && type === "text") {
    const id = node.id;
    const cs = firstRunStyle(node);
    const ps = firstParaStyle(node);
    const setChar = (char: Partial<CharStyle>) => useEditor.getState().setTextStyle(id, char);
    const setPara = (para: Partial<ParagraphStyle>) => useEditor.getState().setTextStyle(id, undefined, para);
    const weight = cs?.axes?.wght ?? weightFromFontStyle(cs?.fontStyle);
    const isBold = weight >= 600;
    const isItalic = /italic|oblique/i.test(cs?.fontStyle ?? "");
    const deco = (cs?.decoration ?? []) as ("underline" | "strikethrough")[];
    const toggleDeco = (d: "underline" | "strikethrough") => {
      const rest = deco.filter((x) => x !== d);
      setChar({ decoration: deco.includes(d) ? (rest.length ? rest : undefined) : [...rest, d] });
    };
    const isUpper = (cs as unknown as { case?: string } | null)?.case === "upper";
    const size = cs?.fontSize ?? 16;
    const lineHeight = typeof cs?.lineHeight === "number" ? cs.lineHeight : 1.2;
    const aligns = [
      { a: "left", I: AlignLeft },
      { a: "center", I: AlignCenter },
      { a: "right", I: AlignRight },
      { a: "justify", I: AlignJustify },
    ] as const;
    const curAlign = Math.max(0, aligns.findIndex((x) => x.a === (ps?.align ?? "left")));
    const AlignIcon = aligns[curAlign].I;
    const list = (ps as unknown as { list?: { type: string } } | null)?.list?.type;
    const ListIcon = list === "number" ? ListOrdered : List;
    const family = cs?.fontFamily ?? "system";
    // Toggling italic keeps the weight carried in the style name ("SemiBold Italic").
    const baseStyle = (cs?.fontStyle ?? "Regular").replace(/\s*(italic|oblique)$/i, "") || "Regular";
    const textColor = cs?.fill?.type === "solid" ? cs.fill.color : colorFromHex(cs ? runColorHex(cs) : "#111827");
    items = (
      <>
        <select
          aria-label={tr("editor.font_family")}
          title={tr("editor.font_family")}
          value={brandFonts && !brandFonts.includes(family) ? brandFonts[0] : family}
          onChange={(e) => { fonts.ensure(e.target.value); setChar({ fontFamily: e.target.value }); }}
          className={`h-8 ${compact ? "w-28" : "w-40"} shrink-0 truncate rounded-md border border-neutral-200 bg-surface px-2 text-sm outline-none focus:border-brand-400`}
        >
          {brandFonts ? brandFonts.map((f) => <option key={f} value={f}>{f}</option>) : (
            <>
              <option value="system">{tr("editor.system_default")}</option>
              {/* An imported family may not be in the catalog: keep it listed. */}
              {family !== "system" && !workspaceFamilies.includes(family) && <option value={family}>{family}</option>}
              {workspaceFamilies.length > 0 && (
                <optgroup label={tr("editor.workspace_fonts")}>
                  {workspaceFamilies.map((f) => <option key={`ws-${f}`} value={f}>{f}</option>)}
                </optgroup>
              )}
              {FONT_FAMILY_OPTIONS}
            </>
          )}
        </select>
        <div className="flex shrink-0 items-center rounded-md border border-neutral-200">
          <button type="button" className={`${ico} h-7`} title={tr("editor.font_size")} aria-label={tr("editor.font_size")} onClick={() => setChar({ fontSize: Math.max(1, Math.round(size) - 1) })}><Minus size={13} /></button>
          <NumIn value={size} min={1} onCommit={(n) => setChar({ fontSize: n })} label={tr("editor.font_size")} width={40} />
          <button type="button" className={`${ico} h-7`} title={tr("editor.font_size")} aria-label={tr("editor.font_size")} onClick={() => setChar({ fontSize: Math.round(size) + 1 })}><Plus size={13} /></button>
        </div>
        {colorControl(
          textColor,
          (c) => setChar({ fill: { type: "solid", color: c } as Fill }),
          tr("editor.text_color"),
        )}
        <button type="button" title={tr("editor.bold")} aria-label={tr("editor.bold")} aria-pressed={isBold} className={`${ico} ${isBold ? on : ""}`} onClick={() => setChar({ axes: { ...(cs?.axes ?? {}), wght: isBold ? 400 : 700 } })}><Bold size={16} /></button>
        <button type="button" title={tr("editor.italic")} aria-label={tr("editor.italic")} aria-pressed={isItalic} className={`${ico} ${isItalic ? on : ""}`} onClick={() => setChar({ fontStyle: isItalic ? baseStyle : (baseStyle === "Regular" ? "Italic" : `${baseStyle} Italic`) })}><Italic size={16} /></button>
        <button type="button" title={tr("editor.underline")} aria-label={tr("editor.underline")} aria-pressed={deco.includes("underline")} className={`${ico} ${deco.includes("underline") ? on : ""}`} onClick={() => toggleDeco("underline")}><Underline size={16} /></button>
        <button type="button" title={tr("editor.strikethrough")} aria-label={tr("editor.strikethrough")} aria-pressed={deco.includes("strikethrough")} className={`${ico} ${deco.includes("strikethrough") ? on : ""}`} onClick={() => toggleDeco("strikethrough")}><Strikethrough size={16} /></button>
        <button
          type="button"
          title={tr("editor.uppercase")}
          aria-label={tr("editor.uppercase")}
          aria-pressed={isUpper}
          className={`${ico} text-[13px] font-semibold ${isUpper ? on : ""}`}
          onClick={() => setChar({ case: isUpper ? "none" : "upper" } as Partial<CharStyle>)}
        >aA</button>
        <button type="button" title={tr("editor.align")} aria-label={tr("editor.align")} className={ico} onClick={() => setPara({ align: aligns[(curAlign + 1) % aligns.length].a })}><AlignIcon size={16} /></button>
        <button
          type="button"
          title={list === "number" ? tr("editor.numbered_list") : tr("editor.bullet_list")}
          aria-label={tr("editor.list")}
          aria-pressed={!!list}
          className={`${ico} ${list ? on : ""}`}
          // Canva cycles: none -> bullets -> numbers -> none.
          onClick={() => setPara({ list: !list ? { type: "bullet", level: 0 } : list === "bullet" ? { type: "number", level: 0 } : undefined } as Partial<ParagraphStyle>)}
        ><ListIcon size={16} /></button>
        <Pop title={tr("editor.spacing")} square label={<MoveVertical size={16} />}>
          <div className="flex flex-col gap-2 text-xs text-neutral-600">
            <label className="flex items-center justify-between gap-2">
              <span>{tr("editor.letter_spacing")}</span>
              <NumIn value={cs?.letterSpacing ?? 0} onCommit={(n) => setChar({ letterSpacing: n })} label={tr("editor.letter_spacing")} width={64} />
            </label>
            <label className="flex items-center justify-between gap-2">
              <span>{tr("editor.line_height")}</span>
              <NumIn value={lineHeight} min={0.5} onCommit={(n) => setChar({ lineHeight: n })} label={tr("editor.line_height")} width={64} />
            </label>
          </div>
        </Pop>
        {transparency}
        {sep}
        {more(<>{cropBtn}{effects}{animation}{position}{compact && painter}</>)}
        {!compact && sep}
        {!compact && painter}
      </>
    );
  } else if (node && type === "image") {
    items = (
      <>
        <button type="button" className={btn} onClick={() => st.requestRail("image")}>{tr("editor.edit")}</button>
        {isSvgImage ? (
          <button type="button" disabled={locked} className={btn} onClick={() => void st.makeSvgImageEditable(node.id)} title={tr("editor.make_editable_tooltip")}><PenTool size={15} />{tr("editor.make_editable")}</button>
        ) : (
          <button type="button" className={btn} onClick={() => st.requestRail("vectorize")} title={tr("editor.vectorize_tooltip")}><PenTool size={15} />{tr("editor.vectorize")}</button>
        )}
        <button type="button" disabled={locked} className={`${btn} ${cropping === node.id ? on : ""}`} onClick={() => st.setCropping(node.id)}><Crop size={15} />{tr("editor.crop")}</button>
        {!isSvgImage && (hasMask ? (
          <button type="button" disabled={locked} className={btn} onClick={() => st.setImageAlphaMask(node.id, null, 0, 0)} title={tr("editor.restore_background")}>
            <Eraser size={15} />{tr("editor.restore_background")}
          </button>
        ) : (
          <button
            type="button"
            disabled={locked || bgWorking !== null}
            className={btn}
            title={tr("editor.runs_in_your_browser_the_model_downloads_on")}
            onClick={() => {
              const id = node.id;
              void removeImageBackground(id, bgWorkspace ?? null).catch((e) => toast.error(userMessage(e, tr("editor.background_removal_failed"))));
            }}
          >
            {bgWorking === node.id ? <Loader2 size={15} className="animate-spin" /> : <Eraser size={15} />}
            {bgWorking === node.id ? tr("editor.removing_background_pct", { pct: Math.round(bgProgress * 100) }) : tr("editor.remove_background")}
          </button>
        ))}
        <Pop title={tr("editor.flip")} label={<><FlipHorizontal2 size={15} />{tr("editor.flip")}</>} width={220}>
          <div className="flex flex-col gap-1">
            <button type="button" className={btn} onClick={() => st.flipSelection("h")}><FlipHorizontal2 size={15} />{tr("editor.flip_horizontal")}</button>
            <button type="button" className={btn} onClick={() => st.flipSelection("v")}><FlipVertical2 size={15} />{tr("editor.flip_vertical")}</button>
          </div>
        </Pop>
        {transparency}
        {sep}
        {more(<>{animation}{position}{compact && painter}</>)}
        {!compact && sep}
        {!compact && painter}
      </>
    );
  } else if (node && (type === "shape" || type === "path")) {
    const fill = firstFill(node);
    const stroke = (node as unknown as { stroke?: Stroke }).stroke;
    const strokeColor = stroke?.fill?.type === "solid" ? stroke.fill.color : colorFromHex("#111827");
    const strokeBase = (stroke ?? { align: "center", cap: "round", join: "round" }) as Stroke;
    items = (
      <>
        {fill?.type === "solid" || !fill
          ? colorControl(fill?.type === "solid" ? fill.color : colorFromHex("#ffffff"), (c) => st.setFillColorSel(c), tr("editor.fill"))
          : <button type="button" className={btn} onClick={openPanel}>{tr("editor.fill")}</button>}
        <Pop title={tr("editor.border")} square label={<span className="h-4 w-4 rounded-sm border-2" style={{ borderColor: stroke ? colorHex(strokeColor as Rgb) : "#a3a3a3", borderStyle: stroke ? "solid" : "dashed" }} />}>
          <div className="flex flex-col gap-2 text-xs text-neutral-600">
            <label className="flex items-center justify-between gap-2">
              <span>{tr("editor.width")}</span>
              <NumIn
                value={stroke?.width ?? 0}
                min={0}
                onCommit={(n) => st.setStrokeSel(n > 0 ? ({ ...strokeBase, fill: { type: "solid", color: strokeColor }, width: n } as Stroke) : undefined)}
                label={tr("editor.width")}
              />
            </label>
            <label className="flex items-center justify-between gap-2">
              <span>{tr("editor.color")}</span>
              <ColorField
                value={strokeColor}
                onChange={(c) => st.setStrokeSel({ ...strokeBase, fill: { type: "solid", color: c }, width: stroke?.width || 1 } as Stroke)}
                palette={PALETTE}
                title={tr("editor.color")}
                block={false}
              />
            </label>
            {type === "shape" && (node as unknown as { shape?: string }).shape === "rect" && (
              <label className="flex items-center justify-between gap-2">
                <span>{tr("editor.radius")}</span>
                <NumIn value={(node as unknown as { cornerRadius?: { tl?: number } }).cornerRadius?.tl ?? 0} min={0} onCommit={(n) => st.setCornerRadiusSel(n)} label={tr("editor.radius")} />
              </label>
            )}
          </div>
        </Pop>
        {cropBtn}
        {transparency}
        {sep}
        {more(<>{effects}{animation}{position}{compact && painter}</>)}
        {!compact && sep}
        {!compact && painter}
      </>
    );
  } else if (node && type === "group") {
    items = (
      <>
        {colorsOfSelection()}
        <button type="button" className={btn} onClick={() => st.ungroupSelection()}><Ungroup size={15} />{tr("editor.ungroup")}</button>
        {cropBtn}
        {transparency}
        {sep}
        {more(<>{animation}{position}{compact && painter}</>)}
        {!compact && sep}
        {!compact && painter}
      </>
    );
  } else if (selection.length > 1) {
    items = (
      <>
        {colorsOfSelection()}
        <button type="button" className={btn} onClick={() => st.group()}><Group size={15} />{tr("editor.group")}</button>
        {/* Several elements crop together: grouped first, then cropped. */}
        <button type="button" className={btn} onClick={() => { st.group(); const sel = useEditor.getState().selection; if (sel.length === 1) st.setCropping(sel[0]); }}>
          <Crop size={15} />{tr("editor.crop")}
        </button>
        {transparency}
        {sep}
        {position}
      </>
    );
  } else {
    // Other single nodes (tables, charts, frames...): the shared tools.
    items = (
      <>
        {cropBtn}
        {transparency}
        {sep}
        {more(<>{animation}{position}</>)}
      </>
    );
  }

  return (
    <div ref={outerRef} className="relative z-20 flex h-12 shrink-0 items-center justify-center bg-transparent px-3">
      <div
        ref={pillRef}
        role="toolbar"
        aria-label={tr("editor.editor_tools")}
        className="flex h-10 max-w-full flex-nowrap items-center gap-0.5 rounded-xl border border-neutral-200 bg-surface px-1 shadow-sm"
      >
        {items}
        {sep}
        <button
          type="button"
          title={tr("editor.show_properties")}
          aria-label={tr("editor.show_properties")}
          aria-pressed={propsOpen}
          className={`${ico} ${propsOpen ? on : ""}`}
          onClick={onToggleProps}
        ><PanelRightOpen size={16} /></button>
      </div>
    </div>
  );
}
