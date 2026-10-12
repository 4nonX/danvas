// The Canva import run lives in the app-level store, not in its dialog: it
// must run to the end with no UI open, allow only one run at a time, stop
// after the current design when asked, and stay visible until dismissed.

import { beforeEach, describe, expect, it, vi } from "vitest";

const oc = {
  canvaImported: vi.fn(),
  startCanvaExport: vi.fn(),
  getCanvaExport: vi.fn(),
  canvaExportFile: vi.fn(),
  createDesign: vi.fn(),
  moveToFolder: vi.fn(),
  recordCanvaImport: vi.fn(),
  createDesignFolder: vi.fn(),
  listCanvaFolder: vi.fn(),
};
vi.mock("@/lib/sdk", () => ({ oc }));
vi.mock("@/lib/i18n", () => ({ tr: (k: string) => k }));
vi.mock("@/lib/importDesignFile", () => ({ designFromFile: vi.fn() }));
vi.mock("@/lib/canvaImport", async (orig) => ({
  ...(await orig<typeof import("@/lib/canvaImport")>()),
  imagePagesDesign: vi.fn(async (title: string) => ({ title, pages: [] })),
}));

const { useCanvaImport, canvaImportActive } = await import("./canvaImport");

const design = (id: string, name: string) => ({ item: { type: "design" as const, id, name }, ancestors: [] as string[] });
const start = (ids: [string, string][]) =>
  useCanvaImport.getState().start({
    workspaceId: "ws1",
    targetFolderId: null,
    folders: [],
    picks: ids.map(([id, name]) => design(id, name)),
    errorMessage: (e) => String(e),
  });
const finished = () => vi.waitFor(() => expect(useCanvaImport.getState().run?.done).toBe(true), { timeout: 5000 });

beforeEach(() => {
  useCanvaImport.setState({ run: null, detailsOpen: false, changes: 0 });
  for (const f of Object.values(oc)) f.mockReset();
  oc.canvaImported.mockResolvedValue({ d2: "already-here" });
  oc.startCanvaExport.mockResolvedValue({ jobId: "job", format: "png" });
  oc.getCanvaExport.mockResolvedValue({ status: "success", files: 1 });
  oc.canvaExportFile.mockResolvedValue(new Blob(["x"]));
  oc.createDesign.mockResolvedValue({ id: "new" });
  oc.recordCanvaImport.mockResolvedValue(undefined);
});

describe("Canva import run", () => {
  it("runs to the end with its dialog closed", async () => {
    start([["d1", "Flyer"], ["d2", "Poster"]]);
    expect(useCanvaImport.getState().detailsOpen).toBe(true);
    useCanvaImport.getState().setDetailsOpen(false); // "continue in the background"
    expect(canvaImportActive()).toBe(true);
    await finished();
    const run = useCanvaImport.getState().run!;
    expect(run.results.map((r) => [r.name, r.status])).toEqual([["Flyer", "imported"], ["Poster", "skipped"]]);
    expect(run.stopped).toBe(false);
    expect(oc.createDesign).toHaveBeenCalledTimes(1);
    expect(oc.recordCanvaImport).toHaveBeenCalledWith("ws1", "d1", "new");
    expect(useCanvaImport.getState().changes).toBeGreaterThan(0);
    expect(useCanvaImport.getState().detailsOpen).toBe(false);
  });

  it("starts only one run at a time", async () => {
    start([["d1", "Flyer"]]);
    start([["d3", "Other"]]);
    await finished();
    expect(oc.startCanvaExport).toHaveBeenCalledTimes(1);
    expect(oc.startCanvaExport).toHaveBeenCalledWith("ws1", "d1");
  });

  it("stops after the design it is on", async () => {
    let release!: () => void;
    oc.startCanvaExport.mockImplementationOnce(() => new Promise((r) => { release = () => r({ jobId: "job", format: "png" }); }));
    start([["d1", "Flyer"], ["d3", "Card"]]);
    await vi.waitFor(() => expect(oc.startCanvaExport).toHaveBeenCalledTimes(1));
    useCanvaImport.getState().stop();
    release();
    await finished();
    const run = useCanvaImport.getState().run!;
    expect(run.stopped).toBe(true);
    expect(oc.startCanvaExport).toHaveBeenCalledTimes(1);
    expect(run.results.map((r) => r.name)).toEqual(["Flyer"]);
  });

  it("stays until dismissed, and only a finished run can be dismissed", async () => {
    let release!: () => void;
    oc.startCanvaExport.mockImplementationOnce(() => new Promise((r) => { release = () => r({ jobId: "job", format: "png" }); }));
    start([["d1", "Flyer"]]);
    await vi.waitFor(() => expect(oc.startCanvaExport).toHaveBeenCalledTimes(1));
    useCanvaImport.getState().dismiss();
    expect(useCanvaImport.getState().run).not.toBeNull();
    release();
    await finished();
    useCanvaImport.getState().dismiss();
    expect(useCanvaImport.getState().run).toBeNull();
  });

  it("records a failed design and carries on", async () => {
    oc.getCanvaExport.mockResolvedValueOnce({ status: "failed", files: 0, error: "boom" });
    start([["d1", "Flyer"], ["d3", "Card"]]);
    await finished();
    const run = useCanvaImport.getState().run!;
    expect(run.results.map((r) => r.status)).toEqual(["failed", "imported"]);
    expect(run.halted).toBeNull();
  });
});
