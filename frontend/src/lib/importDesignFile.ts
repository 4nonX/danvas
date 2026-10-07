// Turn a file the user picked or dropped into a design: PowerPoint (.pptx,
// e.g. a Canva export), OpenDocument (.odp), a Markdown outline, or the open
// .hyc format. Used by the single "Import" tile and the bulk folder import, so
// both convert identically. Everything runs client-side; the server
// re-validates on create.

import { createBlankDesign, type DesignFile } from "@hc/schema";
import { odpToDesign, pptxToDesign } from "@hc/export";
import { catalogEntryForMood, deckThemes, layoutDeck, parseMarkdownOutline } from "@hc/aistudio";
import { hycAccept, importedTitle, parseHycFile, readFileText } from "@/lib/hycFile";

/** `accept` attribute for every importable design file. */
export const designImportAccept = `${hycAccept},.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation,.odp,application/vnd.oasis.opendocument.presentation,.md,.markdown,text/markdown`;

/** Whether a file name looks importable (bulk import skips everything else). */
export function isImportableName(name: string): boolean {
  // .hyc.json is the open format with a JSON extension; any other .json
  // (e.g. the Canva exporter's manifest.json) is not a design.
  return /\.(pptx|odp|md|markdown|hyc)$|\.hyc\.json$/i.test(name);
}

// Markdown outline import (F28 C26): DETERMINISTIC, no AI - headings become
// slides, list items become points, laid out through the same pure deck
// builder generation uses (theme seeded from the title, no model calls).
export function mdOutlineToDesign(md: string, fallbackTitle: string): DesignFile {
  const outline = parseMarkdownOutline(md, { fallbackTitle });
  if (!outline) throw new Error("no outline structure in the markdown (add headings or list items)");
  const size = { width: 1920, height: 1080 };
  const seed = Array.from(outline.title).reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7);
  const theme = deckThemes({ count: 1, kicker: outline.title, seed })[0];
  const deck = layoutDeck(outline, theme, size, { catalog: catalogEntryForMood(outline.theme, seed), seed });
  const file = createBlankDesign({ title: outline.title, width: size.width, height: size.height });
  let pageSeq = 0;
  file.pages = deck.pages.map((p, i) => ({
    id: `md-page-${++pageSeq}`,
    name: p.name || `Page ${i + 1}`,
    width: size.width,
    height: size.height,
    background: p.background,
    children: p.nodes,
    ...(p.note ? { notes: p.note } : {}),
  })) as DesignFile["pages"];
  return file;
}

/** Convert one file to a design file plus the title to create it under. */
export async function designFromFile(f: File): Promise<{ file: DesignFile; title: string }> {
  const isPptx = /\.pptx$/i.test(f.name) || f.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  const isOdp = /\.odp$/i.test(f.name) || f.type === "application/vnd.oasis.opendocument.presentation";
  const isMd = /\.(md|markdown)$/i.test(f.name);
  const file = isPptx
    ? await pptxToDesign(new Uint8Array(await f.arrayBuffer()), { title: f.name.replace(/\.pptx$/i, "") })
    : isOdp
      ? await odpToDesign(new Uint8Array(await f.arrayBuffer()), { title: f.name.replace(/\.odp$/i, "") })
      : isMd
        ? mdOutlineToDesign(await readFileText(f), f.name.replace(/\.(md|markdown)$/i, ""))
        : parseHycFile(await readFileText(f));
  const title = importedTitle(file, f.name);
  return { file: { ...file, title }, title };
}
