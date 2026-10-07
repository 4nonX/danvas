// MP4 encoding in the browser: frames rendered by the editor's engine are
// encoded with WebCodecs (H.264 where available) and muxed by Mediabunny, so a
// video export looks exactly like the editor and present mode, with no server
// renderer involved. Loaded on demand (dynamic import) by the export dialog.

import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, getFirstEncodableVideoCodec } from "mediabunny";

export interface Mp4Options {
  /** Output size in pixels (rounded to even numbers, as video codecs need). */
  width: number;
  height: number;
  fps: number;
  /** Number of frames; `frame(i)` draws frame i (null skips it, holding the
   *  previous picture). */
  count: number;
  frame: (i: number) => HTMLCanvasElement | null;
  onProgress?: (done: number, total: number) => void;
}

/** True when this browser can encode video (WebCodecs). */
export function canEncodeMp4(): boolean {
  return typeof VideoEncoder !== "undefined";
}

export async function encodeMp4(opts: Mp4Options): Promise<Blob> {
  const width = Math.max(2, Math.round(opts.width / 2) * 2);
  const height = Math.max(2, Math.round(opts.height / 2) * 2);
  // H.264 plays everywhere; the others are fallbacks for browsers that cannot
  // encode it (they still play in browsers and VLC).
  const codec = await getFirstEncodableVideoCodec(["avc", "hevc", "vp9", "av1"], { width, height });
  if (!codec) throw new Error("This browser cannot encode video.");

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const source = new CanvasSource(canvas, { codec, quality: QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: opts.fps });
  await output.start();
  const dt = 1 / opts.fps;
  for (let i = 0; i < opts.count; i++) {
    const f = opts.frame(i);
    if (f) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(f, 0, 0, width, height);
    }
    await source.add(i * dt, dt);
    opts.onProgress?.(i + 1, opts.count);
  }
  source.close();
  await output.finalize();
  const buf = (output.target as BufferTarget).buffer;
  if (!buf) throw new Error("video encoding produced no data");
  return new Blob([buf], { type: "video/mp4" });
}
