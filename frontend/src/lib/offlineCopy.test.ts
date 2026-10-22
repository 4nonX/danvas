import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { fromDoc, reconcile } from "@hc/realtime";
import type { DesignFile } from "@hc/schema";

// An in-memory IndexedDB of offline copies: the database name holds a Yjs
// state, loaded into the doc a persistence is bound to.
const dbs = new Map<string, Uint8Array>();
let blocked = false;
vi.mock("y-indexeddb", () => ({
  IndexeddbPersistence: class {
    whenSynced: Promise<void>;
    constructor(name: string, doc: Y.Doc) {
      const state = dbs.get(name);
      if (state) Y.applyUpdate(doc, state);
      this.whenSynced = Promise.resolve();
    }
    destroy() { return Promise.resolve(); }
  },
}));

const { contentHash, decideOfflineCopy, noteOpened, noteServerState, settleOfflineCopy } = await import("./offlineCopy");

const design = (title: string, text = "Hello"): DesignFile =>
  ({
    format: "hycanvas.design", schemaVersion: 29, id: "d1", title, unit: "px", dpi: 96, assets: [], fonts: [], meta: {},
    pages: [{
      id: "p1", width: 400, height: 200,
      children: [{
        id: "t1", type: "text", transform: { x: 10, y: 10, scaleX: 1, scaleY: 1, rotation: 0 }, size: { width: 200, height: 40 }, opacity: 1, blendMode: "normal",
        content: [{ style: { align: "left" }, runs: [{ text, style: { fontFamily: "Inter", fontSize: 16 } }, { text: " world", style: { fontFamily: "Inter", fontSize: 16, fontStyle: "Bold" } }] }],
      }],
    }],
  }) as unknown as DesignFile;

/** A browser's offline copy of `file`, as the editor's CRDT stores it. */
function storeCopy(designId: string, file: DesignFile) {
  const ydoc = new Y.Doc();
  reconcile(file, ydoc);
  dbs.set(`oc-design-${designId}`, Y.encodeStateAsUpdate(ydoc));
  ydoc.destroy();
}

describe("offline copies (F49)", () => {
  beforeEach(() => {
    dbs.clear();
    blocked = false;
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    vi.stubGlobal("indexedDB", {
      deleteDatabase: (name: string) => {
        const req: { onsuccess?: () => void; onblocked?: () => void; onerror?: () => void } = {};
        queueMicrotask(() => {
          if (blocked) return req.onerror?.();
          dbs.delete(name);
          req.onsuccess?.();
        });
        return req;
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("fingerprints content the same from the server and from the CRDT", () => {
    const file = design("Label");
    const ydoc = new Y.Doc();
    reconcile(file, ydoc);
    expect(contentHash(fromDoc(ydoc))).toBe(contentHash(file));
    // Key order and undefined fields do not matter; content does.
    const reordered = JSON.parse(JSON.stringify({ pages: file.pages, ...file, extra: undefined }));
    expect(contentHash(reordered)).toBe(contentHash(file));
    expect(contentHash(design("Label", "Hallo"))).not.toBe(contentHash(file));
  });

  it("decides by content and by what this browser saved last", () => {
    const old = design("old");
    const now = design("new");
    const server = { stamp: "s2", file: now };
    expect(decideOfflineCopy(null, server, null).action).toBe("keep");
    expect(decideOfflineCopy(old, undefined, null).action).toBe("keep"); // offline: nothing to compare
    expect(decideOfflineCopy(now, server, null).action).toBe("keep"); // the same content
    expect(decideOfflineCopy(old, server, { stamp: "s2", hash: contentHash(now) }).action).toBe("keep"); // offline edits on the current file
    expect(decideOfflineCopy(old, server, { stamp: "s1", hash: contentHash(old) }).action).toBe("drop"); // saved, then changed elsewhere
    expect(decideOfflineCopy(design("offline edit"), server, { stamp: "s1", hash: contentHash(old) }).action).toBe("aside");
    expect(decideOfflineCopy(old, server, null).action).toBe("aside"); // a copy from before F49: keep it to be safe
  });

  it("drops a copy that the design has moved past, and binds a fresh one", async () => {
    const old = design("old");
    storeCopy("d1", old);
    noteServerState("d1", "s1", old);
    noteOpened("d1", "s2", design("new"));
    const aside = vi.fn(async () => {});
    await expect(settleOfflineCopy("d1", aside, () => {})).resolves.toBe(true);
    expect(aside).not.toHaveBeenCalled();
    expect(dbs.has("oc-design-d1")).toBe(false);
  });

  it("keeps outdated changes as a version once, then drops the copy", async () => {
    storeCopy("d1", design("offline edit"));
    noteServerState("d1", "s1", design("old"));
    noteOpened("d1", "s2", design("new"));
    const kept: DesignFile[] = [];
    const aside = vi.fn(async (file: DesignFile) => { kept.push(file); });
    const told = vi.fn();
    await expect(settleOfflineCopy("d1", aside, told)).resolves.toBe(true);
    expect(aside).toHaveBeenCalledTimes(1);
    expect((kept[0] as unknown as { title: string }).title).toBe("offline edit");
    expect(told).toHaveBeenCalledTimes(1);
    expect(dbs.has("oc-design-d1")).toBe(false);
  });

  it("leaves the copy unbound when its changes cannot be kept yet", async () => {
    storeCopy("d1", design("offline edit"));
    noteOpened("d1", "s2", design("new"));
    await expect(settleOfflineCopy("d1", async () => { throw new Error("offline"); }, () => {})).resolves.toBe(false);
    expect(dbs.has("oc-design-d1")).toBe(true); // still there for the next open
  });

  it("does not pass a copy it could not delete off as current, nor keep it twice", async () => {
    storeCopy("d1", design("offline edit"));
    noteOpened("d1", "s2", design("new"));
    const aside = vi.fn(async () => {});
    blocked = true; // the copy cannot be deleted (storage error)
    await expect(settleOfflineCopy("d1", aside, () => {})).resolves.toBe(false);
    blocked = false;
    // Next open, same server state: still outdated, not bound as current.
    await expect(settleOfflineCopy("d1", aside, () => {})).resolves.toBe(true);
    expect(aside).toHaveBeenCalledTimes(1);
    expect(dbs.has("oc-design-d1")).toBe(false);
  });

  it("leaves a copy alone that another tab has open", async () => {
    storeCopy("d1", design("old"));
    noteOpened("d1", "s2", design("new"));
    vi.stubGlobal("navigator", { locks: { query: async () => ({ held: [{ name: "oc-offline-oc-design-d1" }] }) } });
    const aside = vi.fn(async () => {});
    await expect(settleOfflineCopy("d1", aside, () => {})).resolves.toBe(true);
    expect(aside).not.toHaveBeenCalled();
    expect(dbs.has("oc-design-d1")).toBe(true);
  });

  it("binds a copy whose design has not moved since this browser saved it", async () => {
    const saved = design("saved");
    storeCopy("d1", design("saved plus offline edit"));
    noteServerState("d1", "s1", saved);
    noteOpened("d1", "s1", saved);
    const aside = vi.fn(async () => {});
    await expect(settleOfflineCopy("d1", aside, () => {})).resolves.toBe(true);
    expect(aside).not.toHaveBeenCalled();
    expect(dbs.has("oc-design-d1")).toBe(true);
  });
});
