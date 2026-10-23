// The kit's graphics in the editor's brand panel (F50): by category, with a
// search across all of them. A click places a graphic, and so does dragging
// it onto the page; an SVG goes in as editable vector shapes named after it.
// Managing them (upload, rename, move, replace, remove) is on the dashboard's
// Brand page.

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { BrandKit } from "@hc/sdk";
import { resolveAssetUrl } from "@/lib/sdk";
import { BRAND_GRAPHIC_DRAG, categoryName, graphicName, isSvgAsset } from "@/lib/brandGraphics";
import { tr } from "@/lib/i18n";
import { ArtworkPreview } from "@/components/ui/ArtworkPreview";

export interface GraphicInfo { url: string; filename: string | null; mimeType: string | null; thumbnail?: string | null }

export function BrandGraphicsSection({ kit, assets, onPlace }: {
  kit: BrandKit;
  assets: Record<string, GraphicInfo>;
  onPlace: (assetId: string, name: string) => void;
}) {
  const cols = kit.collections.filter((c) => c.assetIds.length > 0);
  const [catId, setCatId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const cat = cols.find((c) => c.id === catId) ?? cols[0];
  const q = query.trim().toLowerCase();
  const items = useMemo(() => {
    const all = q ? cols.flatMap((c) => c.assetIds) : cat?.assetIds ?? [];
    const seen = new Set<string>();
    return all
      .filter((id) => !seen.has(id) && seen.add(id) && !!assets[id])
      .map((id) => ({ id, name: graphicName(assets[id].filename) || tr("brand.unnamed") }))
      .filter((x) => !q || x.name.toLowerCase().includes(q));
  }, [cols, cat, q, assets]);
  if (!cols.length) return null;

  return (
    <div>
      {cols.length > 1 && (
        <div className="mb-1.5 flex flex-wrap gap-1" role="tablist" aria-label={tr("brand.categories")}>
          {cols.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={!q && cat?.id === c.id}
              onClick={() => { setCatId(c.id); setQuery(""); }}
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${!q && cat?.id === c.id ? "bg-brand-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}
            >
              {categoryName(c)}
            </button>
          ))}
        </div>
      )}
      <label className="mb-1.5 flex h-7 items-center gap-1.5 rounded-lg border border-neutral-200 bg-surface px-2 focus-within:border-brand-400">
        <Search size={12} className="text-neutral-400" />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr("brand.search")} aria-label={tr("brand.search")} className="w-full min-w-0 bg-transparent text-xs outline-none" />
      </label>
      {items.length === 0 ? (
        <p className="text-[11px] text-neutral-400">{tr("brand.no_matches")}</p>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {items.map(({ id, name }) => {
            const a = assets[id];
            const url = resolveAssetUrl(a.url);
            return (
              <button
                key={id}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(BRAND_GRAPHIC_DRAG, JSON.stringify({ url, svg: isSvgAsset(a), name }));
                  if (!isSvgAsset(a)) e.dataTransfer.setData("application/x-oc-image", url);
                }}
                onClick={() => onPlace(id, name)}
                title={name}
                aria-label={tr("brand.place_graphic", { name })}
                className="flex aspect-square overflow-hidden rounded-lg border border-neutral-200 hover:border-brand-300"
              >
                <ArtworkPreview src={resolveAssetUrl(a.thumbnail || a.url)} className="h-full w-full p-1.5" tile={8} draggable={false} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
