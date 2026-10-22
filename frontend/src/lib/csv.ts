// A small, dependency-free CSV parser for bulk-create data merge.
// Handles quoted fields, embedded commas, embedded newlines, escaped quotes
// ("" inside a quoted field), and CRLF or LF line endings. The first row is
// treated as the header (column names); subsequent rows become objects keyed by
// header. Ragged rows are tolerated (missing trailing cells become "").

export interface ParsedCsv {
  headers: string[];
  rows: Array<Record<string, string>>;
  /** The raw cell matrix, header row included, for a preview table. */
  matrix: string[][];
}

/** Parse CSV text into a matrix of rows of cells. */
export function parseCsvMatrix(text: string, delimiter = ","): string[][] {
  // Strip a leading UTF-8 BOM so it does not contaminate the first header cell.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === delimiter) {
      endField();
      i++;
      continue;
    }
    if (c === "\r") {
      // swallow CRLF as one line break
      if (text[i + 1] === "\n") i++;
      endRow();
      i++;
      continue;
    }
    if (c === "\n") {
      endRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Flush a final unterminated row. A terminating newline does NOT leave a
  // pending row (endRow already pushed the row it closed), so after a trailing
  // newline `field` and `row` are both empty and nothing extra is flushed. This
  // means a legitimate all-empty data row (e.g. a `,` line, or a single empty
  // last cell) is preserved rather than stripped by a content-based heuristic.
  if (field.length > 0 || row.length > 0) endRow();
  return rows;
}

/** Parse CSV text into headers + objects (first row = headers). */
export function parseCsv(text: string): ParsedCsv {
  const matrix = parseCsvMatrix(text.trim() === "" ? "" : text);
  if (matrix.length === 0) return { headers: [], rows: [], matrix: [] };
  const headers = matrix[0].map((h) => h.trim());
  const rows = matrix.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (cells[idx] ?? "").trim();
    });
    return obj;
  });
  return { headers, rows, matrix };
}

/** The delimiter a CSV file most likely uses: the one of semicolon (German
 *  Excel), tab and comma found most often in its first line, outside quotes. */
export function detectDelimiter(text: string): string {
  const line = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/, 1)[0] ?? "";
  const counts: Record<string, number> = { ";": 0, "\t": 0, ",": 0 };
  let quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && c in counts) counts[c]++;
  }
  return [";", "\t", ","].reduce((best, d) => (counts[d] > counts[best] ? d : best), ",");
}

/** A text file's content: UTF-8 when it is valid UTF-8, else Windows-1252
 *  (what Excel writes for "CSV" on German Windows). */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
