import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// Cross-Origin Isolation headers — required for SharedArrayBuffer (the
// metric ring buffers the worker hands to the main thread without copying).
// `credentialless` avoids forcing the backend to set CORP on its responses.
const coopCoep = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

export default defineConfig({
  plugins: [solid()],
  server: {
    port: 3000,
    strictPort: true,
    host: "0.0.0.0",
    headers: coopCoep,
  },
  preview: {
    port: 3000,
    strictPort: true,
    host: "0.0.0.0",
    headers: coopCoep,
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
  // Worker support: `new Worker(new URL(..., import.meta.url), {type:'module'})`
  // is Vite's first-class pattern — emits a separate hashed chunk.
  worker: {
    format: "es",
  },
});
