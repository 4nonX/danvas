// A checklist of a workspace's brand kits with "All brands" on top: tick
// single kits, or all of them at once (unticking one leaves "all").

import type { BrandKit } from "@hc/sdk";
import { tr } from "@/lib/i18n";

export interface KitChoice {
  all: boolean;
  kitIds: string[];
}

export const noKits: KitChoice = { all: false, kitIds: [] };

export function kitChoiceEmpty(c: KitChoice): boolean {
  return !c.all && c.kitIds.length === 0;
}

export function KitChecklist({ kits, value, onChange, disabled }: { kits: BrandKit[]; value: KitChoice; onChange: (v: KitChoice) => void; disabled?: boolean }) {
  const ticked = (id: string) => value.all || value.kitIds.includes(id);
  const box = "h-4 w-4 shrink-0 rounded border-neutral-300 accent-brand-500";
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-neutral-800">
        <input
          type="checkbox"
          checked={value.all}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked ? { all: true, kitIds: kits.map((k) => k.id) } : noKits)}
          className={box}
        />
        {tr("brand.copy_all", { count: kits.length })}
      </label>
      <div className="ms-6 flex flex-col gap-1">
        {kits.map((k) => (
          <label key={k.id} className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={ticked(k.id)}
              disabled={disabled}
              onChange={(e) => {
                const ids = new Set(value.all ? kits.map((x) => x.id) : value.kitIds);
                if (e.target.checked) ids.add(k.id); else ids.delete(k.id);
                const list = kits.map((x) => x.id).filter((id) => ids.has(id));
                onChange({ all: list.length === kits.length && kits.length > 0, kitIds: list });
              }}
              className={box}
            />
            <span className="truncate">{k.name}</span>
            {k.isDefault && <span className="shrink-0 text-[11px] text-neutral-400">{tr("brand.default")}</span>}
          </label>
        ))}
      </div>
    </div>
  );
}
