// Entry for the server-side import converter bundle
// (backend/internal/pptxconv/pptxconv.js). Bundled by
// scripts/build-pptx-convert.mjs and executed inside the Go binary by goja, so
// the server-side Canva import turns exports into designs with the exact code
// a file import runs in the browser, with no browser and no Node runtime.
//
// The Go side calls these globals:
//   __pptxToDesign(Uint8Array, title)   starts the conversion; the outcome
//                                       lands in globalThis.__result as
//                                       { ok: json } or { err: message } once
//                                       goja has drained its job queue
//   __imagePagesDesign(title)           reads globalThis.__pages
//                                       ([{ bytes, mime, width, height }])
//                                       and returns the design JSON

import "./pptx-convert-polyfill.mjs"; // MUST stay the first import (host shims)
import { pptxToDesign } from "../packages/export/dist/pptximport.js";
import { imagePagesDesign } from "../packages/export/dist/imagepages.js";

globalThis.__pptxToDesign = (bytes, title) => {
  globalThis.__result = undefined;
  pptxToDesign(bytes, { title }).then(
    (file) => {
      globalThis.__result = { ok: JSON.stringify(file) };
    },
    (e) => {
      globalThis.__result = { err: String((e && e.message) || e) };
    },
  );
};

globalThis.__imagePagesDesign = (title) => JSON.stringify(imagePagesDesign(title, globalThis.__pages));
