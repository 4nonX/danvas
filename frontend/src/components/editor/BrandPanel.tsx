// Brand panel (FR-1, FR-3, FR-4, FR-5, FR-11). Shows the
// design's active brand kit with one-tap apply: palette swatches (apply as a
// fill or text color), fonts (apply to the selected text), logos (place as an
// image), the brand voice (read-only), and curated collections (place assets).
// "Apply brand" sets the page/text defaults going forward; "Re-skin to brand"
// remaps the whole document to the nearest brand color/font as ONE undoable step
// and shows the mapping. Brand-admins (manage-brand) get a Controls section and
// can manage the kit contents; members consume only.

import { prepareSvgFonts } from "@/lib/svgFlatten";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Palette, Type as TypeIcon, ImageIcon, Wand2, Lock, Unlock, Plus,
  ShieldCheck, AlertTriangle, GitBranch, RefreshCw, Sparkles, Shapes,
} from "lucide-react";
import type { BrandKit, BrandLintViolation, UploadedAsset, BrandUpdateSummary } from "@hc/sdk";
import type { Color, Fill } from "@hc/schema";
import { locate } from "@hc/editor";
import { PanelShell, CollapsibleSection } from "./EditorPanels";
import { BrandGraphicsSection, type GraphicInfo } from "./BrandGraphicsSection";
import { dashboardPath } from "@/components/dashboard/views";
import { collectPageColors, collectSelectionColors } from "@/lib/pageColors";
import { imageAssetIds, imageAssetPalette } from "@/lib/imagePalette";
import { useEditor, type ReskinResult, type ReskinOverrides, type BrandFixTarget } from "@/store/editor";
import { useBrand, brandHexColors, brandFontFamilies, brandColorOf } from "@/store/brand";
import { useCan } from "@/store/workspaceActions";
import { srgbFromHexFull } from "@/components/brand/kitEditors";
import { kitVersions, logoFiles, versionName } from "@/lib/logoVersions";
import { selectionColors } from "@/lib/selectionColors";
import { printColorLabel } from "@/lib/print/printColor";
import { fonts } from "@/lib/fontProvider";
import { oc, resolveAssetUrl } from "@/lib/sdk";
import { useToast } from "@/components/ui/Toast";
import { tr } from "@/lib/i18n";

/** Map a lint violation's typed fix to the store's BrandFixTarget, or null when
 *  there is no safe auto-fix (restore_logo / missing fix). */
function fixTargetOf(v: BrandLintViolation): BrandFixTarget | null {
  if (!v.fix || !v.nodeId) return null;
  if (v.fix.kind === "restore_logo") return null;
  return { nodeId: v.nodeId, fix: v.fix };
}

/** A finding in the reader's language, from its kind and values; the
 *  server's English text where the kind is not known here. */
function lintMessage(v: BrandLintViolation): string {
  const p = v.params ?? {};
  if (v.kind === "off-brand-color" && p.hex) return tr("brand.lint_color", { hex: p.hex.toUpperCase() });
  if (v.kind === "off-brand-font" && p.font) return tr("brand.lint_font", { font: p.font });
  if (v.kind === "low-contrast" && p.ratio) return tr("brand.lint_contrast", { ratio: p.ratio });
  if (v.kind === "spacing" && p.size) return tr("brand.lint_spacing", { size: p.size });
  if (v.id.startsWith("logo-aspect:")) return tr("brand.lint_logo_aspect");
  if (v.id.startsWith("logo-recolor:")) return tr("brand.lint_logo_recolor");
  if (v.id.startsWith("logo-size:") && p.size) return tr("brand.lint_logo_size", { size: p.size });
  return v.message;
}

/** Human label for a violation kind, for grouping. */
const kindLabel = (): Record<BrandLintViolation["kind"], string> => ({
  "off-brand-color": tr("editor.off_brand_colors"),
  "off-brand-font": tr("editor.off_brand_fonts"),
  "logo-misuse": tr("editor.logo_misuse"),
  "low-contrast": tr("editor.low_contrast"),
  spacing: tr("editor.spacing"),
});


export function BrandPanel({ workspaceId }: { workspaceId: string | null }) {
  const kit = useBrand((s) => s.kit);
  const canManage = useBrand((s) => s.canManage);
  // Changing the kit itself (brand.kits) and maintaining its library
  // (brand.library). Both happen on the dashboard's Brand page; here the
  // kit is applied, and colours can be taken into it from the page.
  const canEditKit = useCan("brand.kits", workspaceId);
  const canLibrary = useCan("brand.library", workspaceId) || canEditKit;
  const loading = useBrand((s) => s.loading);
  const designId = useBrand((s) => s.designId);
  const refresh = useBrand((s) => s.refresh);
  const pinnedVersion = useBrand((s) => s.pinnedVersion);
  const lockedRegions = useBrand((s) => s.lockedRegions);
  // Editor rev drives debounced live re-lint after edits (FR-8).
  const rev = useEditor((s) => s.rev);
  const selection = useEditor((s) => s.selection);

  const [kits, setKits] = useState<BrandKit[]>([]);
  const [reskin, setReskin] = useState<ReskinResult | null>(null);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  // Names and types of the uploads, for the kit's graphics (F50).
  const [assetInfo, setAssetInfo] = useState<Record<string, GraphicInfo>>({});
  const [violations, setViolations] = useState<BrandLintViolation[] | null>(null);
  const [linting, setLinting] = useState(false);
  const [update, setUpdate] = useState<BrandUpdateSummary | null>(null);
  const toast = useToast();

  // Load the workspace's kits (for the selector) + an assetId -> url map (logos).
  useEffect(() => {
    let cancelled = false;
    if (!workspaceId) return;
    void (async () => {
      try {
        const [ks, assets] = await Promise.all([
          oc.listBrandKits(workspaceId),
          oc.listAssets(workspaceId),
        ]);
        if (cancelled) return;
        setKits(ks);
        const map: Record<string, string> = {};
        const info: Record<string, GraphicInfo> = {};
        for (const a of assets as UploadedAsset[]) {
          map[a.id] = a.url;
          info[a.id] = { url: a.url, filename: a.filename, mimeType: a.mimeType, thumbnail: a.thumbnail };
        }
        setAssetUrls(map);
        setAssetInfo(info);
      } catch {
        /* membership/no-brand: leave empty */
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId, kit?.id]);

  const swatches = useMemo(() => brandHexColors(kit), [kit]);
  const families = useMemo(() => brandFontFamilies(kit), [kit]);

  // Add colours to the kit's first palette from where the colours already
  // are: a picked or typed value, the selection, or the whole page. Skips
  // what the palette already holds and says so.
  // A colour taken from the selection keeps its print values (exact CMYK, a
  // spot colour), so a house colour set up on an element lands in the kit as
  // it prints.
  const addColors = useCallback(async (entries: (string | { hex: string; color: Color })[]) => {
    if (!kit) return;
    const have = new Set(brandHexColors(kit).map((h) => h.toLowerCase()));
    const byHex = new Map<string, Color>();
    for (const e of entries) {
      const hex = (typeof e === "string" ? e : e.hex).toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(hex) || have.has(hex) || byHex.has(hex)) continue;
      byHex.set(hex, typeof e === "string" ? srgbFromHexFull(hex) : { ...structuredClone(e.color), srgb: { ...e.color.srgb, a: 1 } });
    }
    if (!byHex.size) {
      toast.toast(tr("editor.color_already_in_palette"));
      return;
    }
    const fresh = [...byHex.keys()];
    const base = kit.palettes[0] ?? { id: `p-${crypto.randomUUID()}`, name: tr("editor.palette"), colors: [] };
    const first = { ...base, colors: [...base.colors, ...[...byHex.values()].map((value) => ({ id: `s-${crypto.randomUUID()}`, role: "accent", value }))] };
    const palettes = kit.palettes.length ? kit.palettes.map((p, i) => (i === 0 ? first : p)) : [first];
    try {
      const updated = await oc.updateBrandKit(kit.id, { palettes });
      useBrand.getState().setKit(updated);
      toast.success(tr("editor.colors_added", { count: String(fresh.length) }));
    } catch {
      toast.error(tr("editor.couldnt_save_brand_kit"));
    }
  }, [kit, toast]);

  // Apply a brand color: to the selection's fills, or the page background if
  // nothing is selected (so a click is never a no-op).
  // With the swatch's print values (brandColorOf).
  const applyColor = useCallback((hex: string) => {
    const st = useEditor.getState();
    const color = brandColorOf(kit, hex);
    if (st.selection.length > 0) st.setFillColorSel(color);
    else st.setPageBackground({ type: "solid", color });
  }, [kit]);

  const applyTextColor = useCallback((hex: string) => {
    const st = useEditor.getState();
    st.setCharStyleDeep({ fill: { type: "solid", color: brandColorOf(kit, hex) } as Fill });
  }, [kit]);

  const applyFont = useCallback((family: string) => {
    fonts.ensure(family);
    if (!useEditor.getState().setCharStyleDeep({ fontFamily: family })) toast.toast(tr("editor.brand_select_text_first"));
  }, [toast]);

  // Logos and icons go in as editable shapes when they are SVG (so they can
  // be recolored like any vector), else as an image.
  const placeIcon = useCallback(async (assetId: string, name?: string) => {
    const url = assetUrls[assetId];
    if (!url) { toast.error(tr("editor.logo_asset_is_unavailable")); return; }
    try {
      const res = await fetch(resolveAssetUrl(url), { credentials: "include" });
      const text = res.ok ? await res.text() : "";
      if (/<svg[\s>]/i.test(text)) { await prepareSvgFonts(text); useEditor.getState().addIconSvg(text, undefined, name ? { name } : undefined); return; }
    } catch { /* fall back to placing the file as an image */ }
    useEditor.getState().addImage(resolveAssetUrl(url));
  }, [assetUrls, toast]);

  // Re-skin: remap every color/font to the kit. One undo step (FR-3, AC-2). When
  // re-applied with per-color overrides (from the mapping UI), the previous
  // re-skin is first undone so the result is a single reversible operation built
  // from the original document, not stacked on top of the prior remap.
  const doReskin = useCallback((overrides?: ReskinOverrides) => {
    if (!kit) return;
    const palette: Color[] = [];
    for (const p of kit.palettes) for (const sw of p.colors) palette.push(sw.value);
    const fontFams = brandFontFamilies(kit);
    fontFams.forEach((f) => fonts.ensure(f));
    const st = useEditor.getState();
    if (overrides) st.undo(); // collapse the prior re-skin so overrides re-apply as one step
    const result = st.reskinToBrand({ palette, fonts: fontFams }, overrides);
    setReskin(result);
    if (result.colors.length === 0 && result.fonts.length === 0)
      toast.toast(tr("editor.design_is_already_on_brand"), "info");
    else
      toast.success(tr("editor.reskinned", { colors: result.colors.length, fonts: result.fonts.length }));
  }, [kit, toast]);

  // Apply brand: set defaults going forward (page bg = first brand color, the
  // selected text = brand body font). Lighter than re-skin (no remap).
  const applyBrandDefaults = useCallback(() => {
    if (!kit) return;
    const st = useEditor.getState();
    const firstHex = swatches[0];
    if (firstHex) st.setPageBackground({ type: "solid", color: srgbFromHex(firstHex) });
    const body = families[0];
    if (body) { fonts.ensure(body); st.setCharStyleDeep({ fontFamily: body }); }
    toast.success(tr("editor.applied_brand_defaults"));
  }, [kit, swatches, families, toast]);

  // --- brand linting (FR-7, FR-8) -------------------------------------------
  // Run lint on demand (Check brand) and reflect the result. Membership-gated
  // server-side; we surface violations grouped by kind below.
  const runLint = useCallback(async () => {
    if (!designId) return;
    setLinting(true);
    try {
      setViolations(await oc.brandLint(designId));
    } catch {
      toast.error(tr("editor.couldnt_run_brand_check"));
    } finally {
      setLinting(false);
    }
  }, [designId, toast]);

  // Live debounced re-lint after edits (FR-8): only while a kit is active and
  // only once the user has run a check at least once (violations !== null), so we
  // never lint unprompted. Keyed off the editor `rev`.
  useEffect(() => {
    if (!designId || !kit || violations === null) return;
    const t = setTimeout(() => {
      void oc.brandLint(designId).then(setViolations).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, designId, kit?.id]);

  // Select + frame the offending node so the user can see what to fix (FR-7).
  const highlight = useCallback((v: BrandLintViolation) => {
    if (!v.nodeId) return;
    const st = useEditor.getState();
    st.select([v.nodeId]);
    st.zoomToSelection();
  }, []);

  // Apply one violation's fix through the editor store (undoable), then re-lint.
  const applyFix = useCallback((v: BrandLintViolation) => {
    const target = fixTargetOf(v);
    if (!target) {
      toast.toast(tr("editor.adjust_the_logo_manually_to_restore_it_on_br"), "info");
      return;
    }
    const n = useEditor.getState().applyBrandFixes([target]);
    if (n > 0) void runLint();
  }, [runLint, toast]);

  // Apply every auto-fixable violation as ONE undo step, then re-lint (FR-7).
  const fixAll = useCallback(() => {
    if (!violations) return;
    const targets = violations.map(fixTargetOf).filter((t): t is BrandFixTarget => t !== null);
    if (!targets.length) { toast.toast(tr("editor.no_safe_auto_fixes_available"), "info"); return; }
    const n = useEditor.getState().applyBrandFixes(targets);
    if (n > 0) { toast.success(tr("editor.fixes_applied", { count: n })); void runLint(); }
  }, [violations, runLint, toast]);

  // --- pin / track update check (FR-10) -------------------------------------
  const checkUpdates = useCallback(async () => {
    if (!designId) { setUpdate(null); return; }
    try {
      setUpdate(await oc.brandUpdates(designId));
    } catch {
      setUpdate(null);
    }
  }, [designId]);

  // Check for a tracked-kit update on load and whenever the kit changes. The
  // fetch + setState run in the Promise chain, not synchronously in the effect.
  useEffect(() => {
    let cancelled = false;
    if (!designId) {
      void Promise.resolve().then(() => { if (!cancelled) setUpdate(null); });
      return () => { cancelled = true; };
    }
    void oc.brandUpdates(designId)
      .then((u) => { if (!cancelled) setUpdate(u); })
      .catch(() => { if (!cancelled) setUpdate(null); });
    return () => { cancelled = true; };
  }, [designId, kit?.id]);

  if (!designId) {
    return (
      <PanelShell title={tr("editor.brand")}>
        <p className="text-sm text-neutral-500">{tr("editor.open_a_saved_design_to_use_brand_kits")}</p>
      </PanelShell>
    );
  }

  return (
    <PanelShell title={tr("editor.brand")}>
      {loading && <p className="text-sm text-neutral-400">{tr("editor.loading_brand")}</p>}

      {/* Kit selector (FR-2). */}
      {kits.length > 0 && (
        <div className="mb-4">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{tr("editor.brand_kit")}</label>
          <select
            value={kit?.id ?? ""}
            disabled={!canManage}
            onChange={(e) => void useBrand.getState().assign(e.target.value || null)}
            className="w-full rounded-lg border border-neutral-200 bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand-400 disabled:opacity-60"
          >
            <option value="">{tr("editor.no_brand")}</option>
            {kits.map((k) => (
              <option key={k.id} value={k.id}>{k.name}{k.isDefault ? " (default)" : ""}</option>
            ))}
          </select>
          {!canManage && <p className="mt-1 text-[11px] text-neutral-400">{tr("editor.only_brand_admins_can_switch_the_kit")}</p>}
        </div>
      )}

      {!kit && !loading && (
        <p className="text-sm text-neutral-500">
          {tr("editor.no_brand_kit_for_design")}
          {canEditKit && workspaceId && (
            <>
              {" "}
              <a href={dashboardPath("brand")} target="_blank" rel="noopener" className="font-medium text-brand-ink hover:underline">{tr("brand.manage_brand")}</a>
            </>
          )}
        </p>
      )}

      {kit && (
        <div className="flex flex-col gap-5">
          {/* Brand updated - review (FR-10). Shown only when a tracked kit has
              advanced past what the design reflects. Never mutates silently. */}
          {update?.hasUpdate && (
            <BrandUpdateBanner
              update={update}
              canManage={canManage}
              onApply={async () => {
                try {
                  // Record the latest version as reviewed so the banner clears
                  // (FR-10), then refresh the resolved brand + re-check updates.
                  await useBrand.getState().markReviewed();
                  await refresh();
                  await checkUpdates();
                  toast.success(tr("editor.brand_refreshed_to_the_latest_version"));
                } catch { toast.error(tr("editor.couldnt_apply_the_brand_update")); }
              }}
              onPin={async () => {
                if (!designId || update.designVersion == null) return;
                try {
                  await oc.setDesignBrandVersion(designId, update.designVersion);
                  await refresh();
                  await checkUpdates();
                  toast.success(tr("editor.pinned_to_the_current_version"));
                } catch { toast.error(tr("editor.couldnt_pin_the_version")); }
              }}
            />
          )}

          {/* Apply / re-skin (FR-3). Recolor/re-font the whole design, which would
              override brand locked regions, so this is gated to manage-brand
              users. Fillers don't see it. */}
          {canManage && (
            <div className="flex flex-col gap-2">
              <button onClick={applyBrandDefaults} className="flex items-center justify-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-ink hover:bg-brand-100">
                <Wand2 size={15} /> {tr("editor.apply_brand")}
              </button>
              <button onClick={() => doReskin()} className="flex items-center justify-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 hover:border-brand-300 hover:bg-brand-50">
                {tr("editor.re_skin_to_brand")}
              </button>
              {reskin && (reskin.colors.length > 0 || reskin.fonts.length > 0) && (
                <ReskinMapping
                  result={reskin}
                  brandSwatches={swatches}
                  onUndo={() => { useEditor.getState().undo(); setReskin(null); }}
                  onReapply={(overrides) => doReskin(overrides)}
                />
              )}
            </div>
          )}

          {/* Brand lint (FR-7, FR-8). */}
          <CollapsibleSection title={tr("editor.brand_check")} icon={ShieldCheck}>
            <LintSection
              violations={violations}
              linting={linting}
              onCheck={() => void runLint()}
              onHighlight={highlight}
              onFix={applyFix}
              onFixAll={fixAll}
            />
          </CollapsibleSection>

          {/* Colors (FR-1, FR-4). */}
          <CollapsibleSection title={tr("editor.colors")} icon={Palette} defaultOpen right={kit.controls.lockColors ? <LockedBadge /> : undefined}>
            {swatches.length === 0 ? (
              <p className="text-xs text-neutral-400">{tr("editor.no_brand_colors_yet")}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {swatches.map((hex) => (
                  <button
                    key={hex}
                    title={[hex.toUpperCase(), printColorLabel(brandColorOf(kit, hex))].filter(Boolean).join(" · ")}
                    onClick={(e) => (e.shiftKey ? applyTextColor(hex) : applyColor(hex))}
                    className="h-8 w-8 rounded-lg border border-neutral-200 shadow-sm"
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            )}
            {/* Adding colours, where the colours are looked at: a picker and a
                hex field, the selection's colours, or the page's. With
                brand.kits, as with every kit edit. */}
            {canEditKit && <AddBrandColors existing={swatches} onAdd={(hexes) => void addColors(hexes)} />}
          </CollapsibleSection>

          {/* Fonts (FR-1, FR-4). */}
          <CollapsibleSection title={tr("editor.fonts")} icon={TypeIcon} defaultOpen right={kit.controls.lockFonts ? <LockedBadge /> : undefined}>
            {families.length === 0 ? (
              <p className="text-xs text-neutral-400">{tr("editor.no_brand_fonts_yet")}</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {kit.fonts.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => applyFont(f.fontFamily)}
                    className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-start text-sm hover:border-brand-300 hover:bg-brand-50"
                    style={{ fontFamily: `'${f.fontFamily}', sans-serif` }}
                  >
                    <span className="truncate">{f.fontFamily}</span>
                    <span className="ms-2 shrink-0 text-[10px] uppercase tracking-wide text-neutral-300">{f.role}</span>
                  </button>
                ))}
              </div>
            )}
          </CollapsibleSection>

          {/* Logos (FR-1): each with its versions (colour, black, white, ...)
              on their grounds, placed from here, managed on the Brand page. */}
          {kit.logos.length > 0 && (
            <CollapsibleSection title={tr("editor.logos")} icon={ImageIcon} badge={kit.logos.length}>
              <div className="flex flex-col gap-2">
                {kit.logos.map((l) => {
                  const files = logoFiles(l, kitVersions(kit)).filter((f) => f.assetId && assetUrls[f.assetId]);
                  if (!files.length) return null;
                  return (
                    <div key={l.id} className="light overflow-hidden rounded-lg border border-neutral-200">
                      <div className="grid" style={{ gridTemplateColumns: `repeat(${files.length}, minmax(0, 1fr))` }}>
                        {files.map(({ version: v, assetId }) => (
                          <button
                            key={v.id}
                            onClick={() => void placeIcon(assetId!)}
                            title={`${tr("editor.place_logo")}: ${l.label} (${versionName(v)})`}
                            className={`flex aspect-[3/2] items-center justify-center p-1.5 ${v.ground === "dark" ? "bg-neutral-900 hover:bg-neutral-800" : "bg-neutral-50 hover:bg-brand-50"}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={resolveAssetUrl(assetUrls[assetId!])} alt={`${l.label} ${versionName(v)}`} className="max-h-full max-w-full object-contain" />
                          </button>
                        ))}
                      </div>
                      <div className="truncate border-t border-neutral-200 bg-white px-2 py-1 text-[11px] text-neutral-600" title={l.label}>{l.label}</div>
                    </div>
                  );
                })}
              </div>
            </CollapsibleSection>
          )}

          {/* Graphics (F50): the kit's categories, placed by click or drag. */}
          {(kit.collections.some((c) => c.assetIds.length > 0) || (canLibrary && !!workspaceId)) && (
            <CollapsibleSection title={tr("brand.graphics")} icon={Shapes} badge={kit.collections.reduce((n, c) => n + c.assetIds.length, 0) || undefined}>
              <BrandGraphicsSection kit={kit} assets={assetInfo} onPlace={(id, name) => void placeIcon(id, name)} />
              {canLibrary && workspaceId && (
                <a href={`${dashboardPath("brand")}#graphics`} target="_blank" rel="noopener" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-ink hover:underline">
                  <Shapes size={12} /> {tr("brand.manage_graphics")}
                </a>
              )}
            </CollapsibleSection>
          )}

          {/* Voice (FR-1, read-only). */}
          {kit.voice && (
            <CollapsibleSection title={tr("editor.voice")} icon={Sparkles}>
              {kit.voice.tone.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  {kit.voice.tone.map((t) => (
                    <span key={t} className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600">{t}</span>
                  ))}
                </div>
              )}
              {kit.voice.sampleCopy && <p className="text-xs italic text-neutral-500">“{kit.voice.sampleCopy}”</p>}
            </CollapsibleSection>
          )}

          {/* Pin / track a specific version (FR-10, manage-brand only). */}
          {canManage && (
            <CollapsibleSection title={tr("editor.version")} icon={GitBranch}>
              <PinTrackControl
                designId={designId}
                pinnedVersion={pinnedVersion}
                latestVersion={kit.version}
                onChanged={async () => { await refresh(); await checkUpdates(); }}
              />
            </CollapsibleSection>
          )}

          {/* Locked regions (FR-6, AC-4, manage-brand only). */}
          {canManage && (
            <CollapsibleSection title={tr("editor.locked_regions")} icon={Lock} badge={lockedRegions.length || undefined}>
              <LockedRegionsControl
                designId={designId}
                selection={selection}
                lockedRegions={lockedRegions}
                onChanged={() => void refresh()}
              />
            </CollapsibleSection>
          )}

          {/* The kit itself (colours, fonts, logos, graphics, settings,
              versions) is managed on the dashboard's Brand page. */}
          {canEditKit && (
            <a href={dashboardPath("brand")} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs font-medium text-brand-ink hover:underline">
              <ShieldCheck size={12} /> {tr("brand.manage_brand")}
            </a>
          )}
        </div>
      )}
    </PanelShell>
  );
}

/** "Brand updated - review" banner (FR-10). Surfaces what changed and offers to
 *  apply (refresh to latest) or pin the current version. Never auto-mutates. */
function BrandUpdateBanner({
  update,
  canManage,
  onApply,
  onPin,
}: {
  update: BrandUpdateSummary;
  canManage: boolean;
  onApply: () => void | Promise<void>;
  onPin: () => void | Promise<void>;
}) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
      <div className="mb-1 flex items-center gap-1.5 font-semibold">
        <RefreshCw size={13} /> {tr("editor.brand_updated_review")}
      </div>
      <p className="mb-1.5 text-amber-700">
        The brand kit advanced to v{update.latestVersion} (this design reflects
        {update.designVersion == null ? " an older version" : ` v${update.designVersion}`}).
      </p>
      {update.changes.length > 0 && (
        <ul className="mb-2 list-disc ps-4 text-[11px] text-amber-700">
          {update.changes.map((c, i) => (<li key={i}>{c}</li>))}
        </ul>
      )}
      {canManage ? (
        <div className="flex gap-2">
          <button onClick={() => void onApply()} className="rounded-md bg-amber-600 px-2.5 py-1 font-medium text-white hover:bg-amber-700 dark:hover:bg-amber-500">{tr("editor.apply_update")}</button>
          <button onClick={() => void onPin()} className="rounded-md border border-amber-300 bg-surface px-2.5 py-1 font-medium text-amber-700 hover:bg-amber-100">{tr("editor.pin_current")}</button>
        </div>
      ) : (
        <p className="text-[11px] text-amber-700">{tr("editor.a_brand_admin_can_apply_or_pin_this_update")}</p>
      )}
    </div>
  );
}

/** Brand-lint section (FR-7, FR-8): a Check button, grouped violations, per-item
 *  highlight + fix, and Fix all. */
function LintSection({
  violations,
  linting,
  onCheck,
  onHighlight,
  onFix,
  onFixAll,
}: {
  violations: BrandLintViolation[] | null;
  linting: boolean;
  onCheck: () => void;
  onHighlight: (v: BrandLintViolation) => void;
  onFix: (v: BrandLintViolation) => void;
  onFixAll: () => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<BrandLintViolation["kind"], BrandLintViolation[]>();
    for (const v of violations ?? []) {
      const arr = map.get(v.kind) ?? [];
      arr.push(v);
      map.set(v.kind, arr);
    }
    return [...map.entries()];
  }, [violations]);

  const fixable = (violations ?? []).filter((v) => fixTargetOf(v) !== null).length;
  const clean = violations !== null && violations.length === 0;

  return (
    <>
      <div className="flex justify-end">
        <button onClick={onCheck} disabled={linting} className="rounded-md border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-600 hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50">
          {linting ? tr("editor.checking") : tr("editor.check_brand")}
        </button>
      </div>

      {violations === null && <p className="text-xs text-neutral-400">{tr("editor.run_a_brand_check_to_see_violations_it_then")}</p>}
      {clean && (
        <p className="flex items-center gap-1.5 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
          <ShieldCheck size={13} /> {tr("editor.on_brand_no_violations_found")}
        </p>
      )}

      {violations !== null && violations.length > 0 && (
        <div className="flex flex-col gap-3">
          {groups.map(([kind, items]) => (
            <div key={kind}>
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-neutral-500">
                <AlertTriangle size={12} className="text-amber-500" /> {kindLabel()[kind]} ({items.length})
              </div>
              <ul className="flex flex-col gap-1">
                {items.map((v) => {
                  const canFix = fixTargetOf(v) !== null;
                  return (
                    <li key={v.id} className="rounded-lg border border-neutral-100 bg-neutral-50 px-2 py-1.5 text-xs">
                      <button onClick={() => onHighlight(v)} disabled={!v.nodeId} className="block w-full text-start text-neutral-600 hover:text-brand-ink disabled:cursor-default disabled:hover:text-neutral-600" title={v.nodeId ? tr("editor.highlight_on_canvas") : undefined}>
                        {lintMessage(v)}
                      </button>
                      <button onClick={() => onFix(v)} className="mt-1 text-[11px] font-medium text-brand-ink hover:underline">
                        {canFix ? tr("editor.fix") : tr("editor.how_to_fix")}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {fixable > 0 && (
            <button onClick={onFixAll} className="flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700">
              <Wand2 size={14} /> {tr("editor.fix_all_safe_issues", { count: fixable })}
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** Pin to a specific version or track the latest (FR-10). */
function PinTrackControl({
  designId,
  pinnedVersion,
  latestVersion,
  onChanged,
}: {
  designId: string;
  pinnedVersion: number | null;
  latestVersion: number;
  onChanged: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const versions = useMemo(() => Array.from({ length: latestVersion }, (_, i) => latestVersion - i), [latestVersion]);

  const set = useCallback(async (v: number | null) => {
    setBusy(true);
    try {
      await oc.setDesignBrandVersion(designId, v);
      await onChanged();
      toast.success(v == null ? tr("editor.now_tracking_the_latest_version") : `Pinned to v${v}.`);
    } catch {
      toast.error(tr("editor.couldnt_change_the_brand_version"));
    } finally {
      setBusy(false);
    }
  }, [designId, onChanged, toast]);

  return (
    <>
      <p className="mb-2 text-[11px] text-neutral-500">
        {pinnedVersion == null ? tr("editor.tracking_the_latest_version") : `Pinned to v${pinnedVersion}.`}
      </p>
      <select
        value={pinnedVersion == null ? "" : String(pinnedVersion)}
        disabled={busy}
        onChange={(e) => void set(e.target.value === "" ? null : Number(e.target.value))}
        className="w-full rounded-lg border border-neutral-200 bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand-400 disabled:opacity-60"
      >
        <option value="">Track latest (v{latestVersion})</option>
        {versions.map((v) => (<option key={v} value={v}>Pin v{v}</option>))}
      </select>
    </>
  );
}

/** Mark/clear brand locked regions from the current selection (FR-6, AC-4). */
function LockedRegionsControl({
  designId,
  selection,
  lockedRegions,
  onChanged,
}: {
  designId: string;
  selection: string[];
  lockedRegions: string[];
  onChanged: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const save = useCallback(async (ids: string[]) => {
    setBusy(true);
    try {
      await oc.setDesignLockedRegions(designId, ids);
      // Reflect immediately in the gate so editing is blocked without a reload.
      useBrand.getState().setLockedRegions(ids);
      await onChanged();
    } catch {
      toast.error(tr("editor.couldnt_update_locked_regions"));
    } finally {
      setBusy(false);
    }
  }, [designId, onChanged, toast]);

  const lockSelection = useCallback(() => {
    if (!selection.length) return;
    void save([...new Set([...lockedRegions, ...selection])]);
  }, [selection, lockedRegions, save]);

  return (
    <>
      <p className="mb-2 text-[11px] text-neutral-500">
        {lockedRegions.length === 0 ? tr("editor.no_locked_regions_members_can_edit_every_ele") : `${lockedRegions.length} locked region${lockedRegions.length === 1 ? "" : "s"}. Members cannot move or restyle them.`}
      </p>
      <div className="flex gap-2">
        <button
          onClick={lockSelection}
          disabled={busy || selection.length === 0}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50"
        >
          <Lock size={13} /> Lock selection ({selection.length})
        </button>
        {lockedRegions.length > 0 && (
          <button
            onClick={() => void save([])}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50"
          >
            <Unlock size={13} /> {tr("editor.clear_all")}
          </button>
        )}
      </div>
    </>
  );
}

/** Kit version history + restore (FR-9). Manage-brand only. */

/** Small "locked by brand" pill, used in a CollapsibleSection's right slot. */
function LockedBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1 text-[10px] font-medium text-amber-700" title={tr("editor.locked_by_brand")}>
      <Lock size={10} /> {tr("editor.locked")}
    </span>
  );
}

/** Re-skin preview + per-mapping override. Each color row
 *  offers a control to keep the original or pick a different brand swatch; the
 *  whole document is re-applied with those overrides as ONE undo step. */
function ReskinMapping({
  result,
  brandSwatches,
  onUndo,
  onReapply,
}: {
  result: ReskinResult;
  brandSwatches: string[];
  onUndo: () => void;
  onReapply: (overrides: ReskinOverrides) => void;
}) {
  // Per-source-hex choice: a brand hex, or "keep". Defaults to the auto-mapped
  // target so the select reflects the current re-skin result.
  const [choices, setChoices] = useState<Record<string, string>>(() =>
    Object.fromEntries(result.colors.map((m) => [m.from, m.to])),
  );

  // The override map sent to the re-apply: only entries that differ from the
  // default nearest-color result (a different swatch, or "keep").
  const overrides = useMemo<ReskinOverrides>(() => {
    const out: ReskinOverrides = {};
    for (const m of result.colors) {
      const c = choices[m.from] ?? m.to;
      if (c !== m.to) out[m.from] = c;
    }
    return out;
  }, [choices, result.colors]);

  const dirty = Object.keys(overrides).length > 0;
  // Offer the original color as a "keep" option plus every brand swatch.
  const swatchOptions = useMemo(() => [...new Set(brandSwatches)], [brandSwatches]);

  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-xs">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium text-neutral-600">{tr("editor.re_skin_mapping")}</span>
        <button onClick={onUndo} className="text-brand-ink hover:underline">{tr("editor.undo")}</button>
      </div>
      {result.colors.map((m) => {
        const choice = choices[m.from] ?? m.to;
        return (
          <div key={`c-${m.from}`} className="flex items-center gap-1.5 py-0.5">
            <span className="h-3 w-3 rounded border border-neutral-300" style={{ backgroundColor: m.from }} />
            <span className="text-neutral-400">→</span>
            <span
              className="h-3 w-3 rounded border border-neutral-300"
              style={{ backgroundColor: choice === "keep" ? m.from : choice }}
            />
            <span className="text-neutral-400">{m.from}</span>
            <select
              value={choice}
              onChange={(e) => setChoices((c) => ({ ...c, [m.from]: e.target.value }))}
              className="ms-auto rounded border border-neutral-200 bg-surface px-1 py-0.5 text-[11px] outline-none focus:border-brand-400"
              title={tr("editor.map_this_color_to_a_brand_swatch_or_keep_the")} aria-label={tr("editor.map_this_color_to_a_brand_swatch_or_keep_the")}
            >
              <option value="keep">{tr("editor.keep_original")}</option>
              {swatchOptions.map((hex) => (
                <option key={hex} value={hex}>{hex}</option>
              ))}
            </select>
          </div>
        );
      })}
      {result.fonts.map((m) => (
        <div key={`f-${m.from}`} className="py-0.5 text-neutral-500">{m.from} → {m.to}</div>
      ))}
      {dirty && (
        <button
          onClick={() => onReapply(overrides)}
          className="mt-1.5 w-full rounded-md bg-brand-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-brand-700"
        >
          {tr("editor.re_apply_with_overrides")}
        </button>
      )}
    </div>
  );
}

function AddBrandColors({ existing, onAdd }: { existing: string[]; onAdd: (colors: (string | { hex: string; color: Color })[]) => void }) {
  // Starts at the brand's first colour (a neighbour is the usual addition).
  const [hex, setHex] = useState(existing[0] ?? "#000000");
  const selection = useEditor((s) => s.selection);
  const rev = useEditor((s) => s.rev);
  const toast = useToast();
  // A selected photo or logo suggests its own colours: the dominant ones the
  // palette does not hold yet, each a click to add. Recomputed as the
  // selection or document changes (an image that was still loading counts
  // once it has decoded and the canvas repainted).
  const imageColors = useMemo(() => {
    void rev; // the document's revision: recompute after edits and image decode
    const st = useEditor.getState();
    const nodes = selection.map((id) => locate(st.doc, id)?.node).filter((n): n is NonNullable<typeof n> => !!n);
    const have = new Set(existing.map((h) => h.toLowerCase()));
    const out = new Set<string>();
    for (const id of imageAssetIds(nodes)) for (const c of imageAssetPalette(id, 6)) if (!have.has(c)) out.add(c);
    return [...out].slice(0, 8);
  }, [selection, rev, existing]);
  const clean = hex.trim().toLowerCase();
  const valid = /^#[0-9a-f]{6}$/.test(clean);
  const fromSelection = () => {
    const st = useEditor.getState();
    const nodes = st.selection.map((id) => locate(st.doc, id)?.node).filter((n): n is NonNullable<typeof n> => !!n);
    // The elements' own colours as objects (print values kept), then the
    // dominant colours of selected pictures.
    const own = selectionColors(nodes, 24);
    const ownHex = new Set(own.map((c) => c.hex.toLowerCase()));
    const colors = [...own, ...collectSelectionColors(nodes).filter((h) => !ownHex.has(h.toLowerCase())), ...imageColors];
    if (!colors.length) { toast.toast(tr("editor.select_an_element_to_take_its_color")); return; }
    onAdd(colors);
  };
  const fromPage = () => {
    const st = useEditor.getState();
    const page = st.doc.pages[Math.min(st.activePage, st.doc.pages.length - 1)];
    const colors = page ? collectPageColors(page) : [];
    if (!colors.length) { toast.toast(tr("editor.no_colors_on_this_page")); return; }
    onAdd(colors);
  };
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={valid ? clean : "#000000"}
          onChange={(e) => setHex(e.target.value)}
          aria-label={tr("editor.add_color")}
          title={tr("editor.add_color")}
          className="oc-color h-8 w-8 shrink-0 cursor-pointer rounded-lg border border-neutral-200"
        />
        <input
          value={hex}
          onChange={(e) => setHex(e.target.value.startsWith("#") || e.target.value === "" ? e.target.value : `#${e.target.value}`)}
          onKeyDown={(e) => { if (e.key === "Enter" && valid) { onAdd([clean]); } }}
          aria-label={tr("editor.hex")}
          placeholder="#000000"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-2 py-1.5 font-mono text-xs uppercase outline-none focus:border-brand-400"
        />
        <button
          type="button"
          onClick={() => onAdd([clean])}
          disabled={!valid}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:bg-neutral-200 disabled:text-neutral-400"
        >
          <Plus size={13} /> {tr("editor.add")}
        </button>
      </div>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={fromSelection}
          disabled={!selection.length}
          className="flex-1 rounded-lg border border-neutral-200 px-2 py-1.5 text-xs text-neutral-700 hover:border-brand-300 hover:bg-brand-50 disabled:opacity-40"
        >
          {tr("editor.add_from_selection")}
        </button>
        <button
          type="button"
          onClick={fromPage}
          className="flex-1 rounded-lg border border-neutral-200 px-2 py-1.5 text-xs text-neutral-700 hover:border-brand-300 hover:bg-brand-50"
        >
          {tr("editor.add_from_this_page")}
        </button>
      </div>
      {imageColors.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-neutral-200 p-2" data-testid="brand-image-colors">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-neutral-500">{tr("editor.colors_in_this_image")}</span>
            <button type="button" onClick={() => onAdd(imageColors)} className="text-[11px] font-medium text-brand-ink hover:underline">
              {tr("editor.add_all")}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {imageColors.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onAdd([c])}
                title={tr("editor.add_color_hex", { hex: c.toUpperCase() })}
                aria-label={tr("editor.add_color_hex", { hex: c.toUpperCase() })}
                className="group grid h-7 w-7 place-items-center rounded-md ring-1 ring-black/10 transition hover:scale-110"
                style={{ background: c }}
              >
                <Plus size={12} className="text-white opacity-0 mix-blend-difference group-hover:opacity-100" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function srgbFromHex(hex: string): Color {
  return srgbFromHexFull(hex);
}

