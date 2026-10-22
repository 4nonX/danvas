// Print files only after approval (F47): the workspace's rule. Every member
// sees whether it is on, since it holds up their print exports; roles.manage
// switches it. Roles that decide approvals are not held up by it.

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { PrintPolicy } from "@hc/sdk";
import { oc } from "@/lib/sdk";
import { useToast } from "@/components/ui/Toast";
import { userMessage } from "@/lib/errors";
import { tr } from "@/lib/i18n";

export function PrintApprovalPanel({ workspaceId }: { workspaceId: string }) {
  const toast = useToast();
  const [policy, setPolicy] = useState<PrintPolicy | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    oc.getPrintPolicy(workspaceId, []).then(
      (p) => { if (!cancelled) setPolicy(p); },
      () => { if (!cancelled) setPolicy(null); },
    );
    return () => { cancelled = true; };
  }, [workspaceId]);

  async function toggle() {
    if (!policy) return;
    setBusy(true);
    try {
      setPolicy(await oc.setPrintPolicy(workspaceId, !policy.requireApproval));
    } catch (err) {
      toast.error(userMessage(err, tr("dashboard.print_approval_save_failed")));
    } finally {
      setBusy(false);
    }
  }

  if (!policy) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-neutral-400">
        <ShieldCheck size={15} /> {tr("dashboard.print_approval")}
      </h2>
      <p className="mb-3 max-w-xl text-xs text-neutral-500">{tr("dashboard.print_approval_hint")}</p>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-surface p-3">
        <label className="flex min-w-0 flex-1 items-center gap-2.5 text-sm text-neutral-800">
          <input
            type="checkbox"
            checked={policy.requireApproval}
            disabled={busy || !policy.canChange}
            onChange={() => void toggle()}
            className="h-4 w-4 shrink-0 accent-brand-600"
          />
          {tr("dashboard.print_approval_toggle")}
        </label>
        {!policy.canChange && <span className="text-xs text-neutral-500">{tr("dashboard.print_approval_admins_only")}</span>}
      </div>
    </section>
  );
}
