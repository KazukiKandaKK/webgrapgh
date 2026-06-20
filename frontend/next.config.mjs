/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // avoid double-mount of imperative uPlot instances in dev
  // `standalone` emits a minimal self-contained server under `.next/standalone`
  // that we COPY into the runtime image. Slashes node_modules dramatically.
  output: "standalone",
};

export default nextConfig;
