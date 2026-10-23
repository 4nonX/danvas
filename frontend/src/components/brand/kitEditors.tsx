// Editors for a brand kit's contents, shared by the dashboard's Brand page
// (where the kit is managed, brand.kits) and the editor's brand panel: font
// roles, the uploads picker, the version history, and the two ways to start a
// kit (from a logo, from a website).

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Plus, RotateCcw, Sparkles, Upload, X } from "lucide-react";
import type { BrandKit, BrandKitVersion, UploadedAsset } from "@hc/sdk";
import type { Color } from "@hc/schema";
import { extractPalette, toHex, type Bitmap } from "@hc/color";
import { fontCatalog, type FontCategory } from "@hc/text";
import { directUploadWithProgress, oc, resolveAssetUrl } from "@/lib/sdk";
import { useToast } from "@/components/ui/Toast";
import { CodedError, userMessage } from "@/lib/errors";
import { fonts } from "@/lib/fontProvider";
import { useWorkspaceFontFamilies } from "@/lib/workspaceFonts";
import { tr } from "@/lib/i18n";

const FONT_CATEGORIES: FontCategory[] = ["sans-serif", "serif", "display", "handwriting", "monospace"];

// The bundled families as <option>s, built once on first use (~2k entries).
let fontOptions: React.ReactNode = null;
function FONT_FAMILY_OPTIONS() {
  fontOptions ??= FONT_CATEGORIES.map((cat) => (
    <optgroup key={cat} label={cat} className="capitalize">
      {fontCatalog.filter((f) => f.category === cat && !f.system).map((f) => (
        <option key={f.family} value={f.family}>{f.family}</option>
      ))}
    </optgroup>
  ));
  return fontOptions;
}

/** A kit's version history with a two-step restore (FR-9, brand.kits). */
export function VersionHistory({ kitId, onRestored }: { kitId: string; onRestored: (kit: BrandKit) => void | Promise<void> }) {
  const toast = useToast();
  const [versions, setVersions] = useState<BrandKitVersion[] | null>(null);
  const [busy, setBusy] = useState(false);
  // Two-step restore confirm (matches the app's in-app dialog style): the first
  // click arms a version, the second within the window restores it.
  const [confirmVersion, setConfirmVersion] = useState<number | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedFor = useRef<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const list = await oc.listBrandKitVersions(kitId);
      setVersions(list);
      loadedFor.current = kitId;
    } catch {
      setVersions([]);
    } finally {
      setBusy(false);
    }
  }, [kitId]);

  // The body only mounts while the (collapsible) section is open, so load on
  // mount and whenever the kit changes.
  useEffect(() => {
    if (loadedFor.current !== kitId) void load();
  }, [kitId, load]);

  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); }, []);

  const restore = useCallback(async (version: number) => {
    if (confirmTimer.current) { clearTimeout(confirmTimer.current); confirmTimer.current = null; }
    setConfirmVersion(null);
    setBusy(true);
    try {
      const updated = await oc.restoreBrandKitVersion(kitId, version);
      await onRestored(updated);
      await load();
      toast.success(`Restored to v${version}.`);
    } catch {
      toast.error(tr("editor.couldnt_restore_that_version"));
    } finally {
      setBusy(false);
    }
  }, [kitId, onRestored, load, toast]);

  // Arm (first click) or restore (second click within the window).
  const onRestoreClick = useCallback((version: number) => {
    if (confirmVersion === version) { void restore(version); return; }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirmVersion(version);
    confirmTimer.current = setTimeout(() => setConfirmVersion(null), 3500);
  }, [confirmVersion, restore]);

  return (
    <>
      {busy && !versions && <p className="text-xs text-neutral-400">{tr("editor.loading")}</p>}
      {versions && versions.length === 0 && <p className="text-xs text-neutral-400">{tr("editor.no_versions_recorded_yet")}</p>}
      {versions && versions.length > 0 && (
        <ul className="flex flex-col gap-1">
          {versions.map((v) => (
            <li key={v.id} className="flex items-center justify-between rounded-lg border border-neutral-100 bg-neutral-50 px-2 py-1.5 text-xs">
              <span className="text-neutral-600">
                v{v.version}
                <span className="ms-2 text-[10px] text-neutral-400">{new Date(v.createdAt).toLocaleString()}</span>
              </span>
              <button
                onClick={() => onRestoreClick(v.version)}
                disabled={busy}
                title={confirmVersion === v.version ? tr("editor.click_again_to_restore_history_is_preserved") : `Restore to v${v.version}`}
                className={`flex items-center gap-1 hover:underline disabled:opacity-50 ${confirmVersion === v.version ? "font-semibold text-red-600" : "text-brand-ink"}`}
              >
                <RotateCcw size={12} /> {confirmVersion === v.version ? tr("editor.confirm_restore") : tr("editor.restore")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function ControlToggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center justify-between text-sm text-neutral-700">
      <span>{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${checked ? "bg-brand-600" : "bg-neutral-300"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface transition-all ${checked ? "start-4" : "start-0.5"}`} />
      </button>
    </label>
  );
}

/** A kit's font roles: any number of named roles (heading, body, prices, ...). */
export function BrandFontsEditor({ fonts: list, onChange }: { fonts: BrandKit["fonts"]; onChange: (next: BrandKit["fonts"]) => void }) {
  const workspaceFamilies = useWorkspaceFontFamilies();
  const setAt = (i: number, patch: Partial<BrandKit["fonts"][number]>) => onChange(list.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="flex flex-col gap-1.5">
      {list.map((f, i) => (
        <div key={f.id} className="flex items-center gap-1.5">
          <input
            key={`${f.id}-${f.role}`}
            defaultValue={f.role}
            aria-label={tr("editor.font_role")}
            placeholder={tr("editor.font_role_placeholder")}
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== f.role) setAt(i, { role: v }); }}
            title={f.role}
            className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-2 py-1.5 text-xs outline-none focus:border-brand-400"
          />
          <select
            value={f.fontFamily}
            aria-label={tr("editor.font_family")}
            onChange={(e) => { fonts.ensure(e.target.value); setAt(i, { fontFamily: e.target.value }); }}
            style={{ fontFamily: `'${f.fontFamily}', sans-serif` }}
            className="h-8 min-w-0 flex-1 truncate rounded-lg border border-neutral-200 bg-surface px-2 text-xs outline-none focus:border-brand-400"
          >
            {!workspaceFamilies.includes(f.fontFamily) && <option value={f.fontFamily}>{f.fontFamily}</option>}
            {workspaceFamilies.length > 0 && (
              <optgroup label={tr("editor.workspace_fonts")}>
                {workspaceFamilies.map((w) => <option key={`ws-${w}`} value={w}>{w}</option>)}
              </optgroup>
            )}
            {FONT_FAMILY_OPTIONS()}
          </select>
          <button
            type="button"
            title={tr("editor.remove_font_role")}
            aria-label={tr("editor.remove_font_role")}
            onClick={() => onChange(list.filter((_, j) => j !== i))}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-red-600"
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...list, { id: `f-${crypto.randomUUID()}`, role: tr("editor.new_font_role"), fontFamily: workspaceFamilies[0] ?? list[list.length - 1]?.fontFamily ?? "Inter" }])} // i18n-ignore: a font family name, not UI text
        className="flex items-center justify-center gap-1 rounded-lg border border-dashed border-neutral-300 py-1.5 text-xs font-medium text-neutral-500 hover:border-brand-300 hover:text-brand-ink"
      >
        <Plus size={13} /> {tr("editor.add_font_role")}
      </button>
    </div>
  );
}

/** The workspace's uploads as a pick grid, optionally with an upload button
 *  (the new file is uploaded to the workspace and picked right away). */
export function UploadPicker({ workspaceId, assetUrls, onPick, allowUpload = false }: { workspaceId: string; assetUrls: Record<string, string>; onPick: (assetId: string, filename: string, url?: string) => void; allowUpload?: boolean }) {
  const [assets, setAssets] = useState<UploadedAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  useEffect(() => {
    void oc.listAssets(workspaceId).then((a) => setAssets(a as UploadedAsset[])).catch(() => setAssets([]));
  }, [workspaceId]);
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const asset = await directUploadWithProgress(workspaceId, file, { filename: file.name });
      onPick(asset.id, file.name, asset.url);
    } catch (e) {
      toast.error(userMessage(e, tr("editor.upload_failed")));
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="mt-2 grid grid-cols-4 gap-1.5">
      {allowUpload && (
        <>
          <input ref={fileRef} type="file" accept="image/svg+xml,image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title={tr("editor.upload_logo")}
            className="flex aspect-square flex-col items-center justify-center gap-0.5 rounded border border-dashed border-neutral-300 text-[10px] text-neutral-500 hover:border-brand-300 hover:text-brand-ink disabled:opacity-50"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {tr("editor.upload")}
          </button>
        </>
      )}
      {assets.length === 0 && !allowUpload && <span className="col-span-4 text-[11px] text-neutral-400">{tr("editor.no_uploads")}</span>}
      {assets.map((a) => (
        <button
          key={a.id}
          onClick={() => onPick(a.id, a.filename ?? tr("editor.logo"), a.url)}
          className="flex aspect-square items-center justify-center overflow-hidden rounded border border-neutral-200 hover:border-brand-300"
          title={a.filename ?? "asset"}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={resolveAssetUrl(assetUrls[a.id] ?? a.url)} alt={a.filename ?? ""} className="max-h-full max-w-full object-contain" />
        </button>
      ))}
    </div>
  );
}

/**
 * Auto-generate a brand kit from a logo (FR-1 empty-state UX). Fully
 * client-side: the user picks a logo image, we decode it to a canvas, extract a
 * small dominant-color palette via @hc/color's median-cut helper, pair it with
 * sensible default heading/body fonts, upload the logo as an asset, then create
 * a brand kit pre-filled with the palette + logo + fonts. No backend image
 * decoding. Gated to brand.kits by the caller.
 */
export function GenerateFromLogo({
  workspaceId,
  onCreated,
}: {
  workspaceId: string;
  onCreated: (kit: BrandKit) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = useCallback(async (file: File) => {
    if (typeof document === "undefined") return;
    setBusy(true);
    try {
      // Decode to a data URL, then to an <img> so we can sample pixels.
      const dataUrl: string = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(r.error);
        r.readAsDataURL(file);
      });
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const el = new Image();
        el.onload = () => res(el);
        el.onerror = () => rej(new CodedError("errors.image_decode_failed", "Couldn't decode the image."));
        el.src = dataUrl;
      });

      // Sample at a modest size (longest side ~128px) for a fast, stable palette.
      const SAMPLE = 128;
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      let palette: string[] = [];
      if (w && h) {
        const scale = Math.min(1, SAMPLE / Math.max(w, h));
        const sw = Math.max(1, Math.round(w * scale));
        const sh = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement("canvas");
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, sw, sh);
          const bmp: Bitmap = ctx.getImageData(0, 0, sw, sh);
          palette = extractPalette(bmp, 6).map(toHex);
        }
      }
      // Dedup while preserving order; always offer at least one swatch.
      palette = [...new Set(palette)];

      // Upload the logo as a workspace asset so it round-trips as a brand logo.
      const asset = await directUploadWithProgress(workspaceId, file, { filename: file.name });

      // Create the kit, then fill it with the extracted palette + logo + default
      // heading/body fonts (the text engine's registry resolves these family names).
      const created = await oc.createBrandKit(workspaceId, { name: tr("editor.brand_from_logo") });
      const filled = await oc.updateBrandKit(created.id, {
        palettes:
          palette.length > 0
            ? [
                {
                  id: `p-${crypto.randomUUID()}`,
                  name: tr("editor.logo_palette"),
                  colors: palette.map((hex, i) => ({
                    id: `s-${crypto.randomUUID()}`,
                    role: i === 0 ? "primary" : i === 1 ? "secondary" : "accent",
                    value: srgbFromHexFull(hex),
                  })),
                },
              ]
            : [],
        fonts: [
          { id: `f-${crypto.randomUUID()}`, role: "heading", fontFamily: "Inter" },
          { id: `f-${crypto.randomUUID()}`, role: "body", fontFamily: "Inter" },
        ],
        logos: [{ id: `l-${crypto.randomUUID()}`, label: file.name || tr("editor.logo"), assetId: asset.id }],
      });

      onCreated(filled);
      toast.success(`Brand kit generated from logo (${palette.length} colors).`);
    } catch {
      toast.error(tr("editor.couldnt_generate_a_brand_kit_from_that_logo"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [workspaceId, onCreated, toast]);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-ink hover:bg-brand-100 disabled:opacity-60"
      >
        <Sparkles size={15} /> {busy ? tr("editor.generating") : tr("editor.generate_from_logo")}
      </button>
    </>
  );
}

/** F28 T21: draft a brand kit from a company web page. The server scans the
 *  page behind its SSRF gate (logo candidates, palette, font guesses) and the
 *  result is a DRAFT shown here for review - nothing is created or saved
 *  until the user confirms, and the chosen logo is imported server-side as a
 *  workspace asset (never hotlinked). */
export function BrandFromWebsite({
  workspaceId,
  onCreated,
}: {
  workspaceId: string;
  onCreated: (kit: BrandKit) => void;
}) {
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<{ name: string; logoUrls: string[]; colors: string[]; fonts: string[] } | null>(null);
  const [logoChoice, setLogoChoice] = useState<string | null>(null);

  const fetchDraft = async () => {
    const target = url.trim();
    if (!target || busy) return; // Enter fires this too; never stack scans
    setBusy(true);
    try {
      const d = await oc.aiBrandFromUrl({ workspaceId, url: /^https?:\/\//i.test(target) ? target : `https://${target}` });
      // Normalize defensively: a missing bucket must be an array, or every
      // .length/.map below throws mid-render.
      const clean = {
        name: d.name ?? "",
        logoUrls: Array.isArray(d.logoUrls) ? d.logoUrls : [],
        colors: Array.isArray(d.colors) ? d.colors : [],
        fonts: Array.isArray(d.fonts) ? d.fonts : [],
      };
      setDraft(clean);
      setLogoChoice(clean.logoUrls[0] ?? null);
    } catch (e) {
      toast.error(userMessage(e, tr("editor.couldnt_draft_a_brand_from_that_site")));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!draft) return;
    setCreating(true);
    const defaultFam = "Inter"; // i18n-ignore: a font family name, not UI text
    const headingFam = draft.fonts[0] ?? defaultFam;
    const bodyFam = draft.fonts[1] ?? draft.fonts[0] ?? defaultFam;
    let created: BrandKit | null = null;
    try {
      // The logo imports through the server (asset pipeline + its own SSRF
      // gate); an inline data-URI candidate (a data favicon) uploads its bytes
      // directly instead, since the URL importer is http(s)-only. A failed
      // import just means a kit without a logo.
      let logoAssetId: string | null = null;
      if (logoChoice?.startsWith("data:image/")) {
        const b64 = logoChoice.split(",")[1] ?? "";
        logoAssetId = b64
          ? await directUploadWithProgress(workspaceId, await (await fetch(`data:image/png;base64,${b64}`)).blob(), { filename: "logo" }).then((a) => a.id, () => null)
          : null;
      } else if (logoChoice) {
        logoAssetId = await oc.importAssetFromUrl(workspaceId, logoChoice).then((a) => a.id, () => null);
      }
      created = await oc.createBrandKit(workspaceId, { name: draft.name.slice(0, 80) || tr("editor.brand_from_website") });
      const filled = await oc.updateBrandKit(created.id, {
        palettes: draft.colors.length
          ? [{
              id: `p-${crypto.randomUUID()}`,
              name: tr("editor.website_palette"),
              colors: draft.colors.map((hex, i) => ({
                id: `s-${crypto.randomUUID()}`,
                role: i === 0 ? "primary" : i === 1 ? "secondary" : "accent",
                value: srgbFromHexFull(hex),
              })),
            }]
          : [],
        // Font FAMILIES are data, never localized; the site's guesses win,
        // with the default family as the fallback.
        fonts: [
          { id: `f-${crypto.randomUUID()}`, role: "heading", fontFamily: headingFam },
          { id: `f-${crypto.randomUUID()}`, role: "body", fontFamily: bodyFam },
        ],
        ...(logoAssetId ? { logos: [{ id: `l-${crypto.randomUUID()}`, label: draft.name.slice(0, 80) || tr("editor.logo"), assetId: logoAssetId }] } : {}),
      });
      onCreated(filled);
      setDraft(null);
      setUrl("");
      toast.success(tr("editor.brand_kit_created_from_website"));
    } catch (e) {
      // Roll back a half-made kit: without this, a failed fill leaves an
      // empty kit that also hides this whole flow (it only shows when the
      // workspace has no kits), so a retry would be impossible.
      if (created) await oc.deleteBrandKit(created.id).catch(() => {});
      toast.error(userMessage(e, tr("editor.couldnt_create_that_brand_kit")));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void fetchDraft(); }}
          placeholder={tr("editor.acme_com")}
          aria-label={tr("editor.company_website")}
          className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand-400"
        />
        <button
          onClick={() => void fetchDraft()}
          disabled={busy || !url.trim()}
          className="shrink-0 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-ink hover:bg-brand-100 disabled:opacity-60"
          data-testid="brand-from-url"
        >
          {busy ? tr("editor.scanning") : tr("editor.draft_from_website")}
        </button>
      </div>
      {draft && (
        <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-surface p-2" data-testid="brand-draft">
          <div className="text-sm font-medium text-neutral-800">{draft.name}</div>
          {draft.colors.length > 0 && (
            <div className="flex items-center gap-1">
              {draft.colors.map((c) => (
                <span key={c} title={c} style={{ background: c }} className="h-5 w-5 rounded ring-1 ring-black/10" />
              ))}
            </div>
          )}
          {draft.fonts.length > 0 && <div className="text-[11px] text-neutral-500">{draft.fonts.join(" · ")}</div>}
          {draft.logoUrls.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {draft.logoUrls.slice(0, 4).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setLogoChoice(logoChoice === u ? null : u)}
                  aria-pressed={logoChoice === u}
                  title={tr("editor.use_as_the_kit_logo")}
                  className={`rounded border p-0.5 ${logoChoice === u ? "border-brand-500 ring-2 ring-brand-100" : "border-neutral-200"}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={u}
                    alt=""
                    className="h-8 w-8 rounded object-contain"
                    onError={(e) => {
                      // A broken candidate (404, mixed content) is useless:
                      // hide its button and drop it as the selection.
                      const btn = e.currentTarget.closest("button");
                      if (btn) btn.style.display = "none";
                      setLogoChoice((cur) => (cur === u ? null : cur));
                    }}
                  />
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-1.5">
            <button
              onClick={() => void confirm()}
              disabled={creating}
              className="flex-1 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              data-testid="brand-draft-confirm"
            >
              {creating ? tr("editor.creating") : tr("editor.create_brand_kit")}
            </button>
            <button onClick={() => setDraft(null)} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">
              {tr("editor.discard")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** sRGB Color -> #rrggbb (alpha dropped). */
export function hexOf(c: Color): string {
  const ch = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${ch(c.srgb.r)}${ch(c.srgb.g)}${ch(c.srgb.b)}`;
}

/** #rrggbb -> an sRGB Color. */
export function srgbFromHexFull(hex: string): Color {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16);
  const r = Number.isNaN(n) ? 0 : (n >> 16) & 255;
  const g = Number.isNaN(n) ? 0 : (n >> 8) & 255;
  const b = Number.isNaN(n) ? 0 : n & 255;
  return { srgb: { r: r / 255, g: g / 255, b: b / 255, a: 1 } };
}
