lcms-wasm 1.0.5 (https://github.com/mattdesl/lcms-wasm), MIT (LICENSE.md):
Little CMS (https://github.com/mm2/Little-CMS, MIT) compiled to WebAssembly.
Copied unaltered from node_modules/lcms-wasm/dist. It is loaded at runtime
by src/lib/print/cms.ts instead of being bundled: its Emscripten output has
Node-only branches (import("module"), new URL("./", import.meta.url)) that
the bundler cannot resolve for the browser. To update, bump the dependency
and copy dist/lcms.js and dist/lcms.wasm here again.
