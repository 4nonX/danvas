// SVG files placed as image elements (brand logos, uploads, imported
// designs) render fine but cannot be recolored or edited. These helpers tell
// whether an image's source is an SVG and turn it into vector nodes laid out
// exactly where the image draws it (same fit and crop), so the image can be
// swapped for editable shapes in place.

import { fitRect } from "@hc/engine";
import { createNode, type Node } from "@hc/schema";
import { imageAssets } from "@/lib/assetProvider";
import { flattenSvgToNodes } from "@/lib/svgFlatten";

type ImageLike = {
  source: { assetId: string };
  size: { width: number; height: number };
  fit: "contain" | "cover" | "stretch" | "none";
  crop?: { x: number; y: number; width: number; height: number };
  focalPoint?: { x: number; y: number };
};

const svgText = new Map<string, Promise<string | null>>();

/** The SVG markup behind an asset url, or null when it is not an SVG.
 *  Cached per url: the toolbar asks on every selection. */
export function svgSourceOf(assetId: string): Promise<string | null> {
  const url = imageAssets.url(assetId);
  if (!url) return Promise.resolve(null);
  let p = svgText.get(url);
  if (!p) {
    p = (async () => {
      if (url.startsWith("data:")) {
        if (!/^data:image\/svg\+xml/i.test(url)) return null;
        const comma = url.indexOf(",");
        const body = url.slice(comma + 1);
        return /;base64,/i.test(url.slice(0, comma + 1)) ? atob(body) : decodeURIComponent(body);
      }
      try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) return null;
        const type = res.headers.get("content-type") ?? "";
        if (type && !/svg|xml|text\/plain|octet-stream/i.test(type)) return null;
        const text = await res.text();
        return /<svg[\s>]/i.test(text.slice(0, 4096)) ? text : null;
      } catch {
        return null;
      }
    })();
    svgText.set(url, p);
  }
  return p;
}

/** Vector nodes for an SVG drawn the way `img` draws it, in the image's
 *  local space (0..width, 0..height). `clip` is set when the fit or crop
 *  hides part of the artwork, so the caller clips to the image box. */
export function svgImageNodes(img: ImageLike, svg: string): { children: Node[]; clip: boolean } | null {
  // SVG paints an unstyled shape black; keep that, as icons do.
  const { nodes } = flattenSvgToNodes(svg, { fallbackFill: true });
  if (!nodes.length) return null;
  const vb = /viewBox\s*=\s*["']([^"']+)["']/i.exec(svg)?.[1]?.trim().split(/[\s,]+/).map(Number);
  const wAttr = parseFloat(/<svg[^>]*\bwidth\s*=\s*["']([\d.]+)/i.exec(svg)?.[1] ?? "");
  const hAttr = parseFloat(/<svg[^>]*\bheight\s*=\s*["']([\d.]+)/i.exec(svg)?.[1] ?? "");
  const hasVb = vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0;
  const minX = hasVb ? vb[0] : 0;
  const minY = hasVb ? vb[1] : 0;
  const vbW = (hasVb ? vb[2] : wAttr) || 100;
  const vbH = (hasVb ? vb[3] : hAttr) || 100;

  // Same placement the renderer uses for the image (render2d drawImage).
  const crop = img.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const { width: w, height: h } = img.size;
  const fr = fitRect(vbW * crop.width, vbH * crop.height, w, h, img.fit, img.focalPoint);
  const sx0 = crop.x + fr.source.x * crop.width;
  const sy0 = crop.y + fr.source.y * crop.height;
  const sw = fr.source.width * crop.width;
  const sh = fr.source.height * crop.height;
  const scaleX = fr.dest.width / (sw * vbW);
  const scaleY = fr.dest.height / (sh * vbH);
  const art = createNode("group", {
    name: "SVG",
    children: nodes,
    transform: { x: fr.dest.x - (sx0 * vbW + minX) * scaleX, y: fr.dest.y - (sy0 * vbH + minY) * scaleY, scaleX, scaleY, rotation: 0 },
    size: { width: vbW, height: vbH },
  } as Partial<Node>);
  const eps = 1e-6;
  const clip = sx0 > eps || sy0 > eps || sx0 + sw < 1 - eps || sy0 + sh < 1 - eps || fr.dest.x < -eps || fr.dest.y < -eps
    || fr.dest.x + fr.dest.width > w + eps || fr.dest.y + fr.dest.height > h + eps;
  return { children: [art], clip };
}
