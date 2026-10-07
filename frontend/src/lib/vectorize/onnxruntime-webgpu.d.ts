// Minimal typings for the parts of onnxruntime-web's WebGPU build that
// enhance.ts uses (the package's own types are not reachable through its
// "exports" under bundler module resolution).
declare module "onnxruntime-web/webgpu" {
  export const env: { logLevel?: "verbose" | "info" | "warning" | "error" | "fatal"; wasm: { numThreads?: number } };
  export class Tensor {
    constructor(type: "float32", data: Float32Array, dims: readonly number[]);
    readonly data: unknown;
  }
  export interface InferenceSession {
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
  }
  export const InferenceSession: {
    create(model: Uint8Array, options?: { executionProviders?: string[]; logSeverityLevel?: 0 | 1 | 2 | 3 | 4 }): Promise<InferenceSession>;
  };
}
