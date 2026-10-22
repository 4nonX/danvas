# F49 Outdated offline copies

Every browser keeps the CRDT state of each design it opened in IndexedDB, so edits made offline survive a reload and merge on reconnect. The realtime server only relays between open editors and holds no document of its own: when nobody else is in a design, the editor's state comes from that copy alone. A copy older than the design (changed since on another device, by someone else, or from the dashboard) then replaced the freshly loaded file on screen, and the automatic save wrote it back over the newer one. Rare, but silent.

## Requirements

- **FR-1 Remember the server state.** Each time this browser saves a design (automatic or manual save), and when it opens one, it remembers the design's current snapshot id together with a fingerprint of that content (sorted-key JSON hash, so the server file and the CRDT projection of the same content agree).
- **FR-2 Check before binding.** When a design opens, its offline copy is read and compared with the file just loaded, before it is bound to the editor:
  - the copy is the server's content, or the design's current snapshot is still the one this browser last saved or opened: bind it as before (offline edits merge in and are saved);
  - the server is newer and the copy is the state this browser last saved (nothing of its own): drop the copy, start a fresh one;
  - the server is newer and the copy has changes of its own (or it is a copy from before this check and differs): keep the copy as a named version **Offline changes from this browser (date)** in the history, without making it the current file, say so in a notice, then drop it.
- **FR-3 Nothing lost.** If the version cannot be saved (offline, no right), the copy is not bound this session and stays for the next open; the session works from the server's file. A copy that could not be deleted is not taken for current at the next open, and the same changes are never kept twice.
- **FR-4 Other tabs.** A tab with the design open marks its copy in use (a shared Web Lock). Another tab never judges or deletes a copy in use; deleting would silently close that tab's storage and lose its unsaved offline work. Change format in the dashboard leaves a copy in use alone as well.
- **FR-5 Offline.** Without the server nothing is compared and the copy is bound as before. Storage that cannot be read within 5 seconds is treated the same way.
- **FR-6 Versions aside.** `POST /designs/{id}/snapshots` takes `aside: true`: the file is stored as a named version only, and the current file stays. Branch sessions keep their own copies as before.

## Acceptance

- **AC-1** Design saved in browser A, then changed in browser B (or with Change format): opening it in A shows B's state, and A's copy is gone.
- **AC-2** A has offline edits that never reached the server, and the design changed meanwhile: A shows the current state, a notice says the offline changes are kept, and the history has them as a version that can be restored.
- **AC-3** A edits offline and the design did not change elsewhere: the edits stay and are saved on reconnect, as before.
- **AC-4** The design open in a second tab of A: opening it in a third tab leaves the copy and the second tab's unsaved work alone.

## Not in this spec

- The case where two browsers edit the same design at the same time with copies of different CRDT origins (both offline, then both online together) stays the realtime model's own merge.
