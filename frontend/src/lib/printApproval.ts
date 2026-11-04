// Print files only after approval (F47): whether the download menu and the
// print dialog may make print files of these designs now. The server refuses
// its own print exports the same way; in the browser this keeps the
// workspace's rule visible and the print buttons off until the designs are
// approved. Roles that decide approvals are not held up.

import { useEffect, useState } from "react";
import { ApiError } from "@hc/sdk";
import type { PrintPolicy } from "@hc/sdk";
import { oc } from "@/lib/sdk";

export interface PrintClearance {
  policy: PrintPolicy | null;
  /** Whether the rule is known: "loading" and "unavailable" are not an answer. */
  state: "known" | "loading" | "unavailable";
  /** The rule is on and a design is not approved. */
  blocked: boolean;
  /** Print files wait: blocked, or the rule is not known yet. */
  held: boolean;
  /** How many of the designs still need their approval. */
  waiting: number;
}

export function clearanceOf(policy: PrintPolicy | null, designIds: string[]): PrintClearance {
  if (!policy || !policy.requireApproval || policy.canBypass) return { policy, state: "known", blocked: false, held: false, waiting: 0 };
  const approved = new Set(policy.approved);
  const waiting = designIds.length ? designIds.filter((id) => !approved.has(id)).length : 1;
  return { policy, state: "known", blocked: waiting > 0, held: waiting > 0, waiting };
}

const unknownRule = (state: "loading" | "unavailable"): PrintClearance => ({ policy: null, state, blocked: false, held: true, waiting: 0 });

/** A caller outside the workspace (403) or a workspace that is gone (404) has
 *  no rule to read, which is an answer. Anything else leaves the rule unknown. */
const hasNoRule = (e: unknown) => e instanceof ApiError && (e.status === 403 || e.status === 404);

interface Answer {
  /** What it answers, so an answer for other designs never counts. */
  key: string;
  policy: PrintPolicy | null;
  failed: boolean;
}

/** The rule for the open dialog's designs, loaded while it is open. `recheck`
 *  asks the server again, for the moment the print file is made; `retry` loads
 *  it anew after a failure. */
export function usePrintClearance(open: boolean, workspaceId: string | null | undefined, designIds: string[]): PrintClearance & { recheck: () => Promise<PrintClearance>; retry: () => void } {
  const idsKey = designIds.join(",");
  const ids = idsKey ? idsKey.split(",") : [];
  const key = `${workspaceId ?? ""}|${idsKey}`;
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [attempt, setAttempt] = useState(0);

  async function load(): Promise<Answer> {
    try {
      return { key, policy: await oc.getPrintPolicy(workspaceId!, ids), failed: false };
    } catch (e) {
      return { key, policy: null, failed: !hasNoRule(e) };
    }
  }

  useEffect(() => {
    if (!open || !workspaceId) return;
    let cancelled = false;
    void load().then((a) => { if (!cancelled) setAnswer(a); });
    return () => {
      cancelled = true;
      // Closing or retrying forgets the answer: reopened, the dialog asks again.
      setAnswer(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load reads exactly these
  }, [open, workspaceId, idsKey, attempt]);

  const of = (a: Answer) => (a.failed ? unknownRule("unavailable") : clearanceOf(a.policy, ids));
  const current = !open || !workspaceId ? clearanceOf(null, ids) : answer?.key === key ? of(answer) : unknownRule("loading");

  return {
    ...current,
    recheck: async () => {
      if (!workspaceId) return clearanceOf(null, ids);
      const a = await load();
      setAnswer(a);
      return of(a);
    },
    retry: () => setAttempt((n) => n + 1),
  };
}
