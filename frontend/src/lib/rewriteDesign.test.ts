// Replacing a design's content from the dashboard: the journal, the saved
// file and a browser's stale offline copy all end up at the new content.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import { fromDoc, reconcile } from "@hc/realtime";
import type { DesignFile } from "@hc/schema";

const calls: { checkpoint: string[]; snapshot: { file: DesignFile; label?: string; kind?: string }[] } = { checkpoint: [], snapshot: [] };
let journal: string[] = [];
vi.mock("@/lib/sdk", () => ({
  oc: {
    designUpdates: async () => ({ items: journal.map((update, i) => ({ seq: i + 1, update })), nextSeq: 0 }),
    checkpointDesign: async (_id: string, update: string) => { calls.checkpoint.push(update); },
    saveSnapshot: async (_id: string, input: { file: DesignFile; label?: string; kind?: string }) => { calls.snapshot.push(input); return {}; },
  },
}));
import { rewriteDesign } from "./rewriteDesign";
import { foldUpdates } from "./historyFold";

const design = (w: number, h: number, x: number): DesignFile => ({
  format: "hycanvas.design", schemaVersion: 29, id: "d", title: "L", unit: "px", dpi: 96, assets: [], fonts: [], meta: {},
  pages: [{ id: "p", width: w, height: h, children: [{ id: "r", name: "r", type: "shape", shape: "rect", transform: { x, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, size: { width: 10, height: 10 }, opacity: 1, blendMode: "normal" }] }],
} as unknown as DesignFile);

/** One journaled frame (a y-protocols update) of everything in `doc`. */
function frameOf(doc: Y.Doc) {
  const enc = encoding.createEncoder();
  syncProtocol.writeUpdate(enc, Y.encodeStateAsUpdate(doc));
  return Buffer.from(encoding.toUint8Array(enc)).toString("base64");
}
const pageSize = (f: DesignFile) => [f.pages[0].width, f.pages[0].height];

beforeEach(() => {
  calls.checkpoint = [];
  calls.snapshot = [];
  journal = [];
});

describe("rewriting a design from outside the editor", () => {
  it("saves only a named version when the design was never edited live", async () => {
    await rewriteDesign("d", design(189, 378, 5), "Format 50 × 100 mm");
    expect(calls.checkpoint).toEqual([]);
    expect(calls.snapshot).toHaveLength(1);
    expect(calls.snapshot[0]).toMatchObject({ label: "Format 50 × 100 mm", kind: "named" });
    expect(pageSize(calls.snapshot[0].file)).toEqual([189, 378]);
  });

  it("journals the change so a stale offline copy converges on it", async () => {
    // A browser edited the design live: its offline copy and the journal hold
    // the same CRDT history.
    const offline = new Y.Doc();
    reconcile(design(340, 151, 5), offline);
    journal = [frameOf(offline)];

    await rewriteDesign("d", design(189, 378, 40), "Format 50 × 100 mm");

    // The checkpoint is written before the version, and both hold the new content.
    expect(calls.checkpoint).toHaveLength(1);
    const cp = foldUpdates(calls.checkpoint);
    expect(pageSize(fromDoc(cp))).toEqual([189, 378]);
    expect(pageSize(calls.snapshot[0].file)).toEqual([189, 378]);

    // The stale copy merges the checkpoint and shows the new format, with no
    // duplicated pages or elements.
    Y.applyUpdate(offline, Y.encodeStateAsUpdate(cp));
    const merged = fromDoc(offline);
    expect(merged.pages).toHaveLength(1);
    expect(pageSize(merged)).toEqual([189, 378]);
    expect(merged.pages[0].children.map((n) => n.id)).toEqual(["r"]);
    expect((merged.pages[0].children[0] as { transform: { x: number } }).transform.x).toBe(40);
  });
});
