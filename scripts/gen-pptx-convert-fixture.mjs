// Regenerates the server-side import converter's parity fixture after an
// INTENTIONAL change to the importers. The Go test
// (backend/internal/pptxconv/pptxconv_test.go) converts testdata/deck.pptx and
// the page images under goja and requires the results to match the expected
// files this script produces under Node, from the built @hc/export (native
// DecompressionStream, TextDecoder and btoa, as in the browser). Random ids
// are replaced by "U" on both sides. Run `npm run build:packages` first.
//
// The deck is made by danvas's own PPTX exporter from a small design (text
// with non-ASCII characters, a rotated shape, an embedded image), so the
// fixture holds no third-party content.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testdata = path.join(root, "backend/internal/pptxconv/testdata");
mkdirSync(testdata, { recursive: true });
const load = (p) => import(pathToFileURL(path.join(root, p)).href);
const { createBlankDesign, createNode } = await load("packages/schema/dist/index.js");
const { deckToPptx, pptxToDesign, imagePagesDesign } = await load("packages/export/dist/index.js");

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const normalized = (file) => JSON.stringify(JSON.parse(JSON.stringify(file).replace(UUID, "U")), null, 2) + "\n";

// A tiny valid PNG (solid colour), so Go can measure it with image.DecodeConfig.
function png(width, height, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// The deck: a title with umlauts, a rotated shape, an embedded picture.
const pic = png(6, 4, [89, 119, 103]);
const design = createBlankDesign({ title: "Fixture", width: 960, height: 540 });
design.assets = [{ id: "pic", kind: "image", url: `data:image/png;base64,${pic.toString("base64")}`, mime: "image/png", checksum: "" }];
const text = createNode("text", {
  transform: { x: 60, y: 40, scaleX: 1, scaleY: 1, rotation: 0 },
  size: { width: 600, height: 80 },
  content: [{ runs: [{ text: "Übersicht: Größe, Maße & Öl", style: { fontFamily: "Inter", fontSize: 36, fontWeight: 700 } }] }],
});
const shape = createNode("shape", {
  transform: { x: 300, y: 220, scaleX: 1, scaleY: 1, rotation: 17 },
  size: { width: 240, height: 120 },
});
const image = createNode("image", {
  transform: { x: 640, y: 300, scaleX: 1, scaleY: 1, rotation: 0 },
  size: { width: 240, height: 160 },
  source: { assetId: "pic", naturalWidth: 6, naturalHeight: 4 },
  fit: "cover",
});
design.pages[0].children = [text, shape, image];

const deck = await deckToPptx(design);
writeFileSync(path.join(testdata, "deck.pptx"), deck);
writeFileSync(path.join(testdata, "deck-expected.json"), normalized(await pptxToDesign(deck, { title: "Fixture" })));

const pages = [png(4, 3, [255, 0, 0]), png(2, 5, [0, 0, 255])];
pages.forEach((p, i) => writeFileSync(path.join(testdata, `page${i + 1}.png`), p));
const imageFile = imagePagesDesign("Pages", [
  { bytes: new Uint8Array(pages[0]), mime: "image/png", width: 4, height: 3 },
  { bytes: new Uint8Array(pages[1]), mime: "image/png", width: 2, height: 5 },
]);
writeFileSync(path.join(testdata, "pages-expected.json"), normalized(imageFile));

console.log(`wrote deck.pptx (${deck.length} bytes), deck-expected.json, page1.png, page2.png, pages-expected.json`);
