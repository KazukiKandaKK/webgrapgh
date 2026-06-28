import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // avoid double-mount of imperative uPlot instances in dev
  output: "standalone",
  // Allow importing from the shared/ directory outside this package root.
  transpilePackages: [],
  webpack(config) {
    config.resolve.alias["@shared"] = resolve(__dirname, "../shared");
    return config;
  },
  // Enable cross-origin isolation so SharedArrayBuffer is available. We use
  // `credentialless` for COEP so cross-origin fetches (the Go backend on
  // :8080) work without requiring CORP headers on the upstream — credentials
  // (cookies) are simply omitted on those requests, which is fine here.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};

export default nextConfig;
