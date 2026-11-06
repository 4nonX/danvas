// Browser image asset provider for the engine (image decode path, browser
// flavor). Maps an asset id to a loaded HTMLImageElement so renderScene can
// draw real images via ctx.drawImage. Seeded from a design's AssetRef[] (their
// CDN/blob urls) and from in-editor image placement. Worker/GPU texture upload
// and crop/fit fidelity remain deferred; this draws the image into the node box.

import type { AssetProvider, AssetStatus } from "@hc/engine";
import { resolveAssetUrl } from "@/lib/sdk";

interface Entry {
  url: string;
  status: AssetStatus;
  img: HTMLImageElement | HTMLVideoElement | null;
  video?: boolean;
  /** An SVG: drawn on screen from cached bitmaps (see raster()). */
  svg?: boolean;
}

/** Bitmaps of SVG assets kept at once, in pixels (about 4 bytes each). */
const RASTER_BUDGET_PX = 48_000_000;

/** Whether a url or type names an SVG. */
const isSvg = (url: string, type?: string) =>
  /svg/i.test(type ?? "") || /^data:image\/svg/i.test(url) || /\.svgz?(?:[?#]|$)/i.test(url);

class ImageAssetProvider implements AssetProvider {
  private entries = new Map<string, Entry>();
  private subs = new Set<(assetId: string) => void>();
  /** "assetId@WxH" -> bitmap, oldest first (a Map keeps insertion order). */
  private rasters = new Map<string, HTMLCanvasElement>();
  private rasterPx = 0;

  /** Register an asset id -> url and begin loading it (idempotent per url).
   *  Server-relative urls are resolved against the API origin here: documents
   *  can carry them (upload responses are relative unless the backend has a
   *  publicURL), and loading one against the frontend dev origin 404s, which
   *  reads as a permanently "missing" asset. In the same-origin dist build the
   *  resolution is the identity, so this only matters where it helps. */
  register(assetId: string, url: string, type?: string): void {
    url = resolveAssetUrl(url);
    const existing = this.entries.get(assetId);
    if (existing && existing.url === url) {
      if (type && isSvg(url, type)) existing.svg = true;
      return;
    }
    this.dropRasters(assetId);
    const entry: Entry = { url, status: "loading", img: null, svg: isSvg(url, type) };
    this.entries.set(assetId, entry);
    if (typeof window === "undefined") return;
    const img = new Image();
    img.crossOrigin = "anonymous"; // keep the export canvas untainted where CORS allows
    img.onload = () => {
      entry.img = img;
      entry.status = "ready";
      this.notify(assetId);
    };
    img.onerror = () => {
      entry.status = "missing";
      this.notify(assetId);
    };
    img.src = url;
  }

  /** Register a video asset id -> url as an HTMLVideoElement so the engine can
   *  draw the current frame via ctx.drawImage. Notifies on load and on seek so
   *  the canvas repaints when the frame changes (scrubbing/playback). */
  registerVideo(assetId: string, url: string): void {
    url = resolveAssetUrl(url); // same relative-url resolution as register()
    const existing = this.entries.get(assetId);
    if (existing && existing.url === url) return;
    const entry: Entry = { url, status: "loading", img: null, video: true };
    this.entries.set(assetId, entry);
    if (typeof window === "undefined") return;
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true; // required for programmatic play without a gesture
    v.playsInline = true;
    v.preload = "auto";
    const ready = () => { entry.img = v; entry.status = "ready"; this.notify(assetId); };
    v.addEventListener("loadeddata", ready);
    v.addEventListener("seeked", () => this.notify(assetId));
    v.addEventListener("timeupdate", () => this.notify(assetId));
    v.addEventListener("error", () => { entry.status = "missing"; this.notify(assetId); });
    v.src = url;
  }

  /** The underlying HTMLVideoElement for a video asset (for scrub/play control). */
  videoEl(assetId: string): HTMLVideoElement | null {
    const e = this.entries.get(assetId);
    return e?.video && e.img instanceof HTMLVideoElement ? e.img : null;
  }

  /** Register every AssetRef of a design (by id -> url); videos load as <video>. */
  registerAll(assets: { id: string; url: string; kind?: string; mime?: string }[]): void {
    for (const a of assets) {
      if (!a.url) continue;
      if (a.kind === "video") this.registerVideo(a.id, a.url);
      else this.register(a.id, a.url, a.kind === "svg" ? "image/svg+xml" : a.mime);
    }
  }

  /** An SVG asset as a bitmap of width x height, drawn once and kept (the
   *  oldest go when the budget is full). Null for anything but a loaded SVG. */
  raster(assetId: string, width: number, height: number): unknown | null {
    const e = this.entries.get(assetId);
    if (!e?.svg || e.status !== "ready" || !(e.img instanceof HTMLImageElement) || typeof document === "undefined") return null;
    if (width * height > RASTER_BUDGET_PX) return null;
    const key = `${assetId}@${width}x${height}`;
    const hit = this.rasters.get(key);
    if (hit) {
      // Most recently used goes to the end.
      this.rasters.delete(key);
      this.rasters.set(key, hit);
      return hit;
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const c = canvas.getContext("2d");
    if (!c) return null;
    try {
      c.drawImage(e.img, 0, 0, width, height);
    } catch {
      return null;
    }
    this.rasters.set(key, canvas);
    this.rasterPx += width * height;
    for (const [k, old] of this.rasters) {
      if (this.rasterPx <= RASTER_BUDGET_PX || k === key) break;
      this.rasters.delete(k);
      this.rasterPx -= old.width * old.height;
    }
    return canvas;
  }

  private dropRasters(assetId: string): void {
    for (const [k, c] of this.rasters) {
      if (!k.startsWith(`${assetId}@`)) continue;
      this.rasters.delete(k);
      this.rasterPx -= c.width * c.height;
    }
  }

  image(assetId: string): unknown | null {
    return this.entries.get(assetId)?.img ?? null;
  }

  /** Source URL for an asset id (used by the crop overlay's preview image). */
  url(assetId: string): string | null {
    return this.entries.get(assetId)?.url ?? null;
  }

  status(assetId: string): AssetStatus {
    return this.entries.get(assetId)?.status ?? "missing";
  }

  onChange(cb: (assetId: string) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  private notify(assetId: string): void {
    for (const cb of this.subs) cb(assetId);
  }
}

/** Shared provider for the editor canvas and export. */
export const imageAssets = new ImageAssetProvider();
