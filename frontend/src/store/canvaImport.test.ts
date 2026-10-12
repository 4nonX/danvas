// The Canva imports run on the server; the app-level store starts, stops and
// dismisses them, polls their state (often while one is going, rarely
// otherwise) and tells open views when designs arrived in their workspace.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvaImportRun } from "@hc/sdk";

const oc = {
  startCanvaImport: vi.fn(),
  listCanvaImports: vi.fn(),
  stopCanvaImport: vi.fn(),
  dismissCanvaImport: vi.fn(),
};
vi.mock("@/lib/sdk", () => ({ oc }));
vi.mock("@/lib/i18n", () => ({ tr: (k: string) => k }));

const { useCanvaImport, canvaImportActive, pollCanvaImports, ACTIVE_POLL_MS, IDLE_POLL_MS } = await import("./canvaImport");

const run = (p: Partial<CanvaImportRun>): CanvaImportRun => ({
  id: "r1",
  workspaceId: "ws1",
  targetFolderId: null,
  status: "running",
  stopRequested: false,
  total: 2,
  imported: 0,
  skipped: 0,
  failed: 0,
  asImages: 0,
  current: "",
  waiting: false,
  failures: [],
  createdAt: "2026-10-12T10:00:00Z",
  ...p,
});

beforeEach(() => {
  useCanvaImport.setState({ runs: [], detailsOpen: null, changes: 0, changedWorkspaceIds: [] });
  for (const f of Object.values(oc)) f.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Canva import store", () => {
  it("starts a run on the server with the picks and opens its progress", async () => {
    oc.startCanvaImport.mockResolvedValue(run({ status: "queued", total: null }));
    await useCanvaImport.getState().start({
      workspaceId: "ws1",
      targetFolderId: "f1",
      picks: [{ item: { type: "design", id: "D1", name: "Flyer" }, ancestors: ["root"] }],
    });
    expect(oc.startCanvaImport).toHaveBeenCalledWith("ws1", {
      picks: [{ type: "design", id: "D1", name: "Flyer", ancestors: ["root"] }],
      targetFolderId: "f1",
      untitled: "dashboard.untitled",
    });
    expect(useCanvaImport.getState().detailsOpen).toBe("r1");
    expect(canvaImportActive()).toBe(true);
  });

  it("passes a refusal on to the dialog", async () => {
    oc.startCanvaImport.mockRejectedValue(new Error("canva_not_connected"));
    await expect(useCanvaImport.getState().start({ workspaceId: "ws1", targetFolderId: null, picks: [] })).rejects.toThrow();
    expect(useCanvaImport.getState().runs).toEqual([]);
  });

  it("signals the workspace when designs arrive or a run ends", async () => {
    useCanvaImport.setState({ runs: [run({})] });
    oc.listCanvaImports.mockResolvedValueOnce([run({})]);
    await useCanvaImport.getState().refresh();
    expect(useCanvaImport.getState().changes).toBe(0);

    oc.listCanvaImports.mockResolvedValueOnce([run({ imported: 1 })]);
    await useCanvaImport.getState().refresh();
    expect(useCanvaImport.getState().changes).toBe(1);
    expect(useCanvaImport.getState().changedWorkspaceIds).toEqual(["ws1"]);

    oc.listCanvaImports.mockResolvedValueOnce([run({ imported: 1, status: "done" })]);
    await useCanvaImport.getState().refresh();
    expect(useCanvaImport.getState().changes).toBe(2);
    expect(canvaImportActive()).toBe(false);
  });

  it("stops and dismisses through the server", async () => {
    useCanvaImport.setState({ runs: [run({})], detailsOpen: "r1" });
    oc.stopCanvaImport.mockResolvedValue(run({ stopRequested: true }));
    await useCanvaImport.getState().stop("r1");
    expect(useCanvaImport.getState().runs[0].stopRequested).toBe(true);

    useCanvaImport.setState({ runs: [run({ status: "stopped" })] });
    oc.dismissCanvaImport.mockResolvedValue(undefined);
    await useCanvaImport.getState().dismiss("r1");
    expect(oc.dismissCanvaImport).toHaveBeenCalledWith("r1");
    expect(useCanvaImport.getState().runs).toEqual([]);
    expect(useCanvaImport.getState().detailsOpen).toBeNull();
  });

  it("polls often while a run is going and rarely otherwise, until stopped", async () => {
    vi.useFakeTimers();
    oc.listCanvaImports.mockResolvedValue([run({})]);
    const stop = pollCanvaImports();
    await vi.advanceTimersByTimeAsync(0);
    expect(oc.listCanvaImports).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(ACTIVE_POLL_MS);
    expect(oc.listCanvaImports).toHaveBeenCalledTimes(2);

    oc.listCanvaImports.mockResolvedValue([run({ status: "done" })]);
    await vi.advanceTimersByTimeAsync(ACTIVE_POLL_MS);
    expect(oc.listCanvaImports).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(ACTIVE_POLL_MS);
    expect(oc.listCanvaImports).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(IDLE_POLL_MS);
    expect(oc.listCanvaImports).toHaveBeenCalledTimes(4);

    stop();
    expect(useCanvaImport.getState().runs).toEqual([]);
    await vi.advanceTimersByTimeAsync(IDLE_POLL_MS * 2);
    expect(oc.listCanvaImports).toHaveBeenCalledTimes(4);
  });

  it("keeps polling after a failed poll", async () => {
    vi.useFakeTimers();
    oc.listCanvaImports.mockRejectedValueOnce(new Error("offline")).mockResolvedValue([]);
    const stop = pollCanvaImports();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(IDLE_POLL_MS);
    expect(oc.listCanvaImports).toHaveBeenCalledTimes(2);
    stop();
  });
});
