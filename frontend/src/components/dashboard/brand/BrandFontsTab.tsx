// The Brand page's fonts: the kit's font roles (brand.kits changes them) and,
// below, the workspace's font library, the uploaded font files every design
// can use (fonts.manage changes it).

import { useEffect } from "react";
import { Type as TypeIcon } from "lucide-react";
import type { BrandKit, BrandKitPatch } from "@hc/sdk";
import { BrandFontsEditor } from "@/components/brand/kitEditors";
import { fonts } from "@/lib/fontProvider";
import { tr } from "@/lib/i18n";
import { WorkspaceFontsPanel } from "../WorkspaceFontsPanel";
import { SectionTitle } from "./SectionTitle";

export function BrandFontsTab({ workspaceId, kit, canEdit, canEditLibrary, save }: {
  workspaceId: string;
  kit: BrandKit;
  canEdit: boolean;
  canEditLibrary: boolean;
  save: (patch: BrandKitPatch, done?: string) => Promise<boolean>;
}) {
  // Previews render in the fonts themselves.
  useEffect(() => { for (const f of kit.fonts) fonts.ensure(f.fontFamily); }, [kit.fonts]);

  return (
    <div className="max-w-4xl">
      <section>
        <SectionTitle icon={TypeIcon} label={tr("brand.brand_fonts")} count={kit.fonts.length} />
        <p className="mb-3 max-w-2xl px-2 text-sm text-neutral-500">{canEdit ? tr("brand.fonts_hint") : tr("brand.fonts_hint_read_only")}</p>
        <div className="max-w-xl px-2">
          {canEdit ? (
            <BrandFontsEditor fonts={kit.fonts} onChange={(next) => void save({ fonts: next })} />
          ) : kit.fonts.length === 0 ? (
            <p className="text-sm text-neutral-500">{tr("editor.no_brand_fonts_yet")}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {kit.fonts.map((f) => (
                <li key={f.id} className="flex items-center justify-between rounded-lg border border-neutral-200 bg-surface px-3 py-2 text-sm">
                  <span className="truncate" style={{ fontFamily: `'${f.fontFamily}', sans-serif` }}>{f.fontFamily}</span>
                  <span className="ms-2 shrink-0 text-[10px] uppercase tracking-wide text-neutral-400">{f.role}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <div className="px-2">
        <WorkspaceFontsPanel workspaceId={workspaceId} canEdit={canEditLibrary} />
      </div>
    </div>
  );
}
