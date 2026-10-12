// Host shims for running the @hc/export importers under goja (the Go-embedded
// JS engine; backend/internal/pptxconv). MUST be the entry's first import so it
// evaluates before any library module's top-level code touches these globals.
//
// Each shim only fills a gap: under Node (the parity fixture) the native APIs
// run, exactly as in the browser. Under goja the heavy work is done in Go by
// functions the runner injects before the bundle runs:
//   __goInflateRaw(ArrayBuffer) -> ArrayBuffer   raw-deflate, capped in Go
//   __goUtf8(Uint8Array) -> string               UTF-8 decode
//   __goUUID() -> string                         RFC 4122 v4 id
//   __goRandomFill(TypedArray)                   cryptographic random bytes
// and __hostBytesToBase64 (read by @hc/export's bytesToBase64) encodes image
// bytes natively instead of building binary strings in the interpreter.

if (typeof globalThis.TextDecoder === "undefined") {
  globalThis.TextDecoder = class TextDecoder {
    decode(u8) {
      return __goUtf8(u8 ? u8 : new Uint8Array(0));
    }
  };
}

if (typeof globalThis.crypto === "undefined") {
  // getRandomValues too: a dependency of @hc/schema (lib0) binds it when it
  // loads, even though the importers never call it.
  globalThis.crypto = {
    randomUUID: () => __goUUID(),
    getRandomValues: (arr) => {
      __goRandomFill(arr);
      return arr;
    },
  };
}

if (typeof globalThis.btoa === "undefined") {
  // Only reached if __hostBytesToBase64 is missing; @hc/export prefers that.
  globalThis.btoa = () => {
    throw new Error("btoa is not available in this host");
  };
}

if (typeof globalThis.DecompressionStream === "undefined") {
  // Just enough of `new Response(buf).body.pipeThrough(new
  // DecompressionStream("deflate-raw")).getReader()` for @hc/export's unzip:
  // one chunk holding the whole inflated entry, then done. The decompression
  // limits are enforced in Go (per entry and per archive), before the bytes
  // ever reach the VM.
  globalThis.DecompressionStream = class DecompressionStream {
    constructor(format) {
      this.format = format;
    }
  };
  globalThis.Response = class Response {
    constructor(buf) {
      this.body = {
        pipeThrough: (ds) => ({
          getReader: () => {
            let given = false;
            return {
              read: () => {
                if (given) return Promise.resolve({ done: true, value: undefined });
                given = true;
                if (ds.format !== "deflate-raw") return Promise.reject(new Error(`unsupported compression ${ds.format}`));
                try {
                  return Promise.resolve({ done: false, value: new Uint8Array(__goInflateRaw(buf)) });
                } catch (e) {
                  return Promise.reject(e);
                }
              },
              cancel: () => Promise.resolve(),
            };
          },
        }),
      };
    }
  };
}
