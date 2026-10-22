import { describe, expect, it } from "vitest";
import { createNode, type DesignFile, type Node } from "@hc/schema";
import { barcodeOf, buildBarcode, defaultSpec, loadBarcode } from "./barcode";
import { detectDelimiter, decodeText, parseCsvMatrix } from "./csv";
import { autoMap, mergeRows, mergeTargets, missingColumns, readDataText, tableOf } from "./serialPrint";

const mod = await loadBarcode();

const text = (id: string, runs: string[], name?: string) => createNode("text", {
  id, name, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, size: { width: 300, height: 40 },
  box: { mode: "fixed", width: 300, height: 40, autoFit: { enabled: false, min: 8, max: 512 }, verticalAlign: "top" },
  content: [{ runs: runs.map((t, i) => ({ text: t, style: { fontFamily: "Inter", fontStyle: "Regular", fontSize: i === 0 ? 12 : 9 } })), style: { align: "left", direction: "auto" } }],
} as Partial<Node>);

function pzn(): Node {
  const spec = defaultSpec(mod, "pzn", "0471114");
  const b = buildBarcode(mod, spec, 96);
  if (!b.ok) throw new Error("pzn");
  return createNode("group", { id: "code", name: "PZN", size: { width: b.width, height: b.height }, children: b.children, data: { barcode: spec } } as Partial<Node>);
}

function label(): DesignFile {
  return {
    format: "hycanvas.design", schemaVersion: 29, id: "d", title: "Label", unit: "px", dpi: 96, assets: [], fonts: [], meta: {},
    pages: [{ id: "p", width: 378, height: 189, children: [text("t1", ["Charge: ", "{{Charge}}", " verw. bis {{ verfall }}"]), text("t2", ["Musterprodukt"], "Produkt"), pzn()] }],
  } as unknown as DesignFile;
}

const runsOf = (n: Node) => (n as unknown as { content: { runs: { text: string; style: { fontSize: number } }[] }[] }).content;

describe("data files", () => {
  it("reads German Excel CSV: semicolons and Windows-1252", () => {
    // The whole file in Windows-1252: "ß" is 0xDF, "ü" 0xFC (neither valid UTF-8 alone).
    const bytes = new Uint8Array([..."Name;Straße\n\"Müller; Sohn\";Hauptstr. 1\n"].map((c) => c.charCodeAt(0)));
    const t = decodeText(bytes);
    expect(t.startsWith("Name;Straße")).toBe(true);
    expect(detectDelimiter(t)).toBe(";");
    expect(parseCsvMatrix(t, ";")[1]).toEqual(["Müller; Sohn", "Hauptstr. 1"]);
  });

  it("takes pasted cells, tab-separated, and drops empty rows", () => {
    const sheet = readDataText("Charge\tPZN\nA1\t0471114\n\t\nB2\t1234562\n");
    const table = tableOf(sheet.matrix, true, (n) => `Column ${n}`);
    expect(table.headers).toEqual(["Charge", "PZN"]);
    expect(table.rows).toEqual([["A1", "0471114"], ["B2", "1234562"]]);
    expect(tableOf([["a", "b"]], false, (n) => `Column ${n}`).headers).toEqual(["Column 1", "Column 2"]);
  });
});

describe("filling a design from rows", () => {
  it("finds the elements and maps columns by name", () => {
    const targets = mergeTargets(label());
    expect(targets.map((t) => [t.id, t.kind, t.label])).toEqual([["t1", "text", "Charge: {{Charge}} verw. bis {{ verfall }}".slice(0, 40)], ["t2", "text", "Produkt"], ["code", "barcode", "PZN"]]);
    expect(targets[0].placeholders).toEqual(["Charge", "verfall"]);
    expect(autoMap(targets, ["Charge", "PZN", "produkt", "Verfall"])).toEqual({ t2: "produkt", code: "PZN" });
    expect(missingColumns(targets, ["charge"])).toEqual(["verfall"]);
  });

  it("makes one copy per row, keeps run styles and encodes each barcode", async () => {
    const table = { headers: ["Charge", "Verfall", "Produkt", "PZN"], rows: [["CH-01", "12.2027", "Salbe A", "0471114"], ["CH-02", "01.2028", "Salbe B\nzweite Zeile", "1234562"]] };
    const out = await mergeRows(label(), table, { t2: "Produkt", code: "PZN" });
    expect(out.rows).toBe(2);
    expect(out.skipped).toEqual([]);
    expect(out.doc.pages.length).toBe(2);
    const [p1, p2] = out.doc.pages;
    expect(runsOf(p1.children[0])[0].runs.map((r) => r.text)).toEqual(["Charge: ", "CH-01", " verw. bis 12.2027"]);
    expect(runsOf(p1.children[0])[0].runs[1].style.fontSize).toBe(9);
    expect(runsOf(p2.children[1]).map((p) => p.runs[0].text)).toEqual(["Salbe B", "zweite Zeile"]);
    expect(barcodeOf(p1.children[2])!.value).toBe("0471114");
    expect(barcodeOf(p2.children[2])!.value).toBe("1234562");
    // Each copy has its own ids, and its own bars.
    expect(new Set(out.doc.pages.flatMap((p) => p.children.map((c) => c.id))).size).toBe(6);
    expect(JSON.stringify((p1.children[2] as Node & { children: Node[] }).children)).not.toBe(JSON.stringify((p2.children[2] as Node & { children: Node[] }).children));
  });

  it("leaves out a row whose code cannot be encoded, with the reason", async () => {
    const table = { headers: ["PZN"], rows: [["0471114"], ["04711145"], [""], ["1234562"]] };
    const out = await mergeRows(label(), table, { code: "PZN" });
    expect(out.rows).toBe(2);
    expect(out.skipped.map((s) => [s.row, s.element])).toEqual([[2, "PZN"], [3, "PZN"]]);
    expect(out.doc.pages.map((p) => barcodeOf(p.children[2])!.value)).toEqual(["0471114", "1234562"]);
  });

  it("fills only the chosen rows", async () => {
    const table = { headers: ["PZN"], rows: [["0471114"], ["1234562"], ["0471114"]] };
    const out = await mergeRows(label(), table, { code: "PZN" }, { from: 2, to: 2 });
    expect(out.rows).toBe(1);
    expect(barcodeOf(out.doc.pages[0].children[2])!.value).toBe("1234562");
  });
});
