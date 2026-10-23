// "Brand" (F50): one page for the workspace's brands. A brand is a brand kit,
// shown on the tabs the editor's brand panel uses: colours, fonts, logos,
// graphics, and its settings. Everyone in the workspace sees it; what a role
// may change follows its actions (F42): brand.kits the brand itself (and its
// library), brand.library only the graphics, fonts.manage the workspace's
// font files. New brands start empty, from a logo, from a website or from a
// kit file, with the suggested logo versions. Each change is one kit update,
// so it shows in the version history.

import { useCallback, useEffect, useState } from "react";
import { ImageIcon, Loader2, Palette, Plus, Settings2, Shapes, Type as TypeIcon } from "lucide-react";
import type { BrandKit, BrandKitPatch, UploadedAsset } from "@hc/sdk";
import { oc } from "@/lib/sdk";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { userMessage } from "@/lib/errors";
import { confirmAction, promptText } from "@/lib/promptDialog";
import { BrandFromWebsite, GenerateFromLogo } from "@/components/brand/kitEditors";
import { BrandKitTransfer } from "@/components/brand/BrandKitTransfer";
import { tr } from "@/lib/i18n";
import { BrandColorsTab } from "./brand/BrandColorsTab";
import { BrandFontsTab } from "./brand/BrandFontsTab";
import { BrandLogosTab } from "./brand/BrandLogosTab";
import { BrandGraphicsTab } from "./brand/BrandGraphicsTab";
import { BrandSettingsTab } from "./brand/BrandSettingsTab";
import type { BrandAssets } from "./brand/types";
import { defaultLogoVersions } from "./brand/LogoVersionsEditor";
import { LEGACY_VERSIONS, relinkLogos } from "@/lib/logoVersions";

export const brandTabs = ["colors", "fonts", "logos", "graphics", "settings"] as const;
export type BrandTab = (typeof brandTabs)[number];

// The tab is part of the address (#graphics), so the editor can link to it.
function tabFromHash(): BrandTab | null {
  if (typeof window === "undefined") return null;
  const h = window.location.hash.slice(1);
  return (brandTabs as readonly string[]).includes(h) ? (h as BrandTab) : null;
}

export function BrandPage({ workspaceId, canEditKit, canEditLibrary = canEditKit, canEditFonts = false }: {
  workspaceId: string;
  /** May change the brands themselves (brand.kits). */
  canEditKit: boolean;
  /** May maintain the graphics (brand.library, or brand.kits). */
  canEditLibrary?: boolean;
  /** May change the workspace's font files (fonts.manage). */
  canEditFonts?: boolean;
}) {
  const toast = useToast();
  const [kits, setKits] = useState<BrandKit[] | null>(null);
  const [kitId, setKitId] = useState<string | null>(null);
  const [assets, setAssets] = useState<BrandAssets>(new Map());
  const [tab, setTabState] = useState<BrandTab>(() => tabFromHash() ?? "colors");
  const [creating, setCreating] = useState(false);

  const setTab = useCallback((t: BrandTab) => {
    setTabState(t);
    try { window.history.replaceState(null, "", `#${t}`); } catch { /* not in a browser */ }
  }, []);

  const loadKits = useCallback(async (select?: string) => {
    const list = await oc.listBrandKits(workspaceId);
    setKits(list);
    setKitId((cur) => {
      const want = select ?? cur;
      return want && list.some((k) => k.id === want) ? want : (list.find((k) => k.isDefault) ?? list[0])?.id ?? null;
    });
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([oc.listBrandKits(workspaceId), oc.listAssets(workspaceId).catch((): UploadedAsset[] => [])]).then(
      ([list, files]) => {
        if (cancelled) return;
        setKits(list);
        setAssets(new Map(files.map((a) => [a.id, a])));
        setKitId((cur) => (cur && list.some((k) => k.id === cur) ? cur : (list.find((k) => k.isDefault) ?? list[0])?.id ?? null));
      },
      (e) => {
        if (cancelled) return;
        setKits([]);
        toast.error(userMessage(e, tr("brand.load_failed")));
      },
    );
    return () => { cancelled = true; };
  }, [workspaceId, toast]);

  const kit = kits?.find((k) => k.id === kitId) ?? null;
  const replaceKit = useCallback((updated: BrandKit) => setKits((ks) => ks?.map((k) => (k.id === updated.id ? updated : k)) ?? ks), []);

  // One kit update per change (versioned, restorable).
  const save = useCallback(async (patch: BrandKitPatch, done?: string) => {
    if (!kit) return false;
    try {
      replaceKit(await oc.updateBrandKit(kit.id, patch));
      if (done) toast.success(done);
      return true;
    } catch (e) {
      toast.error(userMessage(e, tr("brand.save_failed")));
      return false;
    }
  }, [kit, replaceKit, toast]);

  const created = useCallback((k: BrandKit) => {
    setKits((ks) => [...(ks ?? []).filter((x) => x.id !== k.id), k]);
    setKitId(k.id);
    setCreating(false);
    setTab("colors");
    // A new brand starts with the suggested logo versions (colour, black,
    // white); its logos so far move into them. Changeable under Settings.
    if (!k.logoVersions?.length) {
      const versions = defaultLogoVersions();
      void oc.updateBrandKit(k.id, { logoVersions: versions, logos: relinkLogos(k.logos, LEGACY_VERSIONS, versions) })
        .then((u) => setKits((ks) => ks?.map((x) => (x.id === u.id ? u : x)) ?? ks), () => {});
    }
  }, [setTab]);

  async function createEmpty() {
    const name = await promptText({ title: tr("brand.new_brand"), label: tr("brand.kit_name"), defaultValue: tr("brand.default_kit_name"), confirmText: tr("brand.create") });
    if (!name) return;
    try {
      created(await oc.createBrandKit(workspaceId, { name, isDefault: !kits?.length }));
    } catch (e) {
      toast.error(userMessage(e, tr("brand.save_failed")));
    }
  }

  async function makeDefault() {
    if (!kit) return;
    try {
      await oc.setDefaultBrandKit(kit.id);
      await loadKits(kit.id);
      toast.success(tr("brand.default_set", { name: kit.name }));
    } catch (e) {
      toast.error(userMessage(e, tr("brand.save_failed")));
    }
  }

  async function deleteKit() {
    if (!kit) return;
    const ok = await confirmAction({ title: tr("brand.delete_brand"), message: tr("brand.delete_brand_message", { name: kit.name }), confirmText: tr("brand.delete"), danger: true });
    if (!ok) return;
    try {
      await oc.deleteBrandKit(kit.id);
      const rest = (kits ?? []).filter((k) => k.id !== kit.id);
      // The workspace keeps a standard brand while it has any.
      if (kit.isDefault && rest.length) await oc.setDefaultBrandKit(rest[0].id).catch(() => {});
      await loadKits();
      toast.success(tr("brand.brand_deleted", { name: kit.name }));
    } catch (e) {
      toast.error(userMessage(e, tr("brand.save_failed")));
    }
  }

  const onImported = async (k: BrandKit) => {
    await loadKits(k.id).catch(() => created(k));
    setCreating(false);
  };

  if (kits === null) return <p className="px-2 text-sm text-neutral-500"><Loader2 size={14} className="me-1.5 inline animate-spin" />{tr("brand.loading")}</p>;

  const newBrand = (
    <div className="flex flex-col gap-4">
      <div>
        <Button className="gap-1.5" onClick={() => void createEmpty()}><Plus size={15} /> {tr("brand.create_empty")}</Button>
      </div>
      <div>
        <span className="mb-1.5 block text-xs font-medium text-neutral-600">{tr("brand.from_logo")}</span>
        <GenerateFromLogo workspaceId={workspaceId} onCreated={created} />
      </div>
      <div>
        <span className="mb-1.5 block text-xs font-medium text-neutral-600">{tr("editor.company_website")}</span>
        <BrandFromWebsite workspaceId={workspaceId} onCreated={created} />
      </div>
      <div>
        <span className="mb-1.5 block text-xs font-medium text-neutral-600">{tr("brand.from_file")}</span>
        <BrandKitTransfer workspaceId={workspaceId} kit={null} kits={kits} onImported={onImported} />
      </div>
    </div>
  );

  if (!kit) {
    return (
      <div className="max-w-xl rounded-xl border border-neutral-200 bg-surface p-5">
        <p className="text-sm text-neutral-700">{tr("brand.no_kit")}</p>
        {canEditKit && <div className="mt-4">{newBrand}</div>}
      </div>
    );
  }

  const tabs: { id: BrandTab; label: string; icon: typeof Palette }[] = [
    { id: "colors", label: tr("editor.colors"), icon: Palette },
    { id: "fonts", label: tr("editor.fonts"), icon: TypeIcon },
    { id: "logos", label: tr("editor.logos"), icon: ImageIcon },
    { id: "graphics", label: tr("brand.graphics"), icon: Shapes },
    { id: "settings", label: tr("brand.settings"), icon: Settings2 },
  ];

  return (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap items-center gap-2 px-2">
        <label className="flex items-center gap-2 text-sm text-neutral-600">
          {tr("brand.kit")}
          <select value={kit.id} onChange={(e) => setKitId(e.target.value)} className="h-8 rounded-lg border border-neutral-200 bg-surface px-2 text-sm outline-none focus:border-brand-400">
            {kits.map((k) => <option key={k.id} value={k.id}>{k.name}{k.isDefault ? ` (${tr("brand.default")})` : ""}</option>)}
          </select>
        </label>
        {canEditKit && <Button variant="secondary" size="sm" className="gap-1" onClick={() => setCreating(true)}><Plus size={14} /> {tr("brand.new_brand")}</Button>}
      </div>

      <div role="tablist" aria-label={tr("brand.title")} className="mb-5 flex flex-wrap gap-1 rounded-lg bg-neutral-100 p-0.5 sm:w-max">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${tab === t.id ? "bg-surface text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}
          >
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {tab === "colors" && <BrandColorsTab kit={kit} canEdit={canEditKit} save={save} />}
      {tab === "fonts" && <BrandFontsTab workspaceId={workspaceId} kit={kit} canEdit={canEditKit} canEditLibrary={canEditFonts} save={save} />}
      {tab === "logos" && (
        <BrandLogosTab
          workspaceId={workspaceId}
          kit={kit}
          assets={assets}
          onUploaded={(id, filename, url) => setAssets((m) => new Map(m).set(id, { id, filename, url, mimeType: null, thumbnail: null }))}
          canEdit={canEditKit}
          save={save}
        />
      )}
      {tab === "graphics" && <BrandGraphicsTab key={kit.id} workspaceId={workspaceId} kit={kit} assets={assets} setAssets={setAssets} canEdit={canEditLibrary} onSaved={replaceKit} />}
      {tab === "settings" && (
        <BrandSettingsTab
          workspaceId={workspaceId}
          kit={kit}
          kits={kits}
          canEdit={canEditKit}
          save={save}
          onMakeDefault={() => void makeDefault()}
          onDelete={() => void deleteKit()}
          onImported={onImported}
          onRestored={replaceKit}
        />
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title={tr("brand.new_brand")} width="w-[30rem]">
        <p className="mb-4 text-sm text-neutral-500">{tr("brand.new_brand_hint")}</p>
        {newBrand}
      </Modal>
    </div>
  );
}
