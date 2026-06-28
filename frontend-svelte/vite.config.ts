import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "path";

// Cross-Origin Isolation headers — required for SharedArrayBuffer (the
// metric ring buffers the worker hands to the main thread without copying).
// `credentialless` avoids forcing the backend to set CORP on its responses.
const coopCoep = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "../shared"),
    },
  },
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
