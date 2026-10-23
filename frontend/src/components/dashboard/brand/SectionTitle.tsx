// A section heading on the Brand page, styled like the roles page's.

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function SectionTitle({ icon: Icon, label, count, action }: { icon: LucideIcon; label: string; count?: number; action?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-2 px-2">
      <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-neutral-400">
        <Icon size={15} /> {label}
        {count !== undefined && <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-500">{count}</span>}
      </h3>
      {action}
    </div>
  );
}
