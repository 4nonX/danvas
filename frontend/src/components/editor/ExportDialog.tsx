// Download panel. Every format is drawn by the engine in the browser: PNG/JPG
// from a canvas (with the resolution written into the file), SVG and the
// vector PDF and EPS through the vector canvases, the image PDF and TIFF from
// rendered sheets. Print files can be CMYK through an ICC profile (PDF with
// the profile as output intent, optionally PDF/X-4), carry bleed and crop
// marks, registration-colour marks and a die line in a spot colour.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { compileAttribution, attributionText } from "@hc/stock";
import { AlertTriangle, ShieldAlert, Image as ImageIcon, FileText, Shapes, Download, Film, Printer, Eye, ScanSearch } from "lucide-react";
import { rasterDimensions, encodeApng, encodeGif, designPageToLottie, deckToPptx, type PptxImage, type PptxRaster } from "@hc/export";
import { worldAABB } from "@hc/editor";
import { resolveAssetUrl } from "@/lib/sdk";
import { zipFiles, type ZipEntry } from "@/lib/zip";
import type { BrandKit, BrandLintResult, ColorLibrary, ColorLibraryEntry } from "@hc/sdk";
import {
  createScene,
  renderScene,
  poseDesignAt,
  pageAnimationDuration,
  planDeckFrames,
  renderTransitionPair,
  measureFnFor,
  morphPlan,
  morphDesignAt,
  type CanvasLike,
  type Viewport,
  type DeckFrame,
} from "@hc/engine";
import { serializeOutlineMarkdown, type OutlinePageLike } from "@hc/aistudio";
import type { DesignFile } from "@hc/schema";
import { useEditor } from "@/store/editor";
import { prefersReducedMotion } from "@/lib/theme";
import { useBrand } from "@/store/brand";
import { CodedError, userMessage } from "@/lib/errors";
import { imageAssets } from "@/lib/assetProvider";
import { oc } from "@/lib/sdk";
import { useToast } from "@/components/ui/Toast";
import { baseCatalog, interpolate, translate, tr } from "@/lib/i18n";
import { resolvedLocale } from "@/lib/locale";
import { colorListPdf, colorListRows, collectDesignColors, fitsLatin1, type ColorListLabels, type ColorUseKind } from "@/lib/print/colorReport";
import { copyText } from "@/lib/clipboard";
import { ManageProfilesLinks } from "@/components/editor/ManageProfilesLinks";
import { designProfileId, listProfileOptions, profileBytes, type ProfileOption } from "@/lib/print/profiles";
import type { CmykConverter, RenderingIntent } from "@/lib/print/cms";
import { defaultTacLimit } from "@/lib/print/proof";
import { spotNamesOf } from "@/lib/print/printColor";
import { prepressDoc, type PrepressOptions } from "@/lib/print/prepressDoc";
import { initialPrintOverride, printAdditions, printSheet, pxToMm, withPrintOverride, type PrintExtras, type PrintOverride, type PrintParts } from "@/lib/print/sheet";
import { pageBleed } from "@hc/engine";
import { imagePdfBlob, rasterBlob, renderPageCanvas, tiffBlob } from "@/lib/exportFormats";
import { hycBlob } from "@/lib/hycFile";
import { BARCODE_MIN_PX, exportIssues, HAIRLINE_PT, PRINT_MIN_PPI, SMALL_TEXT_PT, type ExportIssue } from "@/lib/exportIssues";
import { describeSettings, normalizeSettings, sameSettings, type ExportSettings } from "@/lib/exportProfiles";
import { ProfileBar } from "./ProfileBar";
import { ImposeFields } from "./ImposeFields";
import { TrimSizeFields } from "./TrimSizeFields";
import { mismatchText, trimMismatch, trimSizeText, type TrimSize } from "@/lib/trimSize";
import { usePrintClearance } from "@/lib/printApproval";
import { defaultImposeSettings, sheetSizeMm, type ImposeSettings } from "@/lib/print/impose";
import { ProofView } from "./ProofView";
import { OutputCheckView } from "./OutputCheckView";
import { whenRenderable } from "@/lib/loadDesignForExport";
import { BleedField, BleedInput, MarkFields, MarkInputs, setPagesBleed, setPagesMarks } from "./PrintSettings";

type Format = "png" | "jpg" | "pdf" | "svg" | "apng" | "gif" | "lottie" | "mp4" | "pptx" | "md" | "hyc" | "tiff" | "eps";

// `acronym` is the chip label: a file-format name, never translated. `label`
// stays the full human name used in toasts and the selected-format line.
// `group` buckets the nine formats so the grid reads as three small decisions
// (what KIND of file) rather than one nine-way one.
type FormatGroup = "image" | "document" | "print" | "motion";

const formats = (): { value: Format; label: string; acronym: string; group: FormatGroup; suffix: string; desc: string; icon: typeof ImageIcon; badge?: string }[] => [
  { value: "png", label: "PNG", acronym: "PNG", group: "image", suffix: "png", desc: tr("editor.high_quality_supports_transparency"), icon: ImageIcon, badge: tr("editor.recommended") },
  { value: "jpg", label: "JPG", acronym: "JPG", group: "image", suffix: "jpg", desc: tr("editor.small_file_size_best_for_photos"), icon: ImageIcon },
  { value: "svg", label: "SVG", acronym: "SVG", group: "image", suffix: "svg", desc: tr("editor.editable_vector_graphic"), icon: Shapes },
  { value: "pdf", label: "PDF", acronym: "PDF", group: "document", suffix: "pdf", desc: tr("editor.best_for_documents_and_printing"), icon: FileText },
  { value: "pptx", label: tr("editor.powerpoint_pptx"), acronym: "PPTX", group: "document", suffix: "pptx", desc: tr("editor.editable_slides_for_powerpoint_keynote_google"), icon: FileText },
  { value: "md", label: tr("editor.markdown_outline"), acronym: "MD", group: "document", suffix: "md", desc: tr("editor.slide_structure_and_text_as_a_markdown_outline"), icon: FileText },
  { value: "hyc", label: tr("editor.hyc_format"), acronym: "HYC", group: "document", suffix: "hyc", desc: tr("editor.hyc_format_desc"), icon: FileText },
  { value: "tiff", label: "TIFF", acronym: "TIFF", group: "print", suffix: "tif", desc: tr("editor.tiff_desc"), icon: Printer },
  { value: "eps", label: "EPS", acronym: "EPS", group: "print", suffix: "eps", desc: tr("editor.eps_desc"), icon: Printer },
  { value: "apng", label: tr("editor.animated_png"), acronym: "APNG", group: "motion", suffix: "apng", desc: tr("editor.plays_the_deck_or_page_with_transitions_loss"), icon: ImageIcon },
  { value: "gif", label: tr("editor.animated_gif"), acronym: "GIF", group: "motion", suffix: "gif", desc: tr("editor.plays_the_deck_or_page_with_transitions_wide"), icon: ImageIcon },
  { value: "lottie", label: tr("editor.lottie"), acronym: "Lottie", group: "motion", suffix: "json", desc: tr("editor.vector_animation_json_lottie_web_after_effec"), icon: Shapes },
  { value: "mp4", label: tr("editor.video_mp4"), acronym: "MP4", group: "motion", suffix: "mp4", desc: tr("editor.the_whole_deck_as_a_video_slide_timing_eleme"), icon: Film },
];

const formatGroups = (): { id: FormatGroup; label: string }[] => [
  { id: "image", label: tr("editor.format_group_image") },
  { id: "document", label: tr("editor.format_group_document") },
  { id: "print", label: tr("editor.format_group_print") },
  { id: "motion", label: tr("editor.format_group_animation_video") },
];


/** Image-asset bytes for the PPTX exporter: fetch the asset URL; PowerPoint
 *  accepts png/jpeg natively, anything else transcodes to PNG via a canvas. */
async function pptxImageResolver(doc: import("@hc/schema").DesignFile, assetId: string): Promise<PptxImage | null> {
  const ref = doc.assets?.find((a) => a.id === assetId);
  if (!ref?.url) return null;
  try {
    const res = await fetch(resolveAssetUrl(ref.url), { credentials: "include" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const mime = blob.type || ref.mime || "image/png";
    if (mime === "image/png" || mime === "image/jpeg") {
      return { data: new Uint8Array(await blob.arrayBuffer()), mime };
    }
    // Transcode (webp/svg/...) to PNG so the package stays universally openable.
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext("2d")?.drawImage(bmp, 0, 0);
    const png: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/png"));
    return png ? { data: new Uint8Array(await png.arrayBuffer()), mime: "image/png" } : null;
  } catch {
    return null;
  }
}

/** Raster fallback for PPTX: render ONE node (its rendered bounds, ancestors'
 *  transforms applied) to a PNG at 2x, hiding every unrelated node. Keeps
 *  charts/paths/ink/tables visually intact inside the exported slides. */
async function pptxNodeRasterizer(doc: import("@hc/schema").DesignFile, pageIndex: number, nodeId: string): Promise<PptxRaster | null> {
  const box = worldAABB(doc, nodeId);
  const pg = doc.pages[pageIndex];
  if (!box || !pg || box.width <= 0 || box.height <= 0) return null;
  // Visible set: the node, its descendants, and its ancestor chain (so nested
  // targets render); everything else on the page hides.
  const keep = new Set<string>([nodeId]);
  const chain = (nodes: import("@hc/schema").Node[], anc: string[]): boolean => {
    for (const n of nodes) {
      const kids = (n as { children?: import("@hc/schema").Node[] }).children ?? [];
      if (n.id === nodeId || chain(kids, [...anc, n.id])) {
        for (const a of anc) keep.add(a);
        if (n.id === nodeId) {
          const collect = (ns: import("@hc/schema").Node[]) => {
            for (const k of ns) { keep.add(k.id); collect((k as { children?: import("@hc/schema").Node[] }).children ?? []); }
          };
          collect(kids);
          keep.add(n.id);
        }
        return true;
      }
    }
    return false;
  };
  chain(pg.children as import("@hc/schema").Node[], []);
  const hiddenIds = new Set<string>();
  const walkAll = (ns: import("@hc/schema").Node[]) => {
    for (const n of ns) {
      if (!keep.has(n.id)) hiddenIds.add(n.id);
      walkAll(((n as { children?: import("@hc/schema").Node[] }).children ?? []) as import("@hc/schema").Node[]);
    }
  };
  walkAll(pg.children as import("@hc/schema").Node[]);

  const RASTER_SCALE = 2;
  const w = Math.max(1, Math.round(box.width * RASTER_SCALE));
  const h = Math.max(1, Math.round(box.height * RASTER_SCALE));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const vp: Viewport = { zoom: RASTER_SCALE, panX: box.x, panY: box.y, dpr: 1, width: box.width, height: box.height };
  renderScene(createScene(doc, pageIndex), ctx as unknown as CanvasLike, vp, { assets: imageAssets, skipBackground: true, hiddenIds });
  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/png"));
  if (!blob) return null;
  return { png: new Uint8Array(await blob.arrayBuffer()), x: box.x, y: box.y, width: box.width, height: box.height };
}

/**
 * Render one planned deck frame (doc 28 FR-19): either a posed slide or a
 * transition composite between two slides, drawn through the same pure
 * `@hc/engine` compositor present mode and the web player use, so an exported
 * deck animates exactly as it presents.
 */
function renderDeckFrame(
  doc: import("@hc/schema").DesignFile,
  frame: DeckFrame,
  scale: number,
  opaque: boolean,
): HTMLCanvasElement | null {
  if (frame.kind === "slide") {
    return renderPageCanvas(poseDesignAt(doc, frame.pageIndex, frame.tMs), frame.pageIndex, scale, opaque);
  }
  // A transition composite: pose both slides, then blend them.
  const { fromIndex, toIndex, transition, progress, toTMs } = frame;
  const exitProgress = (frame as { exitProgress?: number }).exitProgress;
  const pg = doc.pages[toIndex];
  if (!pg) return null;
  const w = Math.max(1, Math.round(pg.width * scale));
  const h = Math.max(1, Math.round(pg.height * scale));
  const dest = document.createElement("canvas");
  dest.width = w;
  dest.height = h;
  const ctx = dest.getContext("2d");
  if (!ctx) return null;

  // Magic Move: hide the shared elements in both buffers so the compositor
  // cross-fades only the non-shared content; the tweened layer is drawn on top.
  const fromPosed = poseDesignAt(doc, fromIndex, Number.MAX_SAFE_INTEGER); // leaving slide, settled
  const toPosed = poseDesignAt(doc, toIndex, toTMs); // arriving slide, entering
  const morph = transition.type === "morph" ? morphPlan(fromPosed, fromIndex, toPosed, toIndex) : null;
  if (morph) {
    for (const n of morph.fromNodes.values()) (n as { hidden?: boolean }).hidden = true;
    for (const n of morph.toNodes.values()) (n as { hidden?: boolean }).hidden = true;
  }
  const bufA = renderPageCanvas(fromPosed, fromIndex, scale, opaque);
  const bufB = renderPageCanvas(toPosed, toIndex, scale, opaque);
  if (!bufA || !bufB) return null;

  // v22: honor the leaving page's exit transition in the exported playthrough
  // exactly as present mode composites it.
  const exitT = (doc.pages[fromIndex] as { transitionOut?: import("@hc/schema").PageTransition } | undefined)?.transitionOut;
  renderTransitionPair(ctx as unknown as CanvasLike, transition, exitT, {
    from: bufA,
    to: bufB,
    width: w,
    height: h,
    progress,
    ...(exitProgress !== undefined ? { exitProgress } : {}),
    background: opaque ? "#ffffff" : "transparent",
  });

  if (morph && morph.ids.length) {
    // `morphDesignAt` reads the (hidden) shared nodes it planned, so unhiding
    // first would not change the tween; render the tweened layer as planned.
    const enterDur = transition.type !== "none" && transition.durationMs > 0 ? transition.durationMs : 0;
    const linearProgress = enterDur > 0 ? Math.min(1, Math.max(0, toTMs / enterDur)) : 1;
    const tweened = morphDesignAt(morph, toPosed, toIndex, progress, { linearProgress, measure: measureFnFor(ctx as unknown as CanvasLike) ?? undefined });
    for (const n of tweened.pages[toIndex].children) (n as { hidden?: boolean }).hidden = false;
    const vp: Viewport = { zoom: scale, panX: 0, panY: 0, dpr: 1, width: w, height: h };
    try {
      renderScene(createScene(tweened, toIndex), ctx as unknown as CanvasLike, vp, {
        assets: imageAssets,
        skipBackground: true,
      });
    } catch {
      /* a cross-origin image can throw; keep the composited frame */
    }
  }
  return dest;
}

// The colour list's labels: the user's language when the PDF's built-in font
// can show it, else English.
function colorListLabels(info: { design: string; profile: string; brand?: string; library?: string; date: string }, images: number): ColorListLabels {
  // Shadows tr so the keys stay literal tr() calls (the catalog check reads them).
  const tr = (key: string, params?: Record<string, unknown>) => {
    const s = translate(key, params);
    if (fitsLatin1(s)) return s;
    const k = typeof params?.count === "number" ? `${key}.${params.count === 1 ? "one" : "other"}` : key;
    return interpolate(baseCatalog[k] ?? baseCatalog[key] ?? s, params);
  };
  const uses: Record<ColorUseKind, string> = {
    fill: tr("editor.color_list_use_fill"), stroke: tr("editor.color_list_use_stroke"), text: tr("editor.color_list_use_text"),
    gradient: tr("editor.color_list_use_gradient"), background: tr("editor.color_list_use_background"), effect: tr("editor.color_list_use_effect"),
  };
  return {
    title: tr("editor.color_list_title"),
    meta: [
      [tr("editor.color_list_design"), info.design],
      [tr("editor.color_list_profile"), info.profile],
      ...(info.brand ? [[tr("editor.color_list_brand"), info.brand] as [string, string]] : []),
      ...(info.library ? [[tr("editor.color_list_library"), info.library] as [string, string]] : []),
      [tr("editor.color_list_date"), info.date],
    ],
    columns: {
      color: tr("editor.color_list_col_color"), print: tr("editor.color_list_col_print"), lab: tr("editor.color_list_col_lab"),
      brand: tr("editor.color_list_col_brand"), nearest: tr("editor.color_list_col_nearest"), used: tr("editor.color_list_col_used"),
    },
    spot: tr("editor.color_list_spot"),
    exact: tr("editor.color_list_exact"),
    converted: tr("editor.color_list_converted"),
    uses,
    page: tr("editor.color_list_page"),
    images: images > 0 ? tr("editor.color_list_images", { count: images }) : null,
    note: tr("editor.color_list_note"),
    none: tr("editor.color_list_none"),
  };
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Revoked later: some browsers start reading the blob only after click()
  // returns, and a revoked URL cancels the download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SIZE_STEPS = [0.5, 1, 2, 3] as const;

// Natively focusable, currently-enabled elements within the panel (same focus
// trap contract as ui/Modal).
const FOCUSABLE =
  'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, object, embed, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** Export outside the editor (dashboard): the designs to export, already
 *  loaded. One design gets the full dialog; several export every page of
 *  each into one zip, a folder per design. */
export interface ExportTarget { id: string; doc: DesignFile; folderId?: string | null }

// The design with a fixed bleed and marks, kept per design and setting, so
// the proof view does not redo its work on every render of the menu.
const overridden = new WeakMap<DesignFile, { key: string; doc: DesignFile }>();
/** prepressDoc for the proof view, cached per design and options so a
 *  re-render does not copy the design again. */
const prepressed = new WeakMap<DesignFile, { key: string; doc: DesignFile }>();
function prepressedDoc(doc: DesignFile, o: PrepressOptions): DesignFile {
  const key = JSON.stringify(o);
  const hit = prepressed.get(doc);
  if (hit && hit.key === key) return hit.doc;
  const out = prepressDoc(doc, null, o).doc;
  prepressed.set(doc, { key, doc: out });
  return out;
}

function overriddenDoc(doc: DesignFile, o: PrintOverride): DesignFile {
  const key = JSON.stringify(o);
  const hit = overridden.get(doc);
  if (hit && hit.key === key) return hit.doc;
  const out = withPrintOverride(doc, o);
  overridden.set(doc, { key, doc: out });
  return out;
}

/** Where an export check issue is: "p. 1: Title, Footer; p. 2: ...". */
function issueWhere(i: ExportIssue): string {
  const byPage = new Map<number, string[]>();
  for (const w of i.where) byPage.set(w.page, [...(byPage.get(w.page) ?? []), w.element]);
  return [...byPage].map(([page, els]) => {
    const shown = els.slice(0, 3).join(", ");
    return tr("editor.export_issue_page", { page, elements: els.length > 3 ? `${shown} +${els.length - 3}` : shown });
  }).join("; ");
}

/** One issue as a sentence (shared with the print dialog). */
export function issueText(i: ExportIssue): string {
  const where = issueWhere(i);
  if (i.kind === "font") return tr("editor.export_issue_font", { subject: i.subject, where });
  if (i.kind === "font-outline") return tr("editor.export_issue_font_outline", { subject: i.subject, where });
  if (i.kind === "hairline") return tr("editor.export_issue_hairline", { subject: i.subject, min: HAIRLINE_PT, where });
  if (i.kind === "small-rich-text") return tr("editor.export_issue_small_rich_text", { subject: i.subject, size: SMALL_TEXT_PT, where });
  if (i.kind === "edge-no-bleed") return tr("editor.export_issue_edge_no_bleed", { where });
  if (i.kind === "edge-not-extended") return tr("editor.export_issue_edge_not_extended", { where });
  if (i.kind === "image-resolution") return tr("editor.export_issue_image_resolution", { subject: i.subject, ppi: i.ppi ?? 0, min: PRINT_MIN_PPI, where });
  if (i.kind === "barcode-invalid") return tr("editor.export_issue_barcode_invalid", { subject: i.subject, where });
  if (i.kind === "barcode-small") return tr("editor.export_issue_barcode_small", { subject: i.subject, where });
  if (i.kind === "barcode-quiet") return tr("editor.export_issue_barcode_quiet", { subject: i.subject, where });
  if (i.kind === "barcode-light") return tr("editor.export_issue_barcode_light", { subject: i.subject, where });
  if (i.kind === "barcode-inks") return tr("editor.export_issue_barcode_inks", { subject: i.subject, where });
  if (i.kind === "barcode-raster") return tr("editor.export_issue_barcode_raster", { subject: i.subject, min: BARCODE_MIN_PX, where });
  return tr("editor.export_issue_image", { subject: i.subject, where });
}

export function ExportDialog({ open, onClose, designs, workspaceId: workspaceIdProp, onRequestApproval, onReformat }: { open: boolean; onClose: () => void; designs?: ExportTarget[]; workspaceId?: string | null; onRequestApproval?: () => void; onReformat?: (designIds: string[], size: TrimSize) => void }) {
  const toast = useToast();
  const storeActivePage = useEditor((s) => s.activePage);
  const activePage = designs ? 0 : storeActivePage;
  const bulk = (designs?.length ?? 0) > 1;
  // Editor rev drives a debounced gate re-fetch so fixing violations in the
  // Brand panel while this dialog is open keeps the block/warn state current.
  const rev = useEditor((s) => s.rev);
  const brandDesignId = useBrand((s) => s.designId);
  const designId = designs ? (designs[0]?.id ?? null) : brandDesignId;
  // Credits compiled from node provenance (attribution-required stock assets,
  // e.g. CC-BY emoji): shown with a copy button so publishing stays compliant.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const credits = useMemo(() => (open ? (designs ?? [{ doc: useEditor.getState().doc }]).flatMap((d) => compileAttribution(d.doc)) : []), [open, rev, designs]);
  const [format, setFormat] = useState<Format>("png");
  // PDF flavor: "vector" (print quality: vector shapes, outlined text, images
  // at full resolution, true physical size), "image" (each page flattened to
  // one picture at the chosen size), "tagged" (accessible, doc 28 FR-22: the
  // vector PDF plus a structure tree and a real-text layer).
  const [pdfMode, setPdfMode] = useState<"vector" | "image" | "tagged">("vector");
  const taggedPdf = pdfMode === "tagged";
  const [scale, setScale] = useState(1);
  const [transparent, setTransparent] = useState(true);
  const [quality, setQuality] = useState(92); // jpg quality 0..100
  const [zipBatch, setZipBatch] = useState(true); // bundle multi-page non-PDF exports into one .zip
  const [selected, setSelected] = useState<number[]>([]); // page indices to export
  // Print formats (TIFF, EPS): CMYK through an ICC output profile, or RGB.
  // The editor knows its design's workspace; the dashboard passes its own
  // (the brand store is only set in the editor).
  const brandWorkspaceId = useBrand((s) => s.workspaceId);
  const workspaceId = workspaceIdProp ?? brandWorkspaceId;
  // Print files only after approval (F47): the designs this menu is for.
  const approvalIds = useMemo(() => (designs ? designs.map((d) => d.id) : brandDesignId ? [brandDesignId] : []), [designs, brandDesignId]);
  const clearance = usePrintClearance(open, workspaceId, approvalIds);
  const editorFolderId = useBrand((s) => s.folderId);
  const folderIds = useMemo(() => (designs ? designs.map((d) => d.folderId ?? null) : [editorFolderId]), [designs, editorFolderId]);
  const [printColor, setPrintColor] = useState<"cmyk" | "rgb">("cmyk");
  const [profiles, setProfiles] = useState<ProfileOption[] | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [intent, setIntent] = useState<RenderingIntent>("relative");
  const [blackOnly, setBlackOnly] = useState(true);
  // The print shop's total ink limit, per cent; null: the paper's usual.
  const [tacLimit, setTacLimit] = useState<number | null>(null);
  // Prepress for any format: whole-mm finished size, artwork into the bleed.
  const [roundMm, setRoundMm] = useState(false);
  const [extendBleed, setExtendBleed] = useState(true);
  // The finished size the profile is made for (F48); null: any size.
  const [trimSize, setTrimSize] = useState<TrimSize | null>(null);
  // Several pages on one sheet (F45; vector and image PDF).
  const [impose, setImpose] = useState<ImposeSettings>(() => defaultImposeSettings());
  const [proofOpen, setProofOpen] = useState(false);
  // The output check needs Ghostscript on the instance.
  const [checkOpen, setCheckOpen] = useState(false);
  const [checkAvailable, setCheckAvailable] = useState(false);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void oc.outputCheckAvailable().then((r) => { if (!cancelled) setCheckAvailable(r.available); }, () => undefined);
    return () => { cancelled = true; };
  }, [open]);
  const [tiffDpi, setTiffDpi] = useState(300);
  // Print-shop options of the CMYK and vector print files.
  const [overprintBlack, setOverprintBlack] = useState(true);
  const [pdfx, setPdfx] = useState(true);
  // The colour list beside a CMYK print export, with the nearest entries of
  // one of the workspace's colour libraries.
  const [colorList, setColorList] = useState(false);
  const [colorLibraries, setColorLibraries] = useState<ColorLibrary[] | null>(null);
  const [colorLibraryId, setColorLibraryId] = useState<string>("");
  const [registration, setRegistration] = useState(true);
  const [dieLine, setDieLine] = useState<{ on: boolean; name: string; radiusMm: number }>(() => ({ on: false, name: tr("editor.die_line_default_name"), radiusMm: 2 }));
  // Print exports include each page's bleed and crop marks (set per page in
  // the page panel), each switchable on its own; both off is the bare page.
  const [withBleed, setWithBleed] = useState(true);
  const [withMarks, setWithMarks] = useState(true);
  // From the dashboard, one bleed and one set of marks apply to every design
  // exported (the designs themselves are not changed), starting from what
  // the first of them sets.
  const [override, setOverride] = useState<PrintOverride>(() => initialPrintOverride((designs ?? [{ doc: useEditor.getState().doc }]).map((d) => d.doc)));
  // Where bleed and crop marks come from: the pages (designs) themselves, or
  // one setting for this export ("fixed"), the designs unchanged. Fixed is
  // the dashboard's default; an export profile stores either.
  const [printSource, setPrintSource] = useState<"page" | "fixed">(designs ? "fixed" : "page");
  const [busy, setBusy] = useState(false);
  // Brand pre-export gate. 'block' policy with violations refuses
  // the export; 'warn' shows a dismissible warning; 'off' is invisible.
  const [gate, setGate] = useState<BrandLintResult | null>(null);
  const [warnDismissed, setWarnDismissed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  // Stable ids tying the visual-only field labels to their controls.
  const baseId = useId();
  const formatLabelId = `${baseId}-format`;
  const sizeLabelId = `${baseId}-size`;

  const doc = designs?.[0]?.doc ?? useEditor.getState().doc;
  const pageCount = doc.pages.length;

  const isPrint = format === "tiff" || format === "eps";
  // CMYK through a profile: the print formats and the PDFs for print.
  const cmykCapable = isPrint || (format === "pdf" && pdfMode !== "tagged");
  // Formats that carry bleed and crop marks (and the prepress options).
  const sheetCapable = isPrint || format === "png" || format === "jpg" || format === "svg" || (format === "pdf" && pdfMode !== "tagged");
  // Vector print files: spot colours (registration marks, die line) and
  // black overprint.
  const vectorPrint = format === "eps" || (format === "pdf" && pdfMode === "vector");
  useEffect(() => {
    if (!open || !cmykCapable || profiles) return;
    let cancelled = false;
    void listProfileOptions(workspaceId).then((list) => {
      if (cancelled) return;
      setProfiles(list);
      // The design's own profile (page panel) when set, else the default.
      setProfileId((cur) => cur ?? designProfileId(list, doc.colorProfile));
    });
    return () => { cancelled = true; };
  }, [open, cmykCapable, profiles, workspaceId, doc.colorProfile]);
  useEffect(() => {
    if (!open || !workspaceId || colorLibraries) return;
    let cancelled = false;
    void oc.listColorLibraries(workspaceId).then(
      (l) => { if (!cancelled) { setColorLibraries(l); setColorLibraryId((cur) => cur || (l[0]?.id ?? "")); } },
      () => { if (!cancelled) setColorLibraries([]); },
    );
    return () => { cancelled = true; };
  }, [open, workspaceId, colorLibraries]);
  // A profile's print profile that this workspace does not have (a personal
  // profile made in another one) falls back to the default.
  useEffect(() => {
    if (!profiles || !profileId || profiles.some((p) => p.id === profileId)) return;
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) setProfileId(designProfileId(profiles, doc.colorProfile)); });
    return () => { cancelled = true; };
  }, [profiles, profileId, doc.colorProfile]);

  // The menu's settings as an export profile stores them.
  const currentSettings: ExportSettings = {
    v: 1, format, pdfMode, scale, transparent, quality, zip: zipBatch, tiffDpi,
    color: printColor, iccProfileId: profileId, intent, blackOnly, overprintBlack, pdfx, registration, dieLine, tacLimit, roundMm, extendBleed,
    print: printSource === "fixed" ? { source: "fixed", override } : { source: "page", bleed: withBleed, marks: withMarks },
    impose,
    trimSize,
  };
  function applySettings(raw: ExportSettings) {
    const s = normalizeSettings(raw);
    setFormat(s.format);
    setPdfMode(s.pdfMode);
    setScale(s.scale);
    setTransparent(s.transparent);
    setQuality(s.quality);
    setZipBatch(s.zip);
    setTiffDpi(s.tiffDpi);
    setPrintColor(s.color);
    if (s.iccProfileId) setProfileId(s.iccProfileId);
    setIntent(s.intent);
    setBlackOnly(s.blackOnly);
    setTacLimit(s.tacLimit);
    setRoundMm(s.roundMm);
    setExtendBleed(s.extendBleed);
    setImpose(s.impose);
    setTrimSize(s.trimSize);
    setOverprintBlack(s.overprintBlack);
    setPdfx(s.pdfx);
    setRegistration(s.registration);
    setDieLine(s.dieLine);
    if (s.print.source === "fixed") {
      setOverride(s.print.override);
      setPrintSource("fixed");
    } else {
      setWithBleed(s.print.bleed);
      setWithMarks(s.print.marks);
      setPrintSource("page");
    }
  }

  // Default the page selection when the panel opens or the format changes.
  // Animated formats on a multi-page deck default to the WHOLE deck, so the
  // export plays the presentation through with its transitions (doc 28 FR-19);
  // everything else defaults to the current page. Narrowing to one page is
  // still a deliberate click. Deferred out of the effect body (Promise
  // microtask) to avoid a synchronous setState-in-effect, matching the gate
  // effects below.
  const animatedDeck = (format === "apng" || format === "gif") && pageCount > 1;
  // Keyed on `open` + whether the animated-deck default applies, so choosing a
  // format re-defaults the selection but a later manual narrow (Current / a
  // page toggle) sticks: this effect does not re-run on `selected`.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setSelected(animatedDeck ? Array.from({ length: pageCount }, (_, i) => i) : [Math.min(activePage, pageCount - 1)]);
    });
    return () => { cancelled = true; };
  }, [open, activePage, pageCount, animatedDeck]);

  // Run the gate when the panel opens for a saved design. All state updates run
  // inside the async flow (Promise callbacks) so the effect body stays clean.
  useEffect(() => {
    let cancelled = false;
    if (!open || !designId) {
      void Promise.resolve().then(() => { if (!cancelled) setGate(null); });
      return () => { cancelled = true; };
    }
    void Promise.resolve()
      .then(() => { if (!cancelled) setWarnDismissed(false); })
      .then(() => oc.brandLintGate(designId))
      .then((r) => { if (!cancelled) setGate(r); })
      .catch(() => { if (!cancelled) setGate(null); });
    return () => { cancelled = true; };
  }, [open, designId]);

  // Re-fetch the gate (debounced) when the design changes while the panel is
  // open, so resolving violations in the Brand panel updates block/warn here.
  useEffect(() => {
    let cancelled = false;
    if (!open || !designId) return;
    const t = setTimeout(() => {
      void oc.brandLintGate(designId)
        .then((r) => { if (!cancelled) setGate(r); })
        .catch(() => {});
    }, 600);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev]);

  // Export check: fonts and images the file would silently replace or leave
  // out, and (vector formats) text that would become a picture. Shown, never
  // blocking; recomputed when the format, the pages or the design change.
  const [issues, setIssues] = useState<{ design: string; list: ExportIssue[] }[]>([]);
  const rendersDesign = format !== "hyc" && format !== "md" && format !== "lottie";
  const vectorOut = format === "svg" || format === "eps" || (format === "pdf" && pdfMode !== "image");
  const printOut = format === "pdf" || format === "tiff" || format === "eps";
  const overrideBleed = override.bleed;
  // The pages exported (as `pages` below, which comes after the early return).
  const pagesKey = (selected.length ? [...selected].sort((a, b) => a - b) : [Math.min(activePage, pageCount - 1)]).join(",");
  useEffect(() => {
    if (!open || !rendersDesign) return;
    let cancelled = false;
    void (async () => {
      const targets = bulk
        ? designs!.map((d) => ({ design: d.doc.title || tr("editor.untitled"), doc: d.doc, pages: d.doc.pages.map((_, i) => i) }))
        : [{ design: "", doc: designs?.[0]?.doc ?? useEditor.getState().doc, pages: pagesKey.split(",").map(Number) }];
      const out: { design: string; list: ExportIssue[] }[] = [];
      // The print preflight converts colours as the export will.
      let conv: CmykConverter | null = null;
      if (printOut && cmykCapable && printColor === "cmyk" && profileId) {
        try {
          const { createCmykConverter } = await import("@/lib/print/cms");
          conv = await createCmykConverter(await profileBytes(profileId), intent);
        } catch { conv = null; }
      }
      try {
        for (const t of targets) {
          await whenRenderable(t.doc);
          const bleed = printSource === "fixed" ? overrideBleed : withBleed && t.pages.some((i) => !!t.doc.pages[i] && pageBleed(t.doc.pages[i]) > 0);
          // What the extension into the bleed cannot reach (it runs on the
          // copy the export makes; listed here like any other issue).
          const prepressed = sheetCapable && extendBleed && (printSource === "fixed" ? overrideBleed : withBleed)
            ? prepressDoc(printSource === "fixed" ? withPrintOverride(t.doc, override) : t.doc, t.pages, { roundToMm: roundMm, extendIntoBleed: true }).notExtended
            : [];
          const list = await exportIssues(t.doc, t.pages, {
            vector: vectorOut,
            print: printOut,
            printCheck: { cmyk: conv ? (r, g, b) => conv!.cmyk(r, g, b) : null, blackOnly: vectorPrint && blackOnly, bleed },
            backgroundLabel: tr("editor.export_issue_page_background"),
            // Output pixels per inch of the raster formats (barcode modules need enough of them).
            rasterDpi: vectorOut ? undefined : format === "tiff" ? tiffDpi : (t.doc.dpi ?? 96) * scale,
          });
          if (prepressed.length) list.push({ kind: "edge-not-extended", subject: "", where: prepressed });
          if (list.length) out.push({ design: t.design, list });
        }
      } finally {
        conv?.dispose();
      }
      if (!cancelled) setIssues(out);
    })();
    return () => { cancelled = true; };
  }, [open, rendersDesign, vectorOut, printOut, pagesKey, designs, bulk, rev, cmykCapable, printColor, profileId, intent, vectorPrint, blackOnly, printSource, overrideBleed, withBleed, sheetCapable, extendBleed, roundMm, override, format, tiffDpi, scale]);
  const shownIssues = rendersDesign ? issues : [];
  // Designs not in the profile's finished size (F48): warned, not blocked.
  const trimOff = useMemo(() => {
    if (!open || !rendersDesign || !trimSize) return [];
    const targets = bulk
      ? designs!.map((d) => ({ id: d.id, title: d.doc.title || tr("editor.untitled"), doc: d.doc, pages: d.doc.pages.map((_, i) => i) }))
      : [{ id: designs?.[0]?.id ?? "", title: "", doc: designs?.[0]?.doc ?? useEditor.getState().doc, pages: pagesKey.split(",").map(Number) }];
    return targets.flatMap((t) => {
      const m = trimMismatch(t.doc, t.pages, trimSize, sheetCapable && roundMm);
      return m ? [{ id: t.id, title: t.title, text: mismatchText(m, trimSize) }] : [];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rendersDesign, trimSize, bulk, designs, pagesKey, rev, sheetCapable, roundMm]);

  // Dialog focus contract: on open, remember the opener and move focus onto the
  // panel; on close, return focus so keyboard users don't drop to <body>.
  useEffect(() => {
    if (!open) return;
    if (typeof document === "undefined") return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      if (previouslyFocused && typeof previouslyFocused.focus === "function" && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  const gateActive = !!gate && gate.policy !== "off" && gate.violations.length > 0;
  const blocked = !!gate && gate.blocked; // policy 'block' with violations
  // Print files wait for the designs' approval when the workspace says so.
  const printFile = (format === "pdf" && !taggedPdf) || format === "tiff" || format === "eps";
  const approvalBlocked = printFile && clearance.blocked;
  const showWarn = gateActive && gate!.policy === "warn" && !warnDismissed;

  const fmt = formats().find((f) => f.value === format)!;
  const isRaster = format === "png" || format === "jpg";
  // Animated/vector-anim formats export a single file of the active page only.
  const isSingleAnimated = format === "apng" || format === "gif" || format === "lottie";
  const sizable = format !== "svg" && format !== "lottie" && format !== "mp4" && format !== "pptx" && format !== "md" && format !== "tiff" && format !== "eps" && !(format === "pdf" && pdfMode !== "image"); // resolution-independent
  // The page(s) that will actually be exported, sorted; PDF always uses all
  // selected, raster/svg emit one file per selected page.
  const pages = selected.length ? [...selected].sort((a, b) => a - b) : [Math.min(activePage, pageCount - 1)];

  // Live pixel dimensions for the first exported page (design tools commonly show this).
  const refPage = doc.pages[pages[0]] ?? doc.pages[0];
  const fileCount = format === "pdf" || format === "mp4" || format === "pptx" || format === "md" || format === "hyc" || isSingleAnimated ? 1 : pages.length;
  // Bleed and crop marks apply to every image and print format (not the
  // accessible PDF, documents or motion).
  // What the pages being exported set (in the editor).
  const offered: PrintParts = sheetCapable ? printAdditions(pages.map((i) => doc.pages[i]).filter(Boolean)) : { bleed: false, marks: false };
  // "fixed": one bleed and one set of marks for everything exported, the
  // designs unchanged. Otherwise each page's own; in the editor the menu
  // edits them as the page panel does.
  const fixedPrint = printSource === "fixed";
  const printEditable = !designs && !fixedPrint;

  // Export profiles: a profile without its own print profile takes whatever
  // is the default, so the one chosen now is no change from it.
  const iccName = (pid: string) => profiles?.find((p) => p.id === pid)?.name;
  const sameExport = (cur: ExportSettings, saved: ExportSettings) => sameSettings({ ...cur, iccProfileId: saved.iccProfileId === null ? null : cur.iccProfileId }, saved);

  const printSourceToggle = (
    <div role="radiogroup" aria-label={tr("editor.print_source")} className="flex gap-1 rounded-lg bg-neutral-100 p-0.5">
      {(["page", "fixed"] as const).map((src) => (
        <button
          key={src}
          type="button"
          role="radio"
          aria-checked={printSource === src}
          onClick={() => setPrintSource(src)}
          className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${printSource === src ? "bg-surface text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}
        >
          {src === "page" ? (designs ? tr("editor.print_source_designs") : tr("editor.print_source_pages")) : tr("editor.print_source_fixed")}
        </button>
      ))}
    </div>
  );
  // A page without bleed or marks prints as the bare page either way.
  const useSheet: PrintParts = fixedPrint
    ? { bleed: sheetCapable && override.bleed, marks: sheetCapable && override.marks }
    : { bleed: sheetCapable && withBleed, marks: sheetCapable && withMarks };
  // Spot-colour extras of the vector print files.
  const printExtras: PrintExtras | undefined = vectorPrint
    ? { registration: useSheet.marks && registration, dieLine: dieLine.on && dieLine.name.trim() ? { name: dieLine.name.trim(), radiusMm: dieLine.radiusMm } : undefined }
    : undefined;
  // The proof view: CMYK through a profile, the design as exported.
  const proofable = cmykCapable && printColor === "cmyk" && !!profileId;
  const profileName = profiles?.find((p) => p.id === profileId)?.name ?? "";
  const effectiveTac = tacLimit ?? defaultTacLimit(profileName);
  // Rounding and the extension into the bleed, as the export applies them.
  const prepressOpts: PrepressOptions = sheetCapable ? { roundToMm: roundMm, extendIntoBleed: extendBleed && useSheet.bleed } : {};
  const baseProofDoc = fixedPrint && sheetCapable ? overriddenDoc(doc, override) : doc;
  const proofDoc = prepressedDoc(baseProofDoc, prepressOpts);
  // The output check: the real PDF or EPS, separated on the instance.
  const checkable = checkAvailable && proofable && (format === "eps" || (format === "pdf" && pdfMode !== "tagged"));
  const overriddenPage = !fixedPrint || !sheetCapable ? refPage : withPrintOverride({ ...doc, pages: [refPage] }, override).pages[0];
  // The size readouts show the finished size the export will have.
  const sizedPage = roundMm && sheetCapable ? prepressDoc({ ...doc, pages: [overriddenPage] }, null, { roundToMm: true }).doc.pages[0] : overriddenPage;
  const tiffSheet = printSheet(sizedPage, doc.dpi ?? 96, useSheet);
  const tiffDim = rasterDimensions({ width: tiffSheet.sheetWidth, height: tiffSheet.sheetHeight }, { scale: tiffDpi / (doc.dpi ?? 96) }, doc.dpi ?? 96);
  // Pixel size of the first exported page at the chosen size, with its bleed
  // and marks when they are included.
  const dim = rasterDimensions({ width: tiffSheet.sheetWidth, height: tiffSheet.sheetHeight }, { scale }, doc.dpi ?? 96);
  // Imposition applies to the PDF that is drawn page by page (vector or image).
  const imposable = format === "pdf" && !taggedPdf;
  const imposeOpt = imposable && impose.on ? { settings: impose, sheetMm: sheetSizeMm(impose) } : undefined;
  const imposePage = { widthMm: pxToMm(sizedPage.width, doc.dpi ?? 96), heightMm: pxToMm(sizedPage.height, doc.dpi ?? 96), bleedMm: pxToMm(tiffSheet.bleed, doc.dpi ?? 96) };

  function togglePage(i: number) {
    setSelected((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));
  }

  /**
   * Frames for an animated export (doc 28 FR-19). A multi-page deck with no
   * narrowed page selection exports its whole playthrough, transitions
   * included, through the pure `@hc/engine` planner; otherwise it stays a
   * single page's own animation timeline (the shipped behavior). Reduced
   * motion drops transitions, matching the reduced-motion present path.
   */
  function deckPlan(doc: DesignFile, pages: number[]): DeckFrame[] {
    const pageCount = doc.pages.length;
    const fps = 15;
    // More than one page in play means "play the deck through"; exactly one
    // selected page means "export just that page's own animation".
    const wholeDeck = pageCount > 1 && pages.length > 1;
    if (wholeDeck) {
      const reducedMotion = prefersReducedMotion();
      return planDeckFrames(doc, { fps, reducedMotion, maxFrames: 900, pageIndices: pages });
    }
    const idx = pages[0] ?? Math.min(activePage, pageCount - 1);
    const dur = pageAnimationDuration(doc, idx) || 3000;
    const frameCount = Math.max(2, Math.min(150, Math.round((dur / 1000) * fps) + 1));
    const delayMs = Math.round(1000 / fps);
    return Array.from({ length: frameCount }, (_, i) => ({
      kind: "slide" as const,
      pageIndex: idx,
      tMs: (i / (frameCount - 1)) * dur,
      delayMs,
    }));
  }

  /** Export one design's pages through `emit`. `quiet` is the bulk mode:
   *  no per-design toasts, and every file goes to `emit` (no zip, no pacing),
   *  so the caller can bundle all designs. */
  /** The CMYK converter for the chosen profile and intent, or null for RGB.
   *  The caller disposes it. */
  async function makeConverter(): Promise<CmykConverter | null> {
    if (printColor !== "cmyk") return null;
    if (!profileId) throw new CodedError("errors.print_profile_missing", "no print profile");
    const { createCmykConverter } = await import("@/lib/print/cms");
    return createCmykConverter(await profileBytes(profileId), intent);
  }

  async function exportDesign(doc: DesignFile, designId: string | null, pages: number[], emit: (blob: Blob, name: string) => void, quiet: boolean): Promise<void> {
    // A fixed setting gives every design the menu's bleed and marks.
    if (fixedPrint && sheetCapable) doc = withPrintOverride(doc, override);
    // Prepress on a copy: whole-mm size, artwork into the bleed.
    doc = prepressDoc(doc, null, prepressOpts).doc;
    const fileCount = format === "pdf" || format === "mp4" || format === "pptx" || format === "md" || format === "hyc" || isSingleAnimated ? 1 : pages.length;
    const safeBase = (doc.title || "design").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "design";
    const nameFor = (i: number, suffix: string) => (fileCount > 1 ? `${safeBase}-${i + 1}.${suffix}` : `${safeBase}.${suffix}`);

    if (format === "pptx") {
      // PPTX interop export (doc 28): fully client-side; text and mappable
      // shapes stay editable in PowerPoint, everything else embeds as a
      // correctly-placed PNG via the per-node rasterizer.
      const bytes = await deckToPptx(doc, {
        title: doc.title,
        resolveImage: (assetId) => pptxImageResolver(doc, assetId),
        rasterizeNode: (pi, nodeId) => pptxNodeRasterizer(doc, pi, nodeId),
      });
      emit(new Blob([bytes as unknown as BlobPart], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }), `${safeBase}.pptx`);
      if (!quiet) toast.success(tr("editor.downloaded_file", { file: `${safeBase}.pptx` }));
    } else if (format === "hyc") {
      // The design itself in the open file format: every page, as stored.
      emit(hycBlob(doc), `${safeBase}.hyc`);
      if (!quiet) toast.success(tr("editor.downloaded_file", { file: `${safeBase}.hyc` }));
    } else if (format === "md") {
      // Markdown outline (F28 C26): deterministic structure-and-text
      // serialization, entirely client-side.
      const md = serializeOutlineMarkdown(doc.title, doc.pages as unknown as OutlinePageLike[]);
      emit(new Blob([md], { type: "text/markdown" }), `${safeBase}.md`);
      if (!quiet) toast.success(tr("editor.downloaded_file", { file: `${safeBase}.md` }));
    } else if (format === "mp4") {
      // Whole-deck video (doc 28 FR-19): the playthrough present mode shows
      // (animations, transitions, slide timing), drawn frame by frame by the
      // editor's engine and encoded in the browser, so it looks exactly like
      // the design. Small pages are scaled up to a 1920 px long side.
      const { encodeMp4, canEncodeMp4 } = await import("@/lib/video/encodeMp4");
      if (!canEncodeMp4()) throw new CodedError("errors.video_render_failed", "this browser cannot encode video");
      // Exporting only hidden pages still means "these pages".
      const chosen = pages.length ? pages : doc.pages.map((_, i) => i);
      const src = chosen.every((i) => doc.pages[i]?.hidden)
        ? { ...doc, pages: doc.pages.map((p, i) => (chosen.includes(i) ? { ...p, hidden: false } : p)) }
        : doc;
      const fps = 30;
      const plan = planDeckFrames(src, { fps, holdMs: 3000, maxFrames: fps * 60 * 20, pageIndices: chosen, reducedMotion: prefersReducedMotion(), honorAutoAdvance: true });
      if (!plan.length) {
        toast.error(tr("editor.nothing_to_animate_add_an_animation_or_a_sli"));
        return;
      }
      const first = plan[0];
      const pg = src.pages[first.kind === "slide" ? first.pageIndex : first.toIndex];
      const long = Math.max(pg.width, pg.height);
      const vScale = Math.min(3840 / long, Math.max(1, 1920 / long));
      const blob = await encodeMp4({
        width: pg.width * vScale,
        height: pg.height * vScale,
        fps,
        count: plan.length,
        frame: (i) => renderDeckFrame(src, plan[i], vScale, true),
      });
      emit(blob, `${safeBase}.mp4`);
      if (!quiet) toast.success(tr("editor.downloaded_file", { file: `${safeBase}.mp4` }));
    } else if (format === "pdf" && taggedPdf) {
      // Drawn by the editor's engine like the vector PDF, so it looks exactly
      // like the design; the words are real text in the author's reading order.
      const { exportVectorPdf } = await import("@/lib/vectorPdf");
      const out = await exportVectorPdf(doc, pages, { assets: imageAssets, title: doc.title, tagged: true, lang: resolvedLocale() });
      emit(out.blob, `${safeBase}.pdf`);
      if (!quiet) toast.success(tr("editor.downloaded_file", { file: `${safeBase}.pdf` }));
    } else if (format === "tiff" || format === "eps") {
      // Print formats: CMYK through the chosen output profile (embedded in
      // the TIFF), or RGB. One file per page; several pages zip up.
      const converter = await makeConverter();
      try {
        const entries: ZipEntry[] = [];
        for (const i of pages) {
          let blob: Blob | null = null;
          if (format === "eps") {
            const { exportEps } = await import("@/lib/print/eps");
            blob = await exportEps(doc, i, { assets: imageAssets, title: doc.title, converter, blackOnly, overprintBlack: !!converter && blackOnly && overprintBlack, print: useSheet, extras: printExtras });
          } else {
            blob = await tiffBlob(doc, i, { dpi: tiffDpi, converter, print: useSheet });
            if (!blob) continue;
          }
          entries.push({ name: nameFor(i, fmt.suffix), data: new Uint8Array(await blob.arrayBuffer()) });
        }
        if (entries.length === 1) {
          emit(new Blob([entries[0].data as BlobPart], { type: format === "eps" ? "application/postscript" : "image/tiff" }), entries[0].name);
          if (!quiet) toast.success(tr("editor.downloaded_file", { file: entries[0].name }));
        } else if (quiet) {
          for (const e of entries) emit(new Blob([e.data as BlobPart]), e.name);
        } else if (entries.length > 1) {
          emit(zipFiles(entries), `${safeBase}.zip`);
          if (!quiet) toast.success(tr("editor.downloaded_zip_n_pages", { file: `${safeBase}.zip`, count: entries.length, format: fmt.label }));
        }
      } finally {
        converter?.dispose();
      }
    } else if (format === "pdf" && pdfMode === "vector") {
      // CMYK through the profile (embedded as the output intent) or RGB,
      // optionally marked PDF/X-4; spot-colour marks and die line.
      const { exportVectorPdf } = await import("@/lib/vectorPdf");
      const converter = await makeConverter();
      try {
        const out = await exportVectorPdf(doc, pages, {
          assets: imageAssets, title: doc.title, print: useSheet, extras: printExtras, impose: imposeOpt,
          converter, blackOnly, overprintBlack: !!converter && blackOnly && overprintBlack, pdfx: !!converter && pdfx,
        });
        emit(out.blob, `${safeBase}.pdf`);
      } finally {
        converter?.dispose();
      }
      if (!quiet) toast.success(tr("editor.downloaded_file", { file: `${safeBase}.pdf` }));
    } else if (format === "pdf") {
      // One picture per page at the chosen size, in CMYK through the profile
      // or RGB, with the sheet's page boxes.
      const converter = await makeConverter();
      try {
        const blob = await imagePdfBlob(doc, pages, { scale, converter, pdfx, print: useSheet, title: doc.title, impose: imposeOpt });
        if (blob) {
          emit(blob, `${safeBase}.pdf`);
          if (!quiet) toast.success(tr("editor.downloaded_file", { file: `${safeBase}.pdf` }));
        }
      } finally {
        converter?.dispose();
      }
    } else if (format === "apng") {
      // Animated PNG. A multi-page deck exports its whole playthrough,
      // transitions included, via the pure deck planner + compositor (doc 28
      // FR-19); a single page exports its own animation timeline as before.
      const plan = deckPlan(doc, pages);
      const frames: { png: Uint8Array; delayMs: number }[] = [];
      for (const f of plan) {
        const canvas = renderDeckFrame(doc, f, scale, !transparent);
        if (!canvas) continue;
        const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/png"));
        if (blob) frames.push({ png: new Uint8Array(await blob.arrayBuffer()), delayMs: f.delayMs });
      }
      if (frames.length < 2) {
        toast.error(tr("editor.nothing_to_animate_add_an_animation_or_a_sli"));
      } else {
        emit(new Blob([encodeApng(frames, { loops: 0 }) as BlobPart], { type: "image/apng" }), `${safeBase}.apng`);
        if (!quiet) toast.success(tr("editor.downloaded_file_n_frames", { file: `${safeBase}.apng`, count: frames.length }));
      }
    } else if (format === "gif") {
      // Animated GIF: same deck plan as APNG (whole playthrough with
      // transitions for a deck, one page's timeline otherwise), but we grab
      // raw RGBA per frame and quantize to a shared palette in @hc/export.
      const plan = deckPlan(doc, pages);
      let gw = 0;
      let gh = 0;
      const frames: { rgba: Uint8Array; delayMs: number }[] = [];
      for (const f of plan) {
        const canvas = renderDeckFrame(doc, f, scale, !transparent);
        if (!canvas) continue;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        gw = canvas.width;
        gh = canvas.height;
        const img = ctx.getImageData(0, 0, gw, gh);
        frames.push({ rgba: new Uint8Array(img.data.buffer.slice(0)), delayMs: f.delayMs });
      }
      if (frames.length < 2 || !gw || !gh) {
        toast.error(tr("editor.nothing_to_animate_add_an_animation_or_a_sli"));
      } else {
        const gif = encodeGif(frames, { width: gw, height: gh, loops: 0, transparentAlpha: transparent ? 128 : 0 });
        emit(new Blob([gif as BlobPart], { type: "image/gif" }), `${safeBase}.gif`);
        if (!quiet) toast.success(tr("editor.downloaded_file_n_frames", { file: `${safeBase}.gif`, count: frames.length }));
      }
    } else if (format === "lottie") {
      // Vector Lottie JSON of the active page (transforms baked to keyframes).
      const idx = pages[0] ?? Math.min(activePage, pageCount - 1);
      const lottie = designPageToLottie(doc, idx, { fps: 30 });
      emit(new Blob([JSON.stringify(lottie)], { type: "application/json" }), `${safeBase}.json`);
      if (!quiet) toast.success(tr("editor.downloaded_file", { file: `${safeBase}.json` }));
    } else {
      // svg / png / jpg: one rendered file per page. With >1 page and the zip
      // option on, bundle them into a single .zip (batch export, FR); otherwise
      // download each file separately.
      const opaque = format === "jpg" || !transparent;
      const useZip = pages.length > 1 && zipBatch && !quiet;
      const entries: ZipEntry[] = [];
      const vectorSvg = format === "svg" ? (await import("@/lib/vectorPdf")).exportVectorSvg : null;
      const renderBlob = async (i: number): Promise<Blob | null> => {
        // SVG goes through the engine like the vector PDF, so it matches the
        // editor exactly (text as outlines, effects as embedded patches).
        if (vectorSvg) return new Blob([await vectorSvg(doc, i, { assets: imageAssets, print: useSheet })], { type: "image/svg+xml" });
        return rasterBlob(doc, i, { format: format === "png" ? "png" : "jpg", scale, opaque, print: useSheet, quality });
      };
      for (let k = 0; k < pages.length; k++) {
        const blob = await renderBlob(pages[k]);
        if (!blob) continue;
        if (useZip) {
          entries.push({ name: `${safeBase}-${pages[k] + 1}.${fmt.suffix}`, data: new Uint8Array(await blob.arrayBuffer()) });
        } else {
          emit(blob, nameFor(pages[k], fmt.suffix));
          if (!quiet && k < pages.length - 1) await sleep(250);
        }
      }
      if (useZip) {
        emit(zipFiles(entries), `${safeBase}.zip`);
        if (!quiet) toast.success(tr("editor.downloaded_zip_n_pages", { file: `${safeBase}.zip`, count: entries.length, format: fmt.label }));
      } else {
        if (!quiet) toast.success(fileCount > 1 ? tr("editor.downloaded_n_format_files", { count: fileCount, format: fmt.label }) : tr("editor.downloaded_file", { file: `${safeBase}.${fmt.suffix}` }));
      }
    }
  }

  /** The file the download would make, for the output check: the PDF of
   *  the pages, or the EPS of the first one. */
  async function buildForCheck(): Promise<Blob> {
    const files: Blob[] = [];
    await exportDesign(doc, designId, format === "eps" ? [pages[0]] : pages, (b) => files.push(b), true);
    if (!files[0]) throw new Error("nothing was made");
    return files[0];
  }

  const withColorList = colorList && cmykCapable && printColor === "cmyk";

  /** The colour list of one design (see lib/print/colorReport), from the
   *  design as it is (not the prepress copy: marks are not its colours). */
  async function colorListFile(d: DesignFile, id: string | null, library: { name: string; entries: ColorLibraryEntry[] } | null): Promise<{ blob: Blob; name: string }> {
    const converter = await makeConverter();
    if (!converter) throw new CodedError("errors.print_profile_missing", "no print profile");
    const { createLabConverter } = await import("@/lib/print/cms");
    const lab = await createLabConverter();
    try {
      let kit: BrandKit | null = null;
      if (id) kit = (await oc.getDesignBrand(id).catch(() => null))?.kit ?? null;
      else kit = useBrand.getState().kit;
      const used = collectDesignColors(d);
      const rows = colorListRows(used.colors, { converter, srgbLab: (r, g, b) => lab.fromSrgb(r, g, b), kit, library: library?.entries ?? null });
      const profileName = profiles?.find((o) => o.id === profileId)?.name ?? converter.description;
      const info = {
        design: d.title || tr("editor.untitled"),
        profile: `${profileName} (${intent === "perceptual" ? tr("editor.color_list_intent_perceptual") : tr("editor.color_list_intent_relative")})`,
        brand: kit?.name,
        library: library?.name,
        date: new Date().toLocaleString(resolvedLocale()),
      };
      const blob = await colorListPdf(rows, colorListLabels(info, used.images));
      const safeBase = (d.title || "design").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "design";
      return { blob, name: `${safeBase}-${tr("editor.color_list_file")}.pdf` };
    } finally {
      lab.dispose();
      converter.dispose();
    }
  }

  async function colorLibraryForRun(): Promise<{ name: string; entries: ColorLibraryEntry[] } | null> {
    const lib = colorLibraries?.find((l) => l.id === colorLibraryId);
    if (!lib) return null;
    return { name: lib.name, entries: await oc.colorLibraryEntries(lib.id) };
  }

  async function run() {
    // Re-check the gate at the moment of download so a stale block never lets an
    // off-brand export through (every design, when exporting several).
    for (const id of designs ? designs.map((d) => d.id) : [designId]) {
      if (!id) continue;
      try {
        const fresh = await oc.brandLintGate(id);
        if (!bulk) setGate(fresh);
        if (fresh.blocked) { toast.error(tr("editor.resolve_the_brand_violations_before_download")); return; }
      } catch { /* best effort; fall through to local gate */ }
    }
    if (blocked) return;
    setBusy(true);
    try {
      if (!bulk) {
        await whenRenderable(doc);
        await exportDesign(doc, designId, pages, download, false);
        if (withColorList) {
          const list = await colorListFile(doc, designId, await colorLibraryForRun());
          await sleep(400); // a second download right after the first is often dropped
          download(list.blob, list.name);
        }
      } else {
        // Every page of every design, one folder per design, one zip.
        const files: { blob: Blob; name: string }[] = [];
        const folders = new Set<string>();
        const library = withColorList ? await colorLibraryForRun() : null;
        for (const t of designs!) {
          const base = (t.doc.title || "design").replace(/[\\/:*?"<>|]+/g, "-").trim() || "design";
          let folder = base;
          for (let n = 2; folders.has(folder.toLowerCase()); n++) folder = `${base} (${n})`;
          folders.add(folder.toLowerCase());
          await exportDesign(t.doc, t.id, t.doc.pages.map((_, i) => i), (blob, name) => files.push({ blob, name: `${folder}/${name}` }), true);
          if (withColorList) {
            const list = await colorListFile(t.doc, t.id, library);
            files.push({ blob: list.blob, name: `${folder}/${list.name}` });
          }
        }
        const entries: ZipEntry[] = [];
        for (const f of files) entries.push({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) });
        const zipName = `danvas-export-${new Date().toISOString().slice(0, 10)}.zip`;
        download(zipFiles(entries), zipName);
        toast.success(tr("editor.downloaded_n_designs", { count: designs!.length, file: zipName }));
      }
      onClose();
    } catch (e) {
      // Coded failures (render timeout, download status) show their translated
      // detail. Everything else keeps the generic cross-origin hint: the
      // common anonymous failure here is a tainted-canvas SecurityError, whose
      // raw browser message would be far less useful than the hint.
      const fallback = tr("editor.download_failed_an_image_from_another_site_m");
      toast.error(e instanceof CodedError ? userMessage(e, fallback) : fallback);
    } finally {
      setBusy(false);
    }
  }

  // Escape closes the dialog (unless the format dropdown is open, which owns
  // Escape via its own window handler); Tab/Shift+Tab wrap within the panel so
  // focus never escapes it (same trap as ui/Modal).
  const onPanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    if (focusables.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const activeEl = document.activeElement;
    if (e.shiftKey) {
      if (activeEl === first || activeEl === panel) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <>
      {/* Click-away backdrop (transparent; the panel is anchored top-right). */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={tr("editor.download")}
        tabIndex={-1}
        className="fixed end-3 top-14 z-50 max-h-[calc(100vh-5rem)] w-[22rem] overflow-y-auto rounded-2xl border border-neutral-200 bg-surface p-4 shadow-2xl outline-none ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onPanelKeyDown}
      >
        <h2 className={`${designs ? "mb-0.5" : "mb-3"} text-base font-semibold text-neutral-900`}>{tr("editor.download")}</h2>
        {designs && (
          <p className="mb-3 truncate text-xs text-neutral-500">
            {bulk ? tr("editor.download_n_designs_all_pages", { count: designs.length }) : (designs[0]?.doc.title || tr("editor.untitled"))}
          </p>
        )}

        {/* Export profiles: start from saved settings, save these as one. */}
        <ProfileBar
          kind="export"
          open={open}
          workspaceId={workspaceId}
          folderIds={folderIds}
          current={currentSettings}
          normalize={normalizeSettings}
          same={sameExport}
          describe={(st) => describeSettings(st, iccName)}
          onApply={applySettings}
        />

        {/* File type. A grid of chips rather than a dropdown: the format IS
            the decision this panel exists for, so all nine stay visible and
            cost one click. Grouping by output kind turns a nine-way choice
            into three small ones, and the description shows once, for the
            current selection, instead of being repeated on every row.
            Native radios carry the roving focus and arrow-key movement, so
            the group needs no keyboard code of its own. */}
        <div className="mb-3">
          <span id={formatLabelId} className="mb-1.5 block text-xs font-medium text-neutral-500">{tr("editor.file_type")}</span>
          <div role="radiogroup" aria-labelledby={formatLabelId} className="flex flex-col gap-2">
            {formatGroups().map((group) => {
              const items = formats().filter((f) => f.group === group.id);
              if (!items.length) return null;
              return (
                <div key={group.id}>
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{group.label}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((f) => {
                      const on = f.value === format;
                      return (
                        <label key={f.value} className="cursor-pointer" title={f.desc}>
                          <input
                            type="radio"
                            name={`${baseId}-format-choice`}
                            value={f.value}
                            checked={on}
                            onChange={() => setFormat(f.value)}
                            // The chip shows only the acronym, so the
                            // description rides on the accessible name:
                            // arrowing through the group otherwise announces
                            // only the bare acronyms, with no way to tell them apart.
                            // The acronym leads so the visible text is still
                            // the start of the name (WCAG 2.5.3).
                            aria-label={`${f.acronym}. ${f.badge ? `${f.badge}. ` : ""}${f.desc}`}
                            className="peer sr-only"
                          />
                          <span
                            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition peer-focus-visible:ring-2 peer-focus-visible:ring-brand-400 ${
                              on
                                ? "border-brand-500 bg-brand-50 text-brand-ink"
                                : "border-neutral-200 text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50"
                            }`}
                          >
                            <f.icon size={14} className="shrink-0" />
                            {f.acronym}
                            {/* The recommendation is a dot here and a word in
                                the line below, so the chip stays narrow while
                                the meaning is still spelled out somewhere. */}
                            {f.badge && <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${on ? "bg-brand-500" : "bg-brand-300"}`} />}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-neutral-500" data-testid="format-desc">
            {fmt.badge && <span className="font-semibold text-brand-ink">{fmt.badge} · </span>}
            {fmt.desc}
          </p>
        </div>

        {/* Accessible PDF (doc 28 FR-22): the vector PDF plus what assistive
            technology needs (structure, reading order, alt text, real text). */}
        {format === "pdf" && (() => {
          const dpi = doc.dpi ?? 96;
          const mm = (px: number) => ((px / dpi) * 25.4).toLocaleString(undefined, { maximumFractionDigits: 1 });
          const modes = [
            { id: "vector" as const, label: tr("editor.pdf_print_vector"), desc: tr("editor.pdf_print_vector_desc", { w: mm(refPage.width), h: mm(refPage.height) }), disabled: false },
            { id: "image" as const, label: tr("editor.pdf_flattened_image"), desc: tr("editor.pdf_flattened_image_desc"), disabled: false },
            {
              id: "tagged" as const,
              label: tr("editor.accessible_pdf_tagged"),
              desc: tr("editor.pdf_tagged_desc"),
              disabled: false,
            },
          ];
          return (
            <div role="radiogroup" aria-label={tr("editor.pdf_type")} className="mb-3 flex flex-col gap-1.5">
              {modes.map((m) => (
                <label
                  key={m.id}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 transition ${pdfMode === m.id ? "border-brand-400 bg-brand-50" : "border-neutral-200 hover:bg-neutral-50"} ${m.disabled ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  <input
                    type="radio"
                    name={`${baseId}-pdfmode`}
                    checked={pdfMode === m.id}
                    disabled={m.disabled}
                    onChange={() => setPdfMode(m.id)}
                    data-testid={m.id === "tagged" ? "export-tagged-pdf" : `export-pdf-${m.id}`}
                    className="mt-0.5 h-3.5 w-3.5 accent-brand-500"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-neutral-700">{m.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-neutral-500">{m.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          );
        })()}

        {/* Print formats: colour, profile, intent, black ink, resolution. */}
        {cmykCapable && (
          <div className="mb-3 flex flex-col gap-2.5">
            <div>
              <span className="mb-1 block text-xs font-medium text-neutral-500">{tr("editor.print_color")}</span>
              <div className="flex gap-1">
                {(["cmyk", "rgb"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={printColor === c}
                    onClick={() => setPrintColor(c)}
                    className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition ${printColor === c ? "bg-brand-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}
                  >
                    {c === "cmyk" ? tr("editor.cmyk_for_print") : "RGB"}
                  </button>
                ))}
              </div>
            </div>
            {printColor === "cmyk" && (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-neutral-500">{tr("editor.color_profile")}</span>
                  <select
                    value={profileId ?? ""}
                    onChange={(e) => setProfileId(e.target.value)}
                    className="h-8 w-full rounded-lg border border-neutral-200 bg-surface px-2 text-xs outline-none focus:border-brand-400"
                  >
                    {([["user", tr("editor.profiles_mine")], ["workspace", tr("editor.profiles_workspace")], ["builtin", tr("dashboard.built_in")]] as const).map(([owner, label]) => {
                      const group = (profiles ?? []).filter((p) => p.owner === owner);
                      return group.length ? (
                        <optgroup key={owner} label={label}>
                          {group.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </optgroup>
                      ) : null;
                    })}
                  </select>
                  <span className="mt-1 flex items-start justify-between gap-2 text-[11px] leading-snug text-neutral-400">
                    <span>{profiles !== null && profiles.every((p) => p.builtIn) ? tr("editor.print_profile_upload_tip") : null}</span>
                    <ManageProfilesLinks kind="color-profiles" newTab />
                  </span>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-neutral-500">{tr("editor.rendering_intent")}</span>
                  <select
                    value={intent}
                    onChange={(e) => setIntent(e.target.value as RenderingIntent)}
                    className="h-8 w-full rounded-lg border border-neutral-200 bg-surface px-2 text-xs outline-none focus:border-brand-400"
                  >
                    <option value="relative">{tr("editor.intent_relative")}</option>
                    <option value="perceptual">{tr("editor.intent_perceptual")}</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-neutral-500">{tr("editor.tac_limit")}</span>
                  <span className="flex h-8 items-center gap-1.5 rounded-lg border border-neutral-200 bg-surface px-2 text-xs focus-within:border-brand-400">
                    <input
                      type="number"
                      min={200}
                      max={400}
                      step={5}
                      value={tacLimit ?? ""}
                      placeholder={String(defaultTacLimit(profiles?.find((p) => p.id === profileId)?.name))}
                      onChange={(e) => setTacLimit(e.target.value === "" ? null : Math.min(400, Math.max(200, Number(e.target.value) || 0)))}
                      className="w-full min-w-0 bg-transparent text-neutral-800 outline-none"
                    />
                    <span className="shrink-0 text-neutral-400">%</span>
                  </span>
                  <span className="mt-1 block text-[11px] leading-snug text-neutral-400">{tr("editor.tac_limit_desc")}</span>
                </label>
                {vectorPrint && (
                  <label className="flex cursor-pointer items-start justify-between gap-3 text-xs">
                    <span className="text-neutral-600">
                      {tr("editor.black_ink_only")}
                      <span className="mt-0.5 block text-[11px] leading-snug text-neutral-400">{tr("editor.black_ink_only_desc")}</span>
                    </span>
                    <input type="checkbox" checked={blackOnly} onChange={(e) => setBlackOnly(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" />
                  </label>
                )}
                {vectorPrint && blackOnly && (
                  <label className="flex cursor-pointer items-start justify-between gap-3 text-xs">
                    <span className="text-neutral-600">
                      {tr("editor.overprint_black")}
                      <span className="mt-0.5 block text-[11px] leading-snug text-neutral-400">{tr("editor.overprint_black_desc")}</span>
                    </span>
                    <input type="checkbox" checked={overprintBlack} onChange={(e) => setOverprintBlack(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" />
                  </label>
                )}
                {format === "pdf" && (
                  <label className="flex cursor-pointer items-start justify-between gap-3 text-xs">
                    <span className="text-neutral-600">
                      {tr("editor.pdfx4")}
                      <span className="mt-0.5 block text-[11px] leading-snug text-neutral-400">{tr("editor.pdfx4_desc")}</span>
                    </span>
                    <input type="checkbox" checked={pdfx} onChange={(e) => setPdfx(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" />
                  </label>
                )}
                <label className="flex cursor-pointer items-start justify-between gap-3 text-xs">
                  <span className="text-neutral-600">
                    {tr("editor.color_list")}
                    <span className="mt-0.5 block text-[11px] leading-snug text-neutral-400">{tr("editor.color_list_desc")}</span>
                  </span>
                  <input type="checkbox" checked={colorList} onChange={(e) => setColorList(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" />
                </label>
                {colorList && (
                  <label className="block text-xs">
                    <span className="mb-1 block font-medium text-neutral-500">{tr("editor.color_list_library_label")}</span>
                    <select
                      value={colorLibraryId}
                      onChange={(e) => setColorLibraryId(e.target.value)}
                      className="h-8 w-full rounded-lg border border-neutral-200 bg-surface px-2 text-xs text-neutral-800 outline-none focus:border-brand-400"
                    >
                      <option value="">{tr("editor.color_list_no_library")}</option>
                      {(colorLibraries ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                    {colorLibraries !== null && colorLibraries.length === 0 && (
                      <span className="mt-1 block text-[11px] leading-snug text-neutral-400">{tr("editor.color_list_no_libraries_hint")}</span>
                    )}
                  </label>
                )}
              </>
            )}
            {format === "tiff" && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-neutral-500">{tr("editor.resolution")}</span>
                  <span className="text-[11px] tabular-nums text-neutral-400">{tiffDim.width} × {tiffDim.height} px</span>
                </div>
                <div className="flex gap-1">
                  {[300, 600].map((d) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={tiffDpi === d}
                      onClick={() => setTiffDpi(d)}
                      className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition ${tiffDpi === d ? "bg-brand-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}
                    >
                      {d} dpi
                    </button>
                  ))}
                </div>
              </div>
            )}
            {format === "eps" && <p className="text-[11px] leading-snug text-neutral-400">{tr("editor.eps_note")}</p>}
          </div>
        )}

        {/* Bleed and crop marks: the exported pages' own settings, edited
            here as in the page panel, each switchable for this export. */}
        {sheetCapable && fixedPrint && (() => {
          const row = "flex cursor-pointer items-center justify-between gap-3 text-xs text-neutral-700";
          const box = "h-4 w-4 shrink-0 accent-brand-600";
          return (
            <div className="mb-3 flex flex-col gap-2 rounded-lg border border-neutral-200 p-2.5">
              <span className="text-xs font-medium text-neutral-700">{tr("editor.print_sheet_include")}</span>
              {printSourceToggle}
              <label className={row}>
                <span>{tr("editor.bleed")}</span>
                <input type="checkbox" checked={override.bleed} onChange={(e) => setOverride((o) => ({ ...o, bleed: e.target.checked }))} className={box} />
              </label>
              {override.bleed && <BleedInput mm={override.bleedMm} onChange={(mm) => setOverride((o) => ({ ...o, bleedMm: mm }))} />}
              <label className={row}>
                <span>{tr("editor.print_sheet_crop_marks")}</span>
                <input type="checkbox" checked={override.marks} onChange={(e) => setOverride((o) => ({ ...o, marks: e.target.checked }))} className={box} />
              </label>
              {override.marks && <MarkInputs marks={override} onChange={(patch) => setOverride((o) => ({ ...o, ...patch }))} />}
              <p className="text-[11px] leading-snug text-neutral-400">{designs ? tr("editor.print_sheet_designs_hint") : tr("editor.print_source_fixed_hint")}</p>
            </div>
          );
        })()}
        {sheetCapable && !fixedPrint && (() => {
          const dpi = doc.dpi ?? 96;
          const mm = (px: number) => pxToMm(px, dpi).toLocaleString(undefined, { maximumFractionDigits: 1 });
          const b = pageBleed(refPage);
          const row = "flex cursor-pointer items-center justify-between gap-3 text-xs text-neutral-700";
          const box = "h-4 w-4 shrink-0 accent-brand-600";
          // From the dashboard each design brings its own: both switches show.
          const bleedOn = withBleed && (!!designs || offered.bleed);
          const marksOn = withMarks && (!!designs || offered.marks);
          return (
            <div className="mb-3 flex flex-col gap-2 rounded-lg border border-neutral-200 p-2.5">
              <span className="text-xs font-medium text-neutral-700">{tr("editor.print_sheet_include")}</span>
              {printSourceToggle}
              {(printEditable || !!designs || offered.bleed) && (
                <label className={row}>
                  <span>{printEditable || designs || b <= 0 ? tr("editor.bleed") : tr("editor.print_sheet_bleed_mm", { mm: mm(b) })}</span>
                  <input
                    type="checkbox"
                    checked={bleedOn}
                    onChange={(e) => {
                      setWithBleed(e.target.checked);
                      // Switching it on for pages without a bleed gives them one.
                      if (e.target.checked && printEditable && !offered.bleed) setPagesBleed(pages, true);
                    }}
                    className={box}
                  />
                </label>
              )}
              {printEditable && bleedOn && <BleedField indexes={pages} />}
              {(printEditable || !!designs || offered.marks) && (
                <label className={row}>
                  <span>{tr("editor.print_sheet_crop_marks")}</span>
                  <input
                    type="checkbox"
                    checked={marksOn}
                    onChange={(e) => {
                      setWithMarks(e.target.checked);
                      if (e.target.checked && printEditable && !offered.marks) setPagesMarks(pages, true);
                    }}
                    className={box}
                  />
                </label>
              )}
              {printEditable && marksOn && <MarkFields indexes={pages} />}
              {printEditable && pages.length > 1 && (bleedOn || marksOn) && (
                <p className="text-[11px] leading-snug text-neutral-400">{tr("editor.print_sheet_pages_hint", { count: pages.length })}</p>
              )}
              {designs && <p className="text-[11px] leading-snug text-neutral-400">{tr("editor.print_source_page_designs_hint")}</p>}
            </div>
          );
        })()}
        {sheetCapable && (
          <div className="mb-3 flex flex-col gap-2 rounded-lg border border-neutral-200 p-2.5">
            <TrimSizeFields value={trimSize} onChange={setTrimSize} />
            <label className="flex cursor-pointer items-start justify-between gap-3 text-xs text-neutral-700">
              <span>
                {tr("editor.round_to_mm")}
                <span className="mt-0.5 block text-[11px] leading-snug text-neutral-400">{tr("editor.round_to_mm_desc")}</span>
              </span>
              <input type="checkbox" checked={roundMm} onChange={(e) => setRoundMm(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" />
            </label>
            {useSheet.bleed && (
              <label className="flex cursor-pointer items-start justify-between gap-3 text-xs text-neutral-700">
                <span>
                  {tr("editor.extend_into_bleed")}
                  <span className="mt-0.5 block text-[11px] leading-snug text-neutral-400">{tr("editor.extend_into_bleed_desc")}</span>
                </span>
                <input type="checkbox" checked={extendBleed} onChange={(e) => setExtendBleed(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" />
              </label>
            )}
          </div>
        )}

        {imposable && (
          <ImposeFields value={impose} onChange={setImpose} sheetMm={sheetSizeMm(impose)} page={imposePage} pageCount={designs ? designs.reduce((n, d) => n + d.doc.pages.length, 0) : pages.length} chooseSheet />
        )}

        {/* Print-shop extras of the vector print files: marks on every plate,
            and a die line in a spot colour of its own. */}
        {vectorPrint && (
          <div className="mb-3 flex flex-col gap-2 rounded-lg border border-neutral-200 p-2.5">
            <span className="text-xs font-medium text-neutral-700">{tr("editor.print_extras")}</span>
            {useSheet.marks && (
              <label className="flex cursor-pointer items-start justify-between gap-3 text-xs text-neutral-700">
                <span>
                  {tr("editor.registration_marks")}
                  <span className="mt-0.5 block text-[11px] leading-snug text-neutral-400">{tr("editor.registration_marks_desc")}</span>
                </span>
                <input type="checkbox" checked={registration} onChange={(e) => setRegistration(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" />
              </label>
            )}
            <label className="flex cursor-pointer items-start justify-between gap-3 text-xs text-neutral-700">
              <span>
                {tr("editor.die_line")}
                <span className="mt-0.5 block text-[11px] leading-snug text-neutral-400">{tr("editor.die_line_desc")}</span>
              </span>
              <input type="checkbox" checked={dieLine.on} onChange={(e) => setDieLine((d) => ({ ...d, on: e.target.checked }))} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" />
            </label>
            {dieLine.on && (
              <div className="grid grid-cols-2 gap-2">
                <label className="flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 bg-surface px-2 text-[13px] transition focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
                  <span className="shrink-0 text-xs font-medium text-neutral-400">{tr("editor.die_line_name")}</span>
                  <input value={dieLine.name} maxLength={40} onChange={(e) => setDieLine((d) => ({ ...d, name: e.target.value }))} className="w-full min-w-0 bg-transparent text-neutral-800 outline-none" />
                </label>
                <BleedInput label={tr("editor.die_line_radius_mm")} mm={dieLine.radiusMm} onChange={(mm) => setDieLine((d) => ({ ...d, radiusMm: mm }))} />
              </div>
            )}
          </div>
        )}

        {/* Size multiplier with live pixel dimensions (raster + pdf). */}
        {sizable && (
          <div className="mb-3">
            <div className="mb-1 flex items-center justify-between">
              <label id={sizeLabelId} className="text-xs font-medium text-neutral-500">{tr("editor.size")}</label>
              <span className="text-[11px] tabular-nums text-neutral-400">{dim.width} × {dim.height} px · {Math.round((doc.dpi ?? 96) * scale)} dpi</span>
            </div>
            <div role="group" aria-labelledby={sizeLabelId} className="flex gap-1">
              {[...SIZE_STEPS, 300 / (doc.dpi ?? 96)].map((s, i) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={scale === s}
                  onClick={() => setScale(s)}
                  className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition ${scale === s ? "bg-brand-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}
                >
                  {i === SIZE_STEPS.length ? "300 dpi" : `${s}×`}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* JPG quality. */}
        {format === "jpg" && (
          <div className="mb-3">
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium text-neutral-500">{tr("editor.quality")}</label>
              <span className="text-[11px] tabular-nums text-neutral-400">{quality}%</span>
            </div>
            <input type="range" min={40} max={100} step={1} value={quality} aria-label={tr("editor.quality")} onChange={(e) => setQuality(Number(e.target.value))} className="w-full accent-brand-600" />
          </div>
        )}

        {/* PNG transparency. */}
        {format === "png" && (
          <label className="mb-3 flex cursor-pointer items-center justify-between text-sm">
            <span className="text-neutral-600">{tr("editor.transparent_background")}</span>
            <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} className="h-4 w-4 accent-brand-600" />
          </label>
        )}

        {/* Batch: bundle multiple pages into one .zip (non-PDF formats). */}
        {format !== "pdf" && pages.length > 1 && (
          <label className="mb-3 flex cursor-pointer items-center justify-between text-sm">
            <span className="text-neutral-600">{tr("editor.combine_pages_into_a_zip")}</span>
            <input type="checkbox" checked={zipBatch} onChange={(e) => setZipBatch(e.target.checked)} className="h-4 w-4 accent-brand-600" />
          </label>
        )}

        {/* Page selection (multi-page docs only). */}
        {pageCount > 1 && !bulk && (
          <div className="mb-3">
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-medium text-neutral-500">Pages ({pages.length}/{pageCount})</label>
              <div className="flex gap-2 text-[11px] font-medium">
                <button type="button" onClick={() => setSelected(doc.pages.map((_, i) => i))} className="text-brand-ink hover:underline">{tr("editor.all")}</button>
                <button type="button" onClick={() => setSelected([Math.min(activePage, pageCount - 1)])} className="text-neutral-500 hover:underline">{tr("editor.current")}</button>
              </div>
            </div>
            <div role="group" aria-label={tr("editor.pages")} className="flex flex-wrap gap-1.5">
              {doc.pages.map((_, i) => {
                const on = selected.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => togglePage(i)}
                    aria-pressed={on}
                    title={`Page ${i + 1}`}
                    className={`h-7 min-w-7 rounded-md px-2 text-xs font-medium transition ${on ? "bg-brand-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
            {!isRaster && format === "pdf" && <p className="mt-1.5 text-[11px] text-neutral-400">{tr("editor.exported_as_one_pdf")}</p>}
            {(isRaster || format === "svg") && pages.length > 1 && <p className="mt-1.5 text-[11px] text-neutral-400">{tr("editor.n_separate_files", { count: pages.length })}</p>}
          </div>
        )}

        {/* Brand gate. Blocked refuses; warn is dismissible. */}
        {blocked && (
          <div className="mb-3 rounded-xl bg-red-50 p-2.5 text-xs text-red-700">
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
              <ShieldAlert size={14} /> {tr("editor.off_brand_download_blocked")}
            </div>
            <p className="mb-1">{tr("editor.n_brand_violations_must_be_resolved", { count: gate!.violations.length })}</p>
            <ul className="mb-1 max-h-24 list-disc overflow-y-auto ps-4 text-[11px]">
              {gate!.violations.slice(0, 5).map((v) => (<li key={v.id}>{v.message}</li>))}
            </ul>
            <span className="text-[11px] text-red-600">{tr("editor.review_them_in_the_brand_panel")}</span>
          </div>
        )}
        {showWarn && (
          <div className="mb-3 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-800">
            <div className="mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={14} /> {tr("editor.off_brand_warning")}</span>
              <button onClick={() => setWarnDismissed(true)} className="text-[11px] font-medium text-amber-700 hover:underline">{tr("editor.dismiss")}</button>
            </div>
            <p>{tr("editor.n_brand_violations_found_can_download", { count: gate!.violations.length })}</p>
          </div>
        )}

        {trimSize && trimOff.length > 0 && (
          <div className="mb-3 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-800">
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
              <AlertTriangle size={14} />
              {bulk ? tr("editor.trim_off_n", { count: trimOff.length, size: trimSizeText(trimSize) }) : tr("editor.trim_off_one", { size: trimSizeText(trimSize), got: trimOff[0].text })}
            </div>
            {bulk && (
              <ul className="max-h-24 list-disc overflow-y-auto ps-4 text-[11px]">
                {trimOff.map((d) => <li key={d.id}>{d.title} ({d.text})</li>)}
              </ul>
            )}
            {onReformat && designs ? (
              <button type="button" onClick={() => { onClose(); onReformat(trimOff.map((d) => d.id), trimSize); }} className="mt-1.5 rounded-md bg-amber-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-amber-700">
                {tr("dashboard.reformat")}
              </button>
            ) : !designs ? (
              <p className="mt-1 text-[11px]">{tr("editor.trim_off_editor_hint", { resize: tr("editor.resize"), reformat: tr("dashboard.reformat") })}</p>
            ) : null}
          </div>
        )}
        {shownIssues.length > 0 && (
          <div className="mb-3 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-800">
            <div className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle size={14} /> {tr("editor.export_check_title")}</div>
            <ul className="max-h-32 list-disc overflow-y-auto ps-4 text-[11px]">
              {shownIssues.flatMap((g) => g.list.map((i) => (
                <li key={`${g.design}|${i.kind}|${i.subject}`}>{g.design ? `${g.design}: ` : ""}{issueText(i)}</li>
              )))}
            </ul>
          </div>
        )}

        {credits.length > 0 && (
          <div className="mb-3 rounded-xl bg-neutral-50 p-2.5 text-xs text-neutral-600">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-semibold">{tr("editor.credits")}</span>
              <button
                onClick={() => {
                  // Awaited via copyText so the toast reports what actually
                  // happened: the old call announced success without waiting,
                  // and threw outright on an insecure origin.
                  void copyText(attributionText(credits)).then((ok) =>
                    ok ? toast.success(tr("editor.credits_copied")) : toast.error(tr("editor.clipboard_unavailable")),
                  );
                }}
                className="text-[11px] font-medium text-brand-ink hover:underline"
              >
                {tr("editor.copy")}
              </button>
            </div>
            <ul className="max-h-20 overflow-y-auto">
              {credits.map((c) => (<li key={c.assetId}>{c.attributionText}</li>))}
            </ul>
            <p className="mt-1 text-[11px] text-neutral-400">{tr("editor.this_design_uses_assets_that_require_attribu")}</p>
          </div>
        )}

        {/* Check the output before making it: the page as it will print
            (estimated from the render), and the real file separated. */}
        {proofable && (
          <div className="mb-2 flex gap-2">
            <button
              type="button"
              onClick={() => setProofOpen(true)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-neutral-200 px-2 py-2 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50"
            >
              <Eye size={15} /> {tr("editor.proof_open")}
            </button>
            {checkable && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setCheckOpen(true)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-neutral-200 px-2 py-2 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50"
              >
                <ScanSearch size={15} /> {tr("editor.output_check_open")}
              </button>
            )}
          </div>
        )}
        {approvalBlocked && (
          <div className="mb-2 flex flex-col gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
            <span>{designs && designs.length > 1 ? tr("editor.print_approval_needed_n", { count: clearance.waiting }) : tr("editor.print_approval_needed")}</span>
            {onRequestApproval && (
              <button type="button" onClick={() => { onClose(); onRequestApproval(); }} className="self-start rounded-md bg-amber-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-amber-700">
                {tr("editor.request_approval")}
              </button>
            )}
          </div>
        )}
        <button
          onClick={() => void run()}
          disabled={busy || blocked || approvalBlocked}
          title={blocked ? tr("editor.resolve_brand_violations_to_download") : approvalBlocked ? tr("editor.print_approval_needed") : undefined}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          <Download size={16} />
          {busy ? tr("editor.preparing") : fileCount > 1 ? tr("editor.download_n_files", { count: fileCount }) : tr("editor.download")}
        </button>
        {checkable && checkOpen && (
          <OutputCheckView
            open={checkOpen}
            onClose={() => setCheckOpen(false)}
            build={buildForCheck}
            expect={{
              kind: format === "eps" ? "eps" : "pdf",
              cmyk: true,
              pdfx: format === "pdf" && pdfx,
              bleed: format === "pdf" && useSheet.bleed,
              // The design's own spot colours, and the die line's.
              spots: [...spotNamesOf(proofDoc), ...(printExtras?.dieLine ? [printExtras.dieLine.name] : [])],
            }}
            tacLimit={effectiveTac}
            profileId={profileId!}
            intent={intent}
          />
        )}
        {proofable && (
          <ProofView
            open={proofOpen}
            onClose={() => setProofOpen(false)}
            doc={proofDoc}
            pages={pages}
            parts={useSheet}
            profileId={profileId!}
            profileName={profileName}
            intent={intent}
            blackOnly={vectorPrint && blackOnly}
            tacLimit={effectiveTac}
            dieLine={printExtras?.dieLine}
          />
        )}
      </div>
    </>
  );
}
