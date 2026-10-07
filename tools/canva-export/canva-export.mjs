#!/usr/bin/env node
// Canva -> local folder tree of .pptx files, for the HyCanvas bulk import
// (Projects > Import folder). READ-ONLY on the Canva side: it only lists
// folders/designs and creates export jobs; nothing in Canva is changed.
//
//   node canva-export.mjs [output-dir]
//   node canva-export.mjs [output-dir] --list
//       Write folders.txt (the Canva folder tree with design counts) and
//       export nothing; uses no export quota.
//   node canva-export.mjs [output-dir] --only "Marketing" "Social Media"
//       Export only these top-level folders (with all their subfolders).
//       "_Ohne Ordner" selects designs outside any folder, "_Projekte"
//       designs lying directly in the Projects root.
//   --folders FAFUixSXQEI FAFUi_cuw2Y ...
//       Also walk these folders by id (team folders owned by another member
//       are not under the account's own Projects root). The id is the last
//       part of the folder URL, canva.com/folder/<id>.
//
// Needs a Canva integration (Developer Portal > Your integrations) with the
// scopes design:meta:read, design:content:read, folder:read and the redirect
// URL http://127.0.0.1:3456/oauth/redirect. Put its credentials in a file
// named .env next to this script (never commit it):
//   CANVA_CLIENT_ID=...
//   CANVA_CLIENT_SECRET=...
//
// The browser opens Canva's consent page once; the access token lives only in
// memory. Progress is kept in <output-dir>/manifest.json, so a second run
// skips designs already downloaded (and resumes after the daily export cap).
//
// Canva limits (Connect API): 75 exports per 5 minutes and 500 per day per
// user, 20 export requests per minute. The script paces itself below that.

import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const API = "https://api.canva.com/rest/v1";
const PORT = 3456;
const REDIRECT = `http://127.0.0.1:${PORT}/oauth/redirect`;
const SCOPES = "design:meta:read design:content:read folder:read";
// 75 exports / 5 min => one every 4 s; 4.2 s keeps a margin.
const EXPORT_INTERVAL_MS = 4200;

const argv = process.argv.slice(2);
const listOnly = argv.includes("--list");
/** Values following a flag, up to the next flag. */
function flagValues(flag) {
  const at = argv.indexOf(flag);
  if (at < 0) return null;
  const out = [];
  for (let i = at + 1; i < argv.length && !argv[i].startsWith("--"); i++) out.push(argv[i]);
  return out;
}
const only = flagValues("--only")?.map((a) => a.toLowerCase()) ?? null;
const extraFolders = flagValues("--folders") ?? [];
const firstFlag = argv.findIndex((a) => a.startsWith("--"));
const positional = argv.filter((a, i) => !a.startsWith("--") && (firstFlag < 0 || i < firstFlag));
const outDir = resolve(positional[0] ?? join(homedir(), "Documents", "Canva-Export"));
const manifestPath = join(outDir, "manifest.json");

function loadEnv() {
  const p = join(HERE, ".env");
  if (!existsSync(p)) {
    console.error(`Missing ${p} with CANVA_CLIENT_ID and CANVA_CLIENT_SECRET (see the header of this script).`);
    process.exit(1);
  }
  const env = Object.fromEntries(
    readFileSync(p, "utf8").split(/\r?\n/).filter((l) => /^\s*[A-Z_]+\s*=/.test(l)).map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
  );
  if (!env.CANVA_CLIENT_ID || !env.CANVA_CLIENT_SECRET) {
    console.error(".env must set CANVA_CLIENT_ID and CANVA_CLIENT_SECRET.");
    process.exit(1);
  }
  return env;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function openBrowser(url) {
  const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

/** OAuth 2.0 authorization code flow with PKCE; returns an access token. */
async function authorize(env) {
  const verifier = b64url(randomBytes(64));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  const url = `https://www.canva.com/api/oauth/authorize?${new URLSearchParams({
    code_challenge: challenge,
    code_challenge_method: "s256",
    scope: SCOPES,
    response_type: "code",
    client_id: env.CANVA_CLIENT_ID,
    state,
    redirect_uri: REDIRECT,
  })}`;
  const code = await new Promise((resolveCode, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== "/oauth/redirect") { res.writeHead(404).end(); return; }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      if (u.searchParams.get("state") !== state || !u.searchParams.get("code")) {
        res.end("<p>Canva authorization failed. You can close this tab.</p>");
        server.close();
        reject(new Error(`authorization failed: ${u.searchParams.get("error") ?? "state mismatch"}`));
        return;
      }
      res.end("<p>Canva connected. Export is running in the terminal; you can close this tab.</p>");
      server.close();
      resolveCode(u.searchParams.get("code"));
    });
    server.listen(PORT, "127.0.0.1", () => {
      console.log("Opening Canva in your browser to approve read-only access...");
      console.log(`If nothing opens, visit:\n${url}\n`);
      openBrowser(url);
    });
  });
  const res = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${env.CANVA_CLIENT_ID}:${env.CANVA_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code_verifier: verifier, code, redirect_uri: REDIRECT }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) throw new Error(`token exchange failed (${res.status}): ${body.message ?? body.error ?? "unknown"}`);
  return body.access_token;
}

/** GET/POST against the Connect API with 429 back-off. */
async function api(token, method, path, body) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || 15000 * (attempt + 1);
      console.log(`  rate limited, waiting ${Math.round(wait / 1000)} s`);
      await sleep(wait);
      continue;
    }
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const err = new Error(`${method} ${path}: ${res.status} ${json.code ?? ""} ${json.message ?? ""}`.trim());
      err.status = res.status;
      err.code = json.code;
      throw err;
    }
    return json;
  }
  const err = new Error(`${method} ${path}: still rate limited after retries`);
  err.status = 429;
  throw err;
}

/** Folder tree from the user's Projects root: design id -> folder path. */
async function walkFolders(token) {
  const placed = new Map(); // design id -> { title, path }
  const visit = async (folderId, path) => {
    let continuation;
    do {
      const q = new URLSearchParams({ item_types: "design,folder", limit: "100", ...(continuation ? { continuation } : {}) });
      const page = await api(token, "GET", `/folders/${folderId}/items?${q}`);
      for (const item of page.items ?? []) {
        if (item.type === "folder" && item.folder) {
          await visit(item.folder.id, [...path, item.folder.name]);
        } else if (item.type === "design" && item.design && !placed.has(item.design.id)) {
          placed.set(item.design.id, { title: item.design.title, path });
        }
      }
      continuation = page.continuation;
    } while (continuation);
  };
  // Explicit folders first, so their designs keep that folder structure.
  for (const id of extraFolders) {
    try {
      const meta = await api(token, "GET", `/folders/${id}`);
      const name = meta.folder?.name ?? id;
      console.log(`  folder ${name}`);
      await visit(id, [name]);
    } catch (e) {
      console.log(`  could not read folder ${id} (${e.message})`);
    }
  }
  try {
    await visit("root", []);
  } catch (e) {
    console.log(`  could not read the folder tree (${e.message}); designs will be exported without folders`);
  }
  return placed;
}

/** Every design the user can see (owned + shared). */
async function listDesigns(token) {
  const all = [];
  let continuation;
  do {
    const q = new URLSearchParams({ ownership: "any", sort_by: "title_ascending", ...(continuation ? { continuation } : {}) });
    const page = await api(token, "GET", `/designs?${q}`);
    all.push(...(page.items ?? []));
    continuation = page.continuation;
  } while (continuation);
  return all;
}

const safe = (s) => (s || "Untitled").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "").trim().slice(0, 120) || "Untitled";

async function exportPptx(token, designId) {
  const created = await api(token, "POST", "/exports", { design_id: designId, format: { type: "pptx" } });
  const jobId = created.job?.id;
  for (let i = 0; i < 90; i++) {
    await sleep(i < 5 ? 1500 : 3000);
    const { job } = await api(token, "GET", `/exports/${jobId}`);
    if (job.status === "success") return job.urls ?? [];
    if (job.status === "failed") throw new Error(`export failed: ${job.error?.code ?? ""} ${job.error?.message ?? ""}`.trim());
  }
  throw new Error("export timed out");
}

async function main() {
  const env = loadEnv();
  mkdirSync(outDir, { recursive: true });
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { designs: {} };
  const saveManifest = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const token = await authorize(env);
  console.log("Reading the Canva folder tree...");
  const placed = await walkFolders(token);
  console.log("Listing designs...");
  const designs = await listDesigns(token);
  console.log(`${designs.length} designs visible, ${placed.size} found in folders.\n`);

  // Target file per design: its Canva folder path (or a catch-all folder),
  // title as file name, de-duplicated within a folder.
  const usedNames = new Map();
  for (const rec of Object.values(manifest.designs)) if (rec.file) usedNames.set(rec.file.toLowerCase(), true);
  const folderOf = (d) => {
    const where = placed.get(d.id);
    // Designs outside the user's folder tree (e.g. shared with them) go
    // to one catch-all folder.
    return where ? where.path.map(safe) : ["_Ohne Ordner"];
  };

  if (argv.includes("--dump")) {
    // Every visible design as CSV, to see what the API counts as a design.
    const csv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const iso = (t) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : "");
    const rows = ["title;folder;created;updated;pages;owner_user;owner_team;id"];
    for (const d of designs) {
      rows.push([d.title, folderOf(d).join(" / "), iso(d.created_at), iso(d.updated_at), d.page_count, d.owner?.user_id, d.owner?.team_id, d.id].map(csv).join(";"));
    }
    writeFileSync(join(outDir, "designs.csv"), "﻿" + rows.join("\n") + "\n");
    console.log(`Wrote ${designs.length} rows to ${join(outDir, "designs.csv")}`);
    return;
  }

  if (listOnly) {
    // Folder tree with counts: designs directly inside and in total.
    const direct = new Map();
    const total = new Map();
    for (const d of designs) {
      const path = folderOf(d);
      direct.set(path.join(" / "), (direct.get(path.join(" / ")) ?? 0) + 1);
      for (let n = 0; n <= path.length; n++) {
        const key = path.slice(0, n).join(" / ");
        total.set(key, (total.get(key) ?? 0) + 1);
      }
    }
    const keys = [...total.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b, "de"));
    const lines = [`${designs.length} designs in total; ${direct.get("") ?? 0} directly in the Projects root (select with "_Projekte")`, ""];
    for (const k of keys) {
      const depth = k.split(" / ").length - 1;
      lines.push(`${"    ".repeat(depth)}${k.split(" / ").pop()}  [${total.get(k)}${direct.get(k) && direct.get(k) !== total.get(k) ? `, ${direct.get(k)} direkt` : ""}]`);
    }
    writeFileSync(join(outDir, "folders.txt"), lines.join("\n") + "\n");
    console.log(lines.filter((l) => !l.startsWith("    ")).join("\n"));
    console.log(`\nFull tree: ${join(outDir, "folders.txt")}`);
    return;
  }

  const selected = only
    ? designs.filter((d) => {
      const top = (folderOf(d)[0] ?? "_Projekte").toLowerCase();
      return only.includes(top) || only.includes(safe(top).toLowerCase());
    })
    : designs;
  if (only) console.log(`--only: ${selected.length} of ${designs.length} designs selected.\n`);

  const plan = selected.map((d) => {
    const folder = folderOf(d);
    const prior = manifest.designs[d.id];
    if (prior?.file) return { d, file: prior.file };
    const base = join(...folder, safe(d.title));
    let file = `${base}.pptx`;
    for (let n = 2; usedNames.has(file.toLowerCase()); n++) file = `${base} (${n}).pptx`;
    usedNames.set(file.toLowerCase(), true);
    return { d, file };
  });

  let done = 0, skipped = 0, failed = 0, lastExport = 0;
  for (const [i, { d, file }] of plan.entries()) {
    const prior = manifest.designs[d.id];
    const label = `[${i + 1}/${plan.length}] ${file}`;
    if (prior?.status === "ok" && prior.updated_at === d.updated_at && existsSync(join(outDir, file))) {
      skipped++;
      continue;
    }
    const wait = lastExport + EXPORT_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastExport = Date.now();
    try {
      const urls = await exportPptx(token, d.id);
      if (!urls.length) throw new Error("export returned no file");
      const res = await fetch(urls[0]);
      if (!res.ok) throw new Error(`download failed (${res.status})`);
      const target = join(outDir, file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, Buffer.from(await res.arrayBuffer()));
      manifest.designs[d.id] = { title: d.title, file, status: "ok", updated_at: d.updated_at, edit_url: d.urls?.edit_url };
      done++;
      console.log(`${label}  ok`);
    } catch (e) {
      manifest.designs[d.id] = { title: d.title, file, status: "failed", error: e.message, updated_at: d.updated_at };
      failed++;
      console.log(`${label}  FAILED: ${e.message}`);
      // Daily cap reached: stop cleanly; the next run resumes here.
      if (e.status === 429 || /quota|limit/i.test(e.code ?? "")) {
        console.log("\nCanva export limit reached. Run the script again later to continue.");
        saveManifest();
        break;
      }
    }
    saveManifest();
  }
  saveManifest();
  console.log(`\nDone: ${done} exported, ${skipped} already up to date, ${failed} failed.`);
  console.log(`Files: ${outDir}`);
  console.log("Next: HyCanvas > Projects > Import folder, and pick this folder (or drag it in).");
}

main().catch((e) => {
  console.error(`\nError: ${e.message}`);
  process.exit(1);
});
