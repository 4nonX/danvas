import { describe, expect, it } from "vitest";
import type { CanvaFolderPage, CanvaItem } from "@hc/sdk";
import { validate } from "@hc/schema";
import { ExportPacer, effectivePicks, imagePagesDesign, planImport, type CanvaPick } from "./canvaImport";

const U = { design: "Untitled", folder: "Untitled" };
const folder = (id: string, name: string): CanvaItem => ({ type: "folder", id, name });
const design = (id: string, name: string): CanvaItem => ({ type: "design", id, name });

// root
//   Clients/            (F1)
//     Acme/             (F2)
//       Pitch           (D1)
//     Empty/            (F3)
//     Brief             (D2)
//   Personal/           (F4)
//     Card              (D3)
//   Loose deck          (D4)
const TREE: Record<string, CanvaItem[]> = {
  root: [folder("F1", "Clients"), folder("F4", "Personal"), design("D4", "Loose deck")],
  F1: [folder("F2", "Acme"), folder("F3", "Empty"), design("D2", "Brief")],
  F2: [design("D1", "Pitch")],
  F3: [],
  F4: [design("D3", "Card")],
};

/** Lists TREE, one item per page, so continuation is exercised. */
function lister() {
  const calls: string[] = [];
  const list = async (id: string, cont?: string): Promise<CanvaFolderPage> => {
    calls.push(id);
    const items = TREE[id] ?? [];
    const at = cont ? Number(cont) : 0;
    return { items: items.slice(at, at + 1), continuation: at + 1 < items.length ? String(at + 1) : undefined };
  };
  return { list, calls };
}

describe("planImport", () => {
  it("mirrors a ticked folder's whole tree, empty folders included", async () => {
    const { list } = lister();
    const plan = await planImport([{ item: folder("F1", "Clients"), ancestors: ["root"] }], list, { untitled: U });
    expect(plan.folders).toEqual([["Clients"], ["Clients", "Acme"], ["Clients", "Empty"]]);
    expect(plan.designs).toEqual([
      { id: "D1", title: "Pitch", path: ["Clients", "Acme"] },
      { id: "D2", title: "Brief", path: ["Clients"] },
    ]);
  });

  it("takes a mix of single designs and folders; a design under a ticked folder keeps its place", async () => {
    const { list } = lister();
    const picks: CanvaPick[] = [
      { item: design("D4", "Loose deck"), ancestors: ["root"] },
      { item: folder("F2", "Acme"), ancestors: ["root", "F1"] },
      { item: design("D3", "Card"), ancestors: ["root", "F4"] },
    ];
    const plan = await planImport(picks, list, { untitled: U });
    expect(plan.folders).toEqual([["Acme"]]);
    expect(plan.designs).toEqual([
      { id: "D4", title: "Loose deck", path: [] },
      { id: "D1", title: "Pitch", path: ["Acme"] },
      { id: "D3", title: "Card", path: [] },
    ]);
  });

  it("everything mirrors the library into the target, without a wrapping folder", async () => {
    const { list } = lister();
    const plan = await planImport([
      { item: folder("root", ""), ancestors: [] },
      { item: design("D1", "Pitch"), ancestors: ["root", "F1", "F2"] },
    ], list, { untitled: U });
    expect(plan.folders).toEqual([["Clients"], ["Clients", "Acme"], ["Clients", "Empty"], ["Personal"]]);
    expect(plan.designs.map((d) => [d.id, d.path.join("/")])).toEqual([
      ["D1", "Clients/Acme"], ["D2", "Clients"], ["D3", "Personal"], ["D4", ""],
    ]);
  });

  it("stops reading when stopped", async () => {
    const { list, calls } = lister();
    const plan = await planImport([{ item: folder("root", ""), ancestors: [] }], list, { stopped: () => calls.length >= 1, untitled: U });
    expect(plan.designs).toEqual([]);
  });
});

describe("effectivePicks", () => {
  it("drops picks covered by a ticked folder above them", () => {
    const picks: CanvaPick[] = [
      { item: folder("F1", "Clients"), ancestors: ["root"] },
      { item: folder("F2", "Acme"), ancestors: ["root", "F1"] },
      { item: design("D2", "Brief"), ancestors: ["root", "F1"] },
      { item: design("D4", "Loose deck"), ancestors: ["root"] },
    ];
    expect(effectivePicks(picks).map((p) => p.item.id)).toEqual(["F1", "D4"]);
  });
});

describe("ExportPacer", () => {
  it("allows at most max starts per window", async () => {
    let now = 0;
    const slept: number[] = [];
    const pacer = new ExportPacer(3, 60_000, () => now, async (ms) => { slept.push(ms); now += ms; });
    for (let i = 0; i < 3; i++) await pacer.wait();
    expect(slept).toEqual([]);
    now = 10_000;
    await pacer.wait();
    expect(slept).toEqual([50_000]);
    expect(now).toBe(60_000);
  });
});

describe("imagePagesDesign", () => {
  it("makes one full-bleed image page per exported page, at its own size, and validates", async () => {
    const png = (n: number) => new Blob([new Uint8Array([137, 80, 78, 71, n])], { type: "image/png" });
    const sizes = [{ width: 1080, height: 1350 }, { width: 1920, height: 1080 }];
    let i = 0;
    const file = await imagePagesDesign("Card", [png(1), png(2)], async () => sizes[i++]);
    expect(file.title).toBe("Card");
    expect(file.pages.map((p) => [p.width, p.height])).toEqual([[1080, 1350], [1920, 1080]]);
    const assets = (file as { assets?: { id: string; url: string }[] }).assets ?? [];
    expect(assets.map((a) => a.url.slice(0, 22))).toEqual(["data:image/png;base64,", "data:image/png;base64,"]);
    const img = file.pages[1].children[0] as unknown as { type: string; size: { width: number }; source: { assetId: string } };
    expect(img.type).toBe("image");
    expect(img.size.width).toBe(1920);
    expect(img.source.assetId).toBe(assets[1].id);
    expect(validate(file).ok).toBe(true);
  });
});
