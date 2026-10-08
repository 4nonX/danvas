// Mirrors the background-removal model (about 120 MB: the ONNX runtime and the
// default "medium" model, isnet_fp16) so an instance serves it itself from
// STATIC_DATA_DIR instead of fetching it from the library vendor's CDN.
//
//   node scripts/fetch-bg-model.mjs <static-data dir>
//
// Writes <dir>/bg-removal/<version>/, where <version> is the
// @imgly/background-removal recorded in package-lock.json. Every file is
// checked against the SHA-256 the vendor publishes; files already present and
// unchanged are skipped, so it is re-runnable. Fails when the frontend expects
// another version (BG_DATA_PATH in frontend/src/lib/imageFilters.ts), so a
// build never ships a model the app cannot find.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/fetch-bg-model.mjs <static-data dir>");
  process.exit(2);
}

const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
const version = lock.packages?.["node_modules/@imgly/background-removal"]?.version;
if (!version) {
  console.error("@imgly/background-removal is not in package-lock.json");
  process.exit(1);
}
const filters = readFileSync(join(ROOT, "frontend", "src", "lib", "imageFilters.ts"), "utf8");
if (!filters.includes(`bg-removal/${version}/`)) {
  console.error(`frontend/src/lib/imageFilters.ts expects another background remover version than ${version} (adjust BG_DATA_PATH).`);
  process.exit(1);
}

const out = join(target, "bg-removal", version);
const base = `https://staticimgly.com/@imgly/background-removal-data/${version}/dist/`;
console.log(`Background remover ${version} -> ${out}`);
mkdirSync(out, { recursive: true });

async function get(name, timeoutMs) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(base + name, {
        headers: { "User-Agent": "danvas self-host mirror" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      if (attempt >= 3) throw new Error(`${name}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

const raw = await get("resources.json", 60_000);
const resources = JSON.parse(new TextDecoder().decode(raw));
const keep = Object.keys(resources).filter((k) => k.startsWith("/onnxruntime-web/") || k === "/models/isnet_fp16");
let bytes = 0;
for (const key of keep) {
  for (const chunk of resources[key].chunks) {
    const path = join(out, chunk.name);
    if (existsSync(path) && sha256(readFileSync(path)) === chunk.hash) continue;
    const data = await get(chunk.name, 300_000);
    if (sha256(data) !== chunk.hash) {
      console.error(`checksum mismatch: ${chunk.name}`);
      process.exit(1);
    }
    writeFileSync(path, data);
    bytes += data.length;
  }
}
writeFileSync(join(out, "resources.json"), raw);
writeFileSync(join(target, "bg-removal", "NOTICE.txt"), [
  `Background-removal data for @imgly/background-removal ${version}, mirrored unaltered from`,
  `${base}`,
  "",
  "@imgly/background-removal by IMG.LY: AGPL-3.0, https://github.com/imgly/background-removal-js",
  "ISNET model (DIS) by Xuebin Qin: MIT, https://github.com/xuebinqin/DIS",
  "onnxruntime-web by Microsoft: MIT, https://github.com/microsoft/onnxruntime",
  "",
].join("\n"));
console.log(`done, ${Math.round(bytes / 1e6)} MB downloaded`);
