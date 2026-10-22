// Serial print (F46): a design filled from a data file, one copy per row,
// as one multi-page document for the download menu and the print dialog.
//
// What a row fills:
// - text with placeholders, {{Column}} anywhere in a text (any run keeps its
//   style), and whole text elements assigned to a column;
// - barcodes (and QR codes) assigned to a column: encoded again per row. A
//   row whose code cannot be encoded is left out and listed with the reason,
//   so no label is printed with a wrong code or the template's.

import type { DesignFile, Node, Page } from "@hc/schema";
import type { EncodeError } from "@hc/barcode";
import { barcodeErrorText, barcodeOf, buildBarcode, loadBarcode } from "@/lib/barcode";
import { qrModules } from "@/lib/qr";
import { decodeText, detectDelimiter, parseCsvMatrix } from "@/lib/csv";
import { oc } from "@/lib/sdk";
import { CodedError } from "@/lib/errors";

/** At most this many rows go into one document. */
export const MAX_SERIAL_ROWS = 5000;

export interface DataSheet {
  name: string;
  matrix: string[][];
}

/** A data file's sheets: one for CSV and text files, every worksheet of an
 *  Excel file (read on the server, so dates and leading zeros come out as
 *  Excel shows them). */
export async function readDataFile(file: File, locale: string): Promise<DataSheet[]> {
  if (/\.xlsx$/i.test(file.name)) {
    // The read endpoint takes up to 20 MiB (a spreadsheet of many thousand rows).
    if (file.size > 20 * 1024 * 1024) throw new CodedError("errors.api_sheet_too_large", "spreadsheet over 20 MiB");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const { sheets } = await oc.sheetRows({ filename: file.name, dataBase64: btoa(bin), locale });
    return sheets.map((s) => ({ name: s.name, matrix: s.rows }));
  }
  const text = decodeText(new Uint8Array(await file.arrayBuffer()));
  return [{ name: file.name, matrix: parseCsvMatrix(text, detectDelimiter(text)) }];
}

/** Pasted text (copied cells arrive tab-separated). */
export function readDataText(text: string): DataSheet {
  return { name: "", matrix: parseCsvMatrix(text, detectDelimiter(text)) };
}

export interface DataTable {
  headers: string[];
  rows: string[][];
}

/** The table of a sheet: the first row as column names, or numbered columns. */
export function tableOf(matrix: string[][], firstRowHeaders: boolean, columnName: (n: number) => string): DataTable {
  const width = Math.max(0, ...matrix.map((r) => r.length));
  const headers = firstRowHeaders && matrix.length
    ? Array.from({ length: width }, (_, i) => (matrix[0][i] ?? "").trim() || columnName(i + 1))
    : Array.from({ length: width }, (_, i) => columnName(i + 1));
  const body = (firstRowHeaders ? matrix.slice(1) : matrix).filter((r) => r.some((c) => c.trim() !== ""));
  return { headers, rows: body };
}

export type TargetKind = "text" | "barcode" | "qr";

/** An element a column can fill. */
export interface MergeTarget {
  id: string;
  page: number;
  kind: TargetKind;
  /** The element's name, its text, or its code's value. */
  label: string;
  /** Placeholders in its text ({{Name}} gives "Name"). */
  placeholders: string[];
}

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

type TextLike = { content?: { runs?: { text?: string; style?: unknown }[]; style?: unknown }[] };
const textOf = (n: Node) => ((n as unknown as TextLike).content ?? []).map((p) => (p.runs ?? []).map((r) => r.text ?? "").join("")).join("\n");

/** Every element of the design a column can fill, page by page. */
export function mergeTargets(doc: DesignFile): MergeTarget[] {
  const out: MergeTarget[] = [];
  doc.pages.forEach((pg, page) => {
    const visit = (n: Node) => {
      const code = barcodeOf(n);
      if (code) { out.push({ id: n.id, page, kind: "barcode", label: n.name || code.value, placeholders: [] }); return; }
      if (n.type === "qr") { out.push({ id: n.id, page, kind: "qr", label: n.name || (n as unknown as { value: string }).value, placeholders: [] }); return; }
      if (n.type === "text") {
        const t = textOf(n);
        const placeholders = [...new Set([...t.matchAll(PLACEHOLDER)].map((m) => m[1]))];
        out.push({ id: n.id, page, kind: "text", label: n.name || t.replace(/\s+/g, " ").trim().slice(0, 40), placeholders });
        return;
      }
      for (const c of (n as unknown as { children?: Node[] }).children ?? []) visit(c);
    };
    pg.children.forEach(visit);
  });
  return out;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Columns for elements whose name is a column's name. Texts with
 *  placeholders are filled by those and get no column of their own. */
export function autoMap(targets: MergeTarget[], headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of targets) {
    if (t.placeholders.length) continue;
    const h = headers.find((x) => norm(x) === norm(t.label));
    if (h) out[t.id] = h;
  }
  return out;
}

/** Placeholders the table has no column for. */
export function missingColumns(targets: MergeTarget[], headers: string[]): string[] {
  const have = new Set(headers.map(norm));
  return [...new Set(targets.flatMap((t) => t.placeholders))].filter((p) => !have.has(norm(p)));
}

export interface SkippedRow {
  /** 1-based row of the data (header not counted). */
  row: number;
  element: string;
  reason: string;
}

export interface MergeResult {
  doc: DesignFile;
  /** Rows that made it into the document. */
  rows: number;
  skipped: SkippedRow[];
}

/** One copy of the design per row (rows `from`..`to`, 1-based, inclusive),
 *  every page of it, filled from the row. */
export async function mergeRows(doc: DesignFile, table: DataTable, mapping: Record<string, string>, range?: { from: number; to: number }): Promise<MergeResult> {
  const mod = await loadBarcode();
  const col = new Map(table.headers.map((h, i) => [norm(h), i]));
  const from = Math.max(1, range?.from ?? 1);
  const to = Math.min(table.rows.length, range?.to ?? table.rows.length, from + MAX_SERIAL_ROWS - 1);
  const pages: Page[] = [];
  const skipped: SkippedRow[] = [];
  let rows = 0;
  for (let r = from; r <= to; r++) {
    const cells = table.rows[r - 1];
    const value = (column: string) => {
      const i = col.get(norm(column));
      return i === undefined ? undefined : (cells[i] ?? "").trim();
    };
    const filled: Page[] = [];
    // A holder, so the walk below can set it.
    const bad: { row: SkippedRow | null } = { row: null };
    for (const pg of doc.pages) {
      const copy = structuredClone(pg) as Page;
      const fill = (n: Node): void => {
        if (bad.row) return;
        const target = mapping[n.id];
        const code = barcodeOf(n);
        if (code) {
          if (target === undefined) return;
          const v = value(target) ?? "";
          const built = buildBarcode(mod, { ...code, value: v }, doc.dpi ?? 96);
          if (!built.ok) { bad.row = { row: r, element: n.name || code.value, reason: `${barcodeErrorText(built as EncodeError)} (${v || "-"})` }; return; }
          const g = n as Node & { children: Node[] };
          g.children = built.children;
          g.size = { width: built.width, height: built.height };
          g.data = { ...(g.data ?? {}), barcode: { ...code, value: v } };
          return;
        }
        if (n.type === "qr" && target !== undefined) {
          const q = n as unknown as { value: string; ecLevel: "L" | "M" | "Q" | "H"; modules?: boolean[][] };
          q.value = value(target) ?? "";
          q.modules = qrModules(q.value, q.ecLevel ?? "M");
          return;
        }
        if (n.type === "text") {
          const t = n as unknown as TextLike;
          if (target !== undefined) {
            // The whole text from the column, in the style of its first run.
            const para = t.content?.[0];
            const run = para?.runs?.[0];
            t.content = (value(target) ?? "").split(/\r?\n/).map((line) => ({ ...(para ?? {}), runs: [{ ...(run ?? {}), text: line }] }));
          } else {
            for (const p of t.content ?? []) for (const run of p.runs ?? []) {
              if (run.text) run.text = run.text.replace(PLACEHOLDER, (m, name: string) => value(name) ?? m);
            }
          }
          return;
        }
        for (const c of (n as unknown as { children?: Node[] }).children ?? []) fill(c);
      };
      copy.children.forEach(fill);
      // Ids unique per row, so every page of the document stands on its own.
      reId(copy, `~${r}`);
      filled.push(copy);
    }
    if (bad.row) { skipped.push(bad.row); continue; }
    pages.push(...filled);
    rows++;
  }
  return { doc: { ...doc, pages }, rows, skipped };
}

function reId(page: Page, suffix: string): void {
  (page as { id: string }).id += suffix;
  const visit = (n: Node) => {
    (n as { id: string }).id += suffix;
    for (const c of (n as unknown as { children?: Node[] }).children ?? []) visit(c);
  };
  page.children.forEach(visit);
}
