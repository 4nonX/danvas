import type { UploadedAsset } from "@hc/sdk";

/** What the Brand page knows of an upload. */
export type BrandAsset = Pick<UploadedAsset, "id" | "filename" | "url" | "mimeType" | "thumbnail">;
export type BrandAssets = Map<string, BrandAsset>;
