// Offline copies of designs (F49). Every browser keeps the CRDT state of each
// design it opened in IndexedDB, so offline edits survive a reload. The relay
// server holds no document of its own, though: when nobody else is in a
// design, the editor's state comes from that copy alone. A copy older than
// the design (changed since on another device, by someone else, or from the
// dashboard) would then replace the freshly loaded file on screen, and the
// automatic save would write it back over the newer one.
//
// So before the copy is bound, it is compared with what the server has:
//
//   - the copy is the server's file, or the server has not moved since this
//     browser last saved it: bind it as before (offline edits merge in);
//   - the server is newer and the copy holds nothing unsaved: drop it;
//   - the server is newer and the copy has changes of its own: keep them as a
//     named version in the history (not the current file), then drop it.
//
// "Moved" is the design's current snapshot id, remembered per design with a
// hash of the content saved under it each time this browser saves. Offline,
// nothing can be compared and the copy is bound as before.

import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { fromDoc } from "@hc/realtime";
import { designRootKey, type DesignFile } from "@hc/schema";

/** The IndexedDB database of a design's offline copy (a branch has its own). */
export function offlineDbName(designId: string, branch: string | null = null): string {
  return branch ? `oc-design-${designId}::${branch}` : `oc-design-${designId}`;
}

// JSON with sorted keys and undefined left out: the same content gives the
// same text whether it came from the server or from the CRDT projection.
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canonical(x))).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

/** A short fingerprint of a design's content (53-bit string hash and length). */
export function contentHash(file: DesignFile): string {
  const s = canonical(file);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}.${s.length.toString(36)}`;
}

/** What this browser knows of the server: snapshot `stamp` holds content `hash`. */
export interface ServerMark { stamp: string; hash: string }

const markKey = (designId: string) => `oc-offline-mark-${designId}`;

function readMark(designId: string): ServerMark | null {
  try {
    const raw = localStorage.getItem(markKey(designId));
    const m = raw ? (JSON.parse(raw) as Partial<ServerMark>) : null;
    return m && typeof m.stamp === "string" && typeof m.hash === "string" ? { stamp: m.stamp, hash: m.hash } : null;
  } catch {
    return null;
  }
}

/** Remember that the server's snapshot `stamp` is `file` (after a save from
 *  this browser, or the file the editor opened). */
export function noteServerState(designId: string, stamp: string | null | undefined, file: DesignFile): void {
  if (!stamp) return;
  try {
    localStorage.setItem(markKey(designId), JSON.stringify({ stamp, hash: contentHash(file) }));
  } catch {
    // Storage blocked: the next open compares contents only.
  }
}

// The server state each design was opened with, handed over by the editor
// (which loads the record and the file anyway) to the realtime binding.
const opened = new Map<string, { stamp: string | null; file: DesignFile }>();

/** The editor loaded this design: the current snapshot id and its file. */
export function noteOpened(designId: string, stamp: string | null, file: DesignFile): void {
  opened.set(designId, { stamp, file });
}

export type OfflineDecision = { action: "keep" } | { action: "drop" } | { action: "aside" };

/** What to do with a design's offline copy (pure; see the top of the file). */
export function decideOfflineCopy(copy: DesignFile | null, server: { stamp: string | null; file: DesignFile } | undefined, mark: ServerMark | null): OfflineDecision {
  if (!copy || !server) return { action: "keep" }; // nothing kept, or nothing to compare with
  const copyHash = contentHash(copy);
  if (copyHash === contentHash(server.file)) return { action: "keep" };
  if (mark && server.stamp && mark.stamp === server.stamp) return { action: "keep" }; // offline edits on top of the current file
  if (mark && copyHash === mark.hash) return { action: "drop" }; // an older saved state, nothing of its own
  return { action: "aside" };
}

const READ_TIMEOUT_MS = 5000;

/** The design held in an offline copy, or null when there is none. */
export async function readOfflineCopy(name: string): Promise<DesignFile | null> {
  const ydoc = new Y.Doc();
  const idb = new IndexeddbPersistence(name, ydoc);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Storage that never opens (blocked, broken) must not hold the editor up.
    await Promise.race([idb.whenSynced, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("offline copy unreadable")), READ_TIMEOUT_MS); })]);
    return ydoc.getMap(designRootKey).size > 0 ? fromDoc(ydoc) : null;
  } finally {
    clearTimeout(timer);
    // Closes the connection and keeps the data; not awaited, since storage that
    // never opened never closes either (a deletion closes it regardless).
    void idb.destroy();
    ydoc.destroy();
  }
}

// A tab with a design open marks its copy in use (a shared Web Lock under the
// copy's name). Another tab never deletes a copy in use: a deletion waits for
// every open connection and would then remove that tab's unsaved offline work.
const lockName = (name: string) => `oc-offline-${name}`;

/** Mark a copy in use until the returned function is called. */
export function holdOfflineCopy(name: string): () => void {
  let release = () => {};
  try {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks) return release;
    const held = new Promise<void>((resolve) => { release = resolve; });
    void locks.request(lockName(name), { mode: "shared" }, () => held).catch(() => {});
  } catch {
    // No Web Locks: nothing marks the copy, and deletions go ahead as before.
  }
  return () => release();
}

async function copyInUse(name: string): Promise<boolean> {
  try {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks) return false;
    const state = await locks.query();
    return (state.held ?? []).some((l) => l.name === lockName(name));
  } catch {
    return false;
  }
}

/** Delete an offline copy. False when it could not be deleted (storage
 *  blocked, or another tab has it open: then it is left alone, and the next
 *  open settles it). */
export async function dropOfflineCopy(name: string): Promise<boolean> {
  if (await copyInUse(name)) return false;
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (ok: boolean) => { clearTimeout(timer); resolve(ok); };
    try {
      if (typeof indexedDB === "undefined") return done(true);
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => done(true);
      req.onerror = () => done(false);
      // "Blocked" only says a connection is still open; the deletion goes on
      // once it closes (no tab holds the copy, so one is just closing).
      req.onblocked = () => { timer = setTimeout(() => done(false), DELETE_TIMEOUT_MS); };
    } catch {
      done(false);
    }
  });
}

const DELETE_TIMEOUT_MS = 5000;

/**
 * Settle a design's offline copy before the editor binds it. Resolves true
 * when the copy may be bound (kept, or dropped so a fresh one starts), false
 * when it must stay unbound this session (outdated changes that could not be
 * kept as a version yet: the copy stays for the next open, and this session
 * works from the server's file).
 */
export async function settleOfflineCopy(
  designId: string,
  keepAside: (file: DesignFile) => Promise<void>,
  onKeptAside: () => void,
): Promise<boolean> {
  if (typeof indexedDB === "undefined") return true;
  const server = opened.get(designId);
  const mark = readMark(designId);
  const name = offlineDbName(designId);
  // Open in another tab: that tab is live (and saves), so the copy is bound
  // as before rather than judged and deleted under it.
  if (await copyInUse(name)) return true;
  let copy: DesignFile | null;
  try {
    copy = await readOfflineCopy(name);
  } catch {
    return true; // unreadable: binding fails the same way and degrades to online-only
  }
  const decision = decideOfflineCopy(copy, server, mark);
  // The server's state is remembered only once the copy agrees with it or is
  // gone: a stale copy that could not be deleted must not pass for current
  // at the next open.
  const remember = () => { if (server) noteServerState(designId, server.stamp, server.file); };
  if (decision.action === "keep") {
    remember();
    return true;
  }
  if (decision.action === "aside") {
    const hash = contentHash(copy as DesignFile);
    // Kept already (its deletion failed last time): do not keep it twice.
    if (readAside(designId) !== hash) {
      try {
        await keepAside(copy as DesignFile);
      } catch {
        return false;
      }
      writeAside(designId, hash);
      onKeptAside();
    }
  }
  if (!(await dropOfflineCopy(name))) return false;
  remember();
  return true;
}

const asideKey = (designId: string) => `oc-offline-aside-${designId}`;
function readAside(designId: string): string | null {
  try { return localStorage.getItem(asideKey(designId)); } catch { return null; }
}
function writeAside(designId: string, hash: string): void {
  try { localStorage.setItem(asideKey(designId), hash); } catch { /* storage blocked */ }
}
