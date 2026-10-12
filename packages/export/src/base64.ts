// Bytes to base64 (for data: URL assets of imported designs).
//
// The browser path builds a binary string and hands it to btoa. A host may
// provide a native encoder as globalThis.__hostBytesToBase64: the server-side
// import runs these importers under goja (backend/internal/pptxconv), where
// building a multi-megabyte binary string one character at a time in the
// interpreter dominated the conversion of image-heavy decks. The result is
// the same either way.

type HostEncoder = (data: Uint8Array) => string;

export function bytesToBase64(data: Uint8Array): string {
  const host = (globalThis as { __hostBytesToBase64?: HostEncoder }).__hostBytesToBase64;
  if (host) return host(data);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < data.length; i += CHUNK) {
    bin += String.fromCharCode(...data.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** A data: URL for bytes of the given MIME type. */
export function bytesToDataUrl(data: Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(data)}`;
}
