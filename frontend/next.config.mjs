/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // avoid double-mount of imperative uPlot instances in dev
  output: "standalone",
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
