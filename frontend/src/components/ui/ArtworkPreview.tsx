// A picture of an upload or logo in a pick grid, on a transparency
// checkerboard. Light artwork (a white logo, a white silhouette) would vanish
// on a light tile, so once loaded its visible pixels are measured and light
// artwork is shown on a dark checkerboard instead (as the vectorize panel
// does).

import { useState, type SyntheticEvent } from "react";

const LIGHT_BOARD = "conic-gradient(#e5e7eb 25%, #fff 0 50%, #e5e7eb 0 75%, #fff 0)";
const DARK_BOARD = "conic-gradient(#3f3f46 25%, #52525b 0 50%, #3f3f46 0 75%, #52525b 0)";

/** Whether an image's visible pixels are mostly light. False when it cannot
 *  be read (another origin, not decoded). */
export function isLightArtwork(img: HTMLImageElement): boolean {
  try {
    const size = 32;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, size, size);
    const d = ctx.getImageData(0, 0, size, size).data;
    let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      n++;
    }
    return n > 0 && sum / n > 200;
  } catch {
    return false;
  }
}

export function ArtworkPreview({ src, alt = "", className = "", tile = 12, draggable }: { src: string; alt?: string; className?: string; tile?: number; draggable?: boolean }) {
  const [light, setLight] = useState(false);
  const onLoad = (e: SyntheticEvent<HTMLImageElement>) => setLight(isLightArtwork(e.currentTarget));
  return (
    <span className={`flex items-center justify-center ${className}`} style={{ backgroundImage: light ? DARK_BOARD : LIGHT_BOARD, backgroundSize: `${tile}px ${tile}px` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} onLoad={onLoad} draggable={draggable} className="max-h-full max-w-full object-contain" />
    </span>
  );
}
