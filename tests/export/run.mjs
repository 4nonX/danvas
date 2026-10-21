// Export check: runs designs through every export format in a real Chrome
// (the code of the download menu, see harness.ts) and checks the files with
// the tools a print shop's software amounts to: Poppler and Ghostscript to
// read PDF and EPS, ImageMagick for the raster formats.
//
//   npm run test:export                       # the built-in fixtures
//   node tests/export/run.mjs --designs DIR   # every .hyc in DIR (page 1)
//       [--asset-base https://host]           #   where /api/v1/assets/* load from
//   node tests/export/run.mjs --only label    # one fixture
//   ... --formats pdf-vector,png              # only these formats (designs mode)
//
// Needs: Chrome or Chromium (CHROME_PATH, or a usual install path), and
// pdfinfo/pdftoppm (poppler-utils), gs (ghostscript), ImageMagick.
// Writes every file, its rendering and a report to tests/export/out (or
// --out DIR); exits 1 when a check fails.
//
// What is checked, per file:
//   - it looks like the reference: the same sheet drawn without viewport
//     culling, compared in 16 px blocks (anti-aliasing passes, a missing or
//     shifted element does not); CMYK files by where there is ink at all;
//   - the fixture's regions that must show something are not blank;
//   - the sheet: page boxes (PDF), bounding box (EPS), pixel size;
//   - colour: no RGB in a CMYK file, the output intent, PDF/X-4 marking,
//     the spot colours asked for, black overprinting (from real separations);
//   - the resolution PNG, JPEG and TIFF state.

import { build } from "esbuild";
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const OUT = resolve(opt("--out") ?? join(HERE, "out"));
const DESIGNS = opt("--designs");
const ASSET_BASE = opt("--asset-base");
const ONLY = opt("--only");
// --formats pdf-vector,png (designs mode: all formats unless given).
const FORMATS = opt("--formats")?.split(",");
const SCALE = 2;
const DPI = 96 * SCALE;

// ---------------------------------------------------------------- tools
const IM = (() => { try { execFileSync("magick", ["-version"], { stdio: "ignore" }); return "magick"; } catch { return "convert"; } })();
const run = (cmd, a, opts = {}) => execFileSync(cmd, a, { maxBuffer: 1 << 30, ...opts });
const text = (cmd, a) => run(cmd, a).toString("latin1");

function findChrome() {
  const paths = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const pw = join(homedir(), ".cache/ms-playwright");
  if (existsSync(pw)) for (const d of readdirSync(pw).filter((n) => n.startsWith("chromium-")).sort().reverse()) paths.push(join(pw, d, "chrome-linux/chrome"), join(pw, d, "chrome-linux64/chrome"));
  const p = paths.filter(Boolean).find((x) => existsSync(x));
  if (!p) throw new Error("no Chrome or Chromium found; set CHROME_PATH");
  return p;
}

/** Raw RGB pixels of an image file at its own size. */
function pixels(file) {
  const [w, h] = text(IM === "magick" ? "magick" : "identify", IM === "magick" ? ["identify", "-format", "%w %h", `${file}[0]`] : ["-format", "%w %h", `${file}[0]`]).trim().split(" ").map(Number);
  const raw = run(IM, [`${file}[0]`, "-alpha", "remove", "-background", "white", "-colorspace", "sRGB", "-depth", "8", "rgb:-"]);
  return { w, h, data: raw };
}

/** Resize one image's pixels to another's size (via ImageMagick). */
function pixelsAt(file, w, h) {
  const raw = run(IM, [`${file}[0]`, "-alpha", "remove", "-background", "white", "-colorspace", "sRGB", "-resize", `${w}x${h}!`, "-depth", "8", "rgb:-"]);
  return { w, h, data: raw };
}

// ---------------------------------------------------------------- compare
const BLOCK = 16;
/** Block-mean comparison: the largest per-channel difference of block means,
 *  and where. RGB mode compares colour; ink mode compares where there is
 *  anything but paper (for CMYK files, whose colours are converted). */
function compare(ref, img, ink = false) {
  let worst = 0, at = null, bad = 0;
  const bw = Math.ceil(ref.w / BLOCK), bh = Math.ceil(ref.h / BLOCK);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let n = 0;
      const a = [0, 0, 0], b = [0, 0, 0];
      for (let y = by * BLOCK; y < Math.min(ref.h, (by + 1) * BLOCK); y++) {
        for (let x = bx * BLOCK; x < Math.min(ref.w, (bx + 1) * BLOCK); x++) {
          const i = (y * ref.w + x) * 3;
          if (ink) {
            a[0] += Math.min(ref.data[i], ref.data[i + 1], ref.data[i + 2]) < 235 ? 255 : 0;
            b[0] += Math.min(img.data[i], img.data[i + 1], img.data[i + 2]) < 235 ? 255 : 0;
          } else for (let c = 0; c < 3; c++) { a[c] += ref.data[i + c]; b[c] += img.data[i + c]; }
          n++;
        }
      }
      const d = Math.max(...[0, 1, 2].map((c) => Math.abs(a[c] - b[c]) / n));
      if (d > worst) { worst = d; at = [bx * BLOCK, by * BLOCK]; }
      if (d > (ink ? 110 : 40)) bad++;
    }
  }
  return { worst: Math.round(worst), at, bad };
}

/** Share of pixels in a box that differ clearly from the given colour. */
function inked(img, box, bg) {
  let n = 0, hit = 0;
  for (let y = Math.max(0, box.y); y < Math.min(img.h, box.y + box.h); y++) {
    for (let x = Math.max(0, box.x); x < Math.min(img.w, box.x + box.w); x++) {
      const i = (y * img.w + x) * 3;
      if (Math.abs(img.data[i] - bg[0]) + Math.abs(img.data[i + 1] - bg[1]) + Math.abs(img.data[i + 2] - bg[2]) > 60) hit++;
      n++;
    }
  }
  return n ? hit / n : 0;
}

// ---------------------------------------------------------------- PDF/EPS facts
/** Decompressed content of every stream in a PDF (best effort). */
function pdfStreams(buf) {
  const s = buf.toString("latin1");
  const out = [];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf("endstream", start);
    if (end < 0) break;
    try { out.push(inflateSync(buf.subarray(start, end)).toString("latin1")); } catch { /* not deflated */ }
  }
  return out;
}

function pdfBoxes(file) {
  const t = text("pdfinfo", ["-box", "-f", "1", "-l", "1", file]);
  const box = (name) => { const m = new RegExp(`${name}:\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)`).exec(t); return m ? m.slice(1).map(Number) : null; };
  const v = /PDF version:\s+([\d.]+)/.exec(t);
  return { media: box("MediaBox"), trim: box("TrimBox"), bleed: box("BleedBox"), version: v ? v[1] : "" };
}

/** A PDF name token's text: #xx escapes are bytes, the bytes UTF-8. */
const pdfNameText = (t) => Buffer.from(t.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8");
/** The PostScript string literals in a line (DSC text), decoded to text:
 *  \( \) \\ and octal escapes are bytes, the bytes UTF-8. */
const psStrings = (line) => [...line.matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map((x) =>
  Buffer.from(x[1].replace(/\\([0-7]{1,3}|.)/g, (_, e) => (/^[0-7]/.test(e) ? String.fromCharCode(parseInt(e, 8)) : e)), "latin1").toString("utf8"));
const near = (a, b, tol = 0.06) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= tol);

// ---------------------------------------------------------------- per file
function check(o, refFile, ink, pageBg) {
  const problems = [];
  const file = join(OUT, `${o.id.replace(/\//g, "__")}.${o.ext}`);
  const buf = Buffer.from(o.data, "base64");
  writeFileSync(file, buf);
  const e = o.expect;
  // Structure.
  if (o.ext === "pdf") {
    const b = pdfBoxes(file);
    const W = e.sheetPt[0], H = e.sheetPt[1];
    if (!b.media || !near(b.media, [0, 0, W, H])) problems.push(`MediaBox ${b.media} != sheet 0 0 ${W.toFixed(2)} ${H.toFixed(2)}`);
    if (!b.trim || !near(b.trim, e.trimPt)) problems.push(`TrimBox ${b.trim} != ${e.trimPt.map((x) => x.toFixed(2))}`);
    if (!b.bleed || !near(b.bleed, e.bleedPt)) problems.push(`BleedBox ${b.bleed} != ${e.bleedPt.map((x) => x.toFixed(2))}`);
    const s = buf.toString("latin1");
    const streams = pdfStreams(buf);
    if (o.cmyk) {
      if (!s.includes("/OutputIntents")) problems.push("no output intent");
      if (streams.some((c) => /(^|\s)[\d.]+ [\d.]+ [\d.]+ (rg|RG)(\s|$)/.test(c))) problems.push("RGB colour operators in a CMYK file");
      if (/\/ColorSpace \/DeviceRGB/.test(s)) problems.push("RGB image in a CMYK file");
    }
    if (e.pdfx) {
      if (!/GTS_PDFXVersion \(PDF\/X-4\)/.test(s) || !s.includes("pdfxid:GTS_PDFXVersion>PDF/X-4")) problems.push("not marked PDF/X-4 (info and XMP)");
      if (b.version !== "1.6") problems.push(`PDF/X-4 wants PDF 1.6, file is ${b.version}`);
      if (!/\/Trapped \/False/.test(s) || !/\/ID \[</.test(s)) problems.push("PDF/X-4 trapping flag or file id missing");
    }
    const named = [...s.matchAll(/\/Separation \/([^\s/[\]<>()]+)/g)].map((x) => pdfNameText(x[1]));
    for (const sep of e.separations ?? []) if (!named.includes(sep)) problems.push(`spot colour ${sep} missing (named ${named.join(", ") || "none"})`);
    if (e.overprintBlack && !s.includes("/OP true")) problems.push("black does not overprint");
  }
  if (o.ext === "eps") {
    const s = buf.toString("latin1");
    const m = /%%HiResBoundingBox: 0 0 ([\d.]+) ([\d.]+)/.exec(s);
    if (!m || !near([+m[1], +m[2]], e.sheetPt)) problems.push(`BoundingBox ${m ? m.slice(1) : "missing"} != sheet ${e.sheetPt.map((x) => x.toFixed(2))}`);
    if (o.cmyk && !s.includes("%%DocumentProcessColors: Cyan Magenta Yellow Black")) problems.push("CMYK EPS without process colours");
    const line = /%%DocumentCustomColors: (.*)/.exec(s)?.[1] ?? "";
    const named = psStrings(line);
    for (const sep of (e.separations ?? []).filter((x) => x !== "All")) if (!named.includes(sep)) problems.push(`spot colour ${sep} missing (named ${named.join(", ") || "none"})`);
  }
  if (e.dpi && ["png", "jpg", "tif"].includes(o.ext)) {
    const r = text(IM === "magick" ? "magick" : "identify", [...(IM === "magick" ? ["identify"] : []), "-units", "PixelsPerInch", "-format", "%x", `${file}[0]`]).trim();
    if (Math.abs(parseFloat(r) - e.dpi) > 1) problems.push(`states ${r} dpi, expected ${e.dpi}`);
  }
  // Rendering.
  let shown = file;
  if (o.ext === "svg") { shown = file + ".png"; writeFileSync(shown, Buffer.from(o.svgRaster, "base64")); }
  else if (o.ext === "pdf") { const base = file + ".r"; run("pdftoppm", ["-r", String(DPI), "-png", "-singlefile", "-aa", "yes", "-aaVector", "yes", file, base]); shown = base + ".png"; }
  else if (o.ext === "eps") { shown = file + ".png"; run("gs", ["-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-dEPSCrop", "-sDEVICE=png16m", `-r${DPI}`, "-dTextAlphaBits=4", "-dGraphicsAlphaBits=4", `-sOutputFile=${shown}`, file]); }
  const ref = pixels(refFile);
  const img = pixelsAt(shown, ref.w, ref.h);
  const own = pixels(shown);
  if (Math.abs(own.w - ref.w) > 2 || Math.abs(own.h - ref.h) > 2) problems.push(`renders ${own.w}x${own.h} px, sheet is ${ref.w}x${ref.h}`);
  const cmp = compare(ref, img, o.cmyk);
  if (cmp.bad) problems.push(`differs from the reference in ${cmp.bad} block(s), worst ${cmp.worst} at ${cmp.at}`);
  if (!o.cmyk && pageBg) {
    for (const k of ink) {
      const m = (o.expect.trimPt[0] * 96) / 72;
      const box = { x: Math.round((k.x + m) * SCALE), y: Math.round((k.y + m) * SCALE), w: Math.round(k.w * SCALE), h: Math.round(k.h * SCALE) };
      const share = inked(img, box, pageBg);
      if (share < 0.05) problems.push(`blank where "${k.what}" belongs (${(share * 100).toFixed(1)} % ink)`);
    }
  }
  // Separations: black overprints what is under it.
  if (e.overprintBlack && o.fixture === "label") {
    const sep = file + ".sep.tif";
    const isEps = o.ext === "eps";
    run("gs", ["-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", ...(isEps ? ["-dEPSCrop"] : []), "-sDEVICE=tiffsep", "-r96", `-sOutputFile=${sep}`, file]);
    const m = (o.expect.trimPt[0] * 96) / 72;
    const at = `${Math.round(90 + m)},${Math.round(336 + m)}`;
    const plate = (name) => parseFloat(text(IM, [sep.replace(/\.tif$/, `(${name}).tif`), "-format", `%[fx:1-p{${at}}.r]`, "info:"]));
    const c = plate("Cyan"), k = plate("Black");
    if (!(k > 0.9)) problems.push(`black bar not on the black plate (${k.toFixed(2)})`);
    if (!(c > 0.2)) problems.push(`black bar knocks out the cyan under it (${c.toFixed(2)})`);
    // The plates Ghostscript made, by the names it read from the file: a
    // spot colour must arrive under its own name, umlauts and all.
    const base = basename(sep).replace(/\.tif$/, "");
    const plates = readdirSync(dirname(sep)).filter((f) => f.startsWith(base + "(") && f.endsWith(").tif")).map((f) => Buffer.from(f.slice(base.length + 1, -5).replace(/%([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8")); // Ghostscript writes non-ASCII bytes as %XX
    for (const name of (e.separations ?? []).filter((x) => x !== "All")) if (!plates.includes(name)) problems.push(`no plate named ${name} (plates: ${plates.join(", ")})`);
    // The editor's preview must show the inks the file really carries.
    for (const [name, want] of Object.entries(o.proofCoverage ?? {})) {
      const got = 100 * parseFloat(text(IM, [sep.replace(/\.tif$/, `(${name}).tif`), "-format", "%[fx:1-mean]", "info:"]));
      if (!(Math.abs(got - want) <= 3)) problems.push(`preview shows ${want.toFixed(1)} % ${name}, the file has ${got.toFixed(1)} %`);
    }
  }
  // Prepress: the finished size and bleed to 0.01 mm, the plates carrying
  // exactly the values set (no profile in between), spot colours as plates.
  if (o.prepress) {
    const p = o.prepress;
    const mmPt = (mm) => (mm * 72) / 25.4;
    const tol = mmPt(0.01);
    const sheet = [mmPt(p.trimMm[0] + 2 * p.bleedMm), mmPt(p.trimMm[1] + 2 * p.bleedMm)];
    if (o.ext === "pdf") {
      const b = pdfBoxes(file);
      const tw = b.trim ? b.trim[2] - b.trim[0] : NaN, th = b.trim ? b.trim[3] - b.trim[1] : NaN;
      if (!(Math.abs(tw - mmPt(p.trimMm[0])) <= tol && Math.abs(th - mmPt(p.trimMm[1])) <= tol)) problems.push(`finished size ${(tw * 25.4 / 72).toFixed(3)} x ${(th * 25.4 / 72).toFixed(3)} mm, wanted ${p.trimMm.join(" x ")} mm`);
      const bw = b.bleed ? b.bleed[2] - b.bleed[0] : NaN, bh = b.bleed ? b.bleed[3] - b.bleed[1] : NaN;
      if (!(Math.abs(bw - sheet[0]) <= tol && Math.abs(bh - sheet[1]) <= tol)) problems.push(`bleed box ${(bw * 25.4 / 72).toFixed(3)} x ${(bh * 25.4 / 72).toFixed(3)} mm, wanted ${p.bleedMm} mm on every side`);
    } else {
      const m = /%%HiResBoundingBox: ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)/.exec(buf.toString("latin1"));
      const w = m ? +m[3] - +m[1] : NaN, h = m ? +m[4] - +m[2] : NaN;
      if (!(Math.abs(w - sheet[0]) <= tol && Math.abs(h - sheet[1]) <= tol)) problems.push(`EPS sheet ${(w * 25.4 / 72).toFixed(3)} x ${(h * 25.4 / 72).toFixed(3)} mm, wanted the finished size plus ${p.bleedMm} mm bleed`);
    }
    const sep = file + ".pp.tif";
    const dpi = 150;
    run("gs", ["-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", ...(o.ext === "eps" ? ["-dEPSCrop"] : []), "-sDEVICE=tiffsep", `-r${dpi}`, `-sOutputFile=${sep}`, file]);
    const plateFile = (name) => sep.replace(/\.tif$/, `(${name.replace(/[^\x20-\x7e]/g, (ch) => [...Buffer.from(ch)].map((x) => "%" + x.toString(16).toUpperCase()).join(""))}).tif`);
    for (const pt of p.plates) {
      const x = Math.round(((pt.atMm[0] + p.bleedMm) / 25.4) * dpi), y = Math.round(((pt.atMm[1] + p.bleedMm) / 25.4) * dpi);
      for (const [plate, want] of Object.entries(pt.expect)) {
        const got = 100 * (1 - parseFloat(text(IM, [plateFile(plate), "-format", `%[fx:p{${x},${y}}.r]`, "info:"])));
        if (!(Math.abs(got - want) <= 1)) problems.push(`${pt.what}: ${plate} ${got.toFixed(1)} %, set to ${want} %`);
      }
    }
    for (const s of p.spots) {
      const f = plateFile(s);
      const cov = existsSync(f) ? 100 * parseFloat(text(IM, [f, "-format", "%[fx:1-mean]", "info:"])) : -1;
      if (!(cov > 0.1)) problems.push(cov < 0 ? `no plate for the spot colour ${s}` : `the ${s} plate is empty`);
    }
  }
  // The editor's output check must find nothing wrong with a correct file.
  for (const f of (o.fileFindings ?? []).filter((x) => x.level !== "ok")) problems.push(`output check: ${f.level} ${f.code}${f.params ? " " + JSON.stringify(f.params) : ""}`);
  return { id: o.id, problems, worst: cmp.worst };
}

// ---------------------------------------------------------------- main
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
await build({
  entryPoints: [join(HERE, "harness.ts")], bundle: true, format: "iife", outfile: join(OUT, "harness.js"), absWorkingDir: ROOT,
  nodePaths: [join(ROOT, "node_modules"), join(ROOT, "frontend/node_modules")],
  alias: { "@": join(ROOT, "frontend/src"), "@hc/engine": join(ROOT, "packages/engine/src/index.ts"), "@hc/schema": join(ROOT, "packages/schema/src/index.ts") },
  define: { "process.env.NODE_ENV": '"production"' }, banner: { js: "var process = globalThis.process || { env: {} };" }, logLevel: "error",
});
const fontUrl = "data:font/ttf;base64," + readFileSync(join(ROOT, "backend/internal/render/fonts/LiberationSans-Regular.ttf")).toString("base64");

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"] });
const page = await browser.newPage();
page.setDefaultTimeout(600_000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.setRequestInterception(true);
page.on("request", async (req) => {
  const url = new URL(req.url());
  if (url.host !== "export.check") return req.continue();
  if (url.pathname === "/") return req.respond({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" });
  if (url.pathname.startsWith("/api/") && ASSET_BASE) {
    try {
      const r = await fetch(ASSET_BASE.replace(/\/$/, "") + url.pathname + url.search);
      return req.respond({ status: r.status, contentType: r.headers.get("content-type") ?? "application/octet-stream", body: Buffer.from(await r.arrayBuffer()) });
    } catch { return req.respond({ status: 502, body: "" }); }
  }
  const file = join(ROOT, "frontend/public", url.pathname);
  if (!existsSync(file)) return req.respond({ status: 404, body: "" });
  const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".wasm") ? "application/wasm" : "application/octet-stream";
  return req.respond({ contentType: type, body: readFileSync(file) });
});
await page.goto("http://export.check/");
await page.addScriptTag({ content: readFileSync(join(OUT, "harness.js"), "utf8") });

const results = [];
const runOne = async (label, call, ink, bg) => {
  const res = await call();
  if (res.invalid) { results.push({ id: label, problems: [`design is not valid: ${res.invalid}`] }); return; }
  for (const [key, data] of Object.entries(res.refs)) writeFileSync(join(OUT, `${key.replace(/\//g, "__")}.ref.png`), Buffer.from(data, "base64"));
  for (const o of res.outputs) {
    try {
      results.push(check(o, join(OUT, `${o.ref.replace(/\//g, "__")}.ref.png`), ink, bg));
    } catch (e) {
      results.push({ id: o.id, problems: [`could not be checked: ${String(e.message ?? e).split("\n")[0]}`] });
    }
  }
};

if (DESIGNS) {
  const files = readdirSync(DESIGNS).filter((n) => n.endsWith(".hyc")).sort();
  let k = 0;
  for (const f of files) {
    k++;
    const before = results.length;
    try {
      const doc = JSON.parse(readFileSync(join(DESIGNS, f), "utf8"));
      await runOne(f, () => page.evaluate((d, fm) => window.__exportCheck.runDesign(d, fm), doc, FORMATS), [], null);
    } catch (e) {
      results.push({ id: f, problems: [`export failed: ${String(e.message ?? e).split("\n")[0]}`] });
    }
    const mine = results.slice(before);
    const bad = mine.filter((r) => r.problems.length);
    console.log(`[${k}/${files.length}] ${f}: ${bad.length ? "PROBLEM" : "ok"}`);
    // Only the files of designs with problems stay (thousands of designs).
    if (!bad.length) {
      for (const n of readdirSync(OUT)) if (n.startsWith(f.replace(/\.hyc$/, "")) && !n.endsWith(".md") && !n.endsWith(".json")) rmSync(join(OUT, n), { force: true });
    }
  }
} else {
  const list = await page.evaluate((u) => window.__exportCheck.list(u), fontUrl);
  for (const fx of list.filter((x) => !ONLY || x.name === ONLY)) {
    process.stdout.write(`${fx.name} ... `);
    // Page background of the fixtures, for the blank-region check.
    const bg = { shapes: [245, 242, 230], "offbox-path": [255, 255, 255], text: [255, 255, 255], image: [230, 237, 247], "group-clip": [255, 255, 255], label: [96, 154, 197] }[fx.name] ?? null;
    await runOne(fx.name, () => page.evaluate((u, n) => window.__exportCheck.run(u, n), fontUrl, fx.name), fx.ink, bg);
    console.log("done");
  }
}
await browser.close();

const failed = results.filter((r) => r.problems.length);
const lines = ["# Export check", "", `${results.length} files, ${failed.length} with problems.`, ""];
for (const r of results) lines.push(`- ${r.problems.length ? "FAIL" : "ok  "} ${r.id}${r.worst !== undefined ? ` (worst block ${r.worst})` : ""}${r.problems.map((p) => `\n    - ${p}`).join("")}`);
if (errors.length) lines.push("", "Page errors:", ...errors.map((e) => `- ${e}`));
writeFileSync(join(OUT, "report.md"), lines.join("\n") + "\n");
writeFileSync(join(OUT, "report.json"), JSON.stringify({ results, errors }, null, 2));
console.log(lines.join("\n"));
process.exitCode = failed.length || errors.length ? 1 : 0;
