// Print files only after approval (F47): whether the download menu and the
// print dialog may make print files of these designs now. The server refuses
// its own print exports the same way; in the browser this keeps the
// workspace's rule visible and the print buttons off until the designs are
// approved. Roles that decide approvals are not held up.

import { useEffect, useState } from "react";
import type { PrintPolicy } from "@hc/sdk";
import { oc } from "@/lib/sdk";

export interface PrintClearance {
  policy: PrintPolicy | null;
  /** Print files are held back: the rule is on and a design is not approved. */
  blocked: boolean;
  /** How many of the designs still need their approval. */
  waiting: number;
}

export function clearanceOf(policy: PrintPolicy | null, designIds: string[]): PrintClearance {
  if (!policy || !policy.requireApproval || policy.canBypass) return { policy, blocked: false, waiting: 0 };
  const approved = new Set(policy.approved);
  const waiting = designIds.length ? designIds.filter((id) => !approved.has(id)).length : 1;
  return { policy, blocked: waiting > 0, waiting };
}

/** The rule for the open dialog's designs, loaded while it is open. */
export function usePrintClearance(open: boolean, workspaceId: string | null | undefined, designIds: string[]): PrintClearance {
  const [policy, setPolicy] = useState<PrintPolicy | null>(null);
  const key = designIds.join(",");
  useEffect(() => {
    if (!open || !workspaceId) return;
    let cancelled = false;
    oc.getPrintPolicy(workspaceId, key ? key.split(",") : []).then(
      (p) => { if (!cancelled) setPolicy(p); },
      () => { if (!cancelled) setPolicy(null); },
    );
    return () => { cancelled = true; };
  }, [open, workspaceId, key]);
  return clearanceOf(open && workspaceId ? policy : null, designIds);
}
