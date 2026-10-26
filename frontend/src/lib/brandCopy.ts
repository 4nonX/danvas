// Copying brand kits into other workspaces runs on the server as a job; this
// starts it and waits for the result, reporting progress on the way.

import type { BrandKitCopyResult } from "@hc/sdk";
import { oc } from "@/lib/sdk";

export interface BrandCopyRequest {
  sourceWorkspaceId: string;
  /** Every kit of the source, or the ones named. */
  all: boolean;
  kitIds: string[];
  targetWorkspaceIds: string[];
  /** Replace kits of the same name; otherwise copies get a free name. */
  replace: boolean;
}

export async function runBrandCopy(
  req: BrandCopyRequest,
  onProgress?: (done: number, total: number) => void,
  cancelled: () => boolean = () => false,
): Promise<BrandKitCopyResult | null> {
  const { jobId } = await oc.copyBrandKits({
    sourceWorkspaceId: req.sourceWorkspaceId,
    all: req.all,
    kitIds: req.all ? [] : req.kitIds,
    targetWorkspaceIds: req.targetWorkspaceIds,
    replace: req.replace,
  });
  for (;;) {
    await new Promise((r) => setTimeout(r, 800));
    if (cancelled()) return null;
    const job = await oc.getJob<BrandKitCopyResult | { done: number; total: number }>(jobId);
    if (job.status === "completed") return job.result as BrandKitCopyResult;
    if (job.status === "failed") throw new Error(job.error || "copy failed");
    const p = job.result as { done?: number; total?: number } | undefined;
    if (onProgress && p && typeof p.done === "number" && typeof p.total === "number") onProgress(p.done, p.total);
  }
}
