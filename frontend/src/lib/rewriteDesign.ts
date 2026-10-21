// Replace a design's content from outside the editor (the dashboard's
// "Change format"), so that every place the design lives agrees afterwards.
//
// The current file is not the only copy: a design edited live also has its
// CRDT update log on the server, and browsers that opened it keep that CRDT
// state offline. A plain snapshot save would leave both behind, and the next
// editor session would show (and save back) the old content. So when the
// design has a log, the new content is reconciled into the folded log as
// minimal changes and journaled as a checkpoint first; the snapshot is saved
// after it, so it is the newest state everywhere. This browser's offline copy
// of the design is dropped as well.

import type { DesignFile } from "@hc/schema";
import { fromDoc, reconcile } from "@hc/realtime";
import { oc } from "@/lib/sdk";
import { checkpointFrameOf, foldUpdates } from "@/lib/historyFold";

const CHECKPOINT_MAX = 20 * 1024 * 1024 - 4096; // the server's cap

export async function rewriteDesign(id: string, file: DesignFile, label: string): Promise<void> {
  const frames: string[] = [];
  for (let after = 0; ;) {
    const page = await oc.designUpdates(id, after || undefined);
    frames.push(...page.items.map((it) => it.update));
    if (!page.nextSeq) break;
    after = page.nextSeq;
  }
  let content = file;
  if (frames.length) {
    const doc = foldUpdates(frames);
    try {
      reconcile(file, doc);
      const frame = checkpointFrameOf(doc);
      if (frame.length * 0.75 > CHECKPOINT_MAX) throw new Error("design too large to rewrite");
      await oc.checkpointDesign(id, frame);
      content = fromDoc(doc);
    } finally {
      doc.destroy();
    }
  }
  await oc.saveSnapshot(id, { file: content, label, kind: "named" });
  dropOfflineCopy(id);
}

/** Forget this browser's offline CRDT state of a design (the editor keeps it
 *  in IndexedDB under this name), so its next session starts from the server. */
function dropOfflineCopy(id: string) {
  try {
    if (typeof indexedDB !== "undefined") indexedDB.deleteDatabase(`oc-design-${id}`);
  } catch {
    // Storage blocked: nothing was kept either.
  }
}
