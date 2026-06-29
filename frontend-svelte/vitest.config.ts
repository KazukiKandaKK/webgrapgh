import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "path";
import { defineConfig } from "vitest/config";

// Reuses the @shared alias and the Svelte plugin (so `.svelte.ts` rune modules
// like alerts compile) and runs under jsdom for localStorage-backed stores.
export default defineConfig({
  plugins: [svelte({ hot: false })],
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "../shared"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
