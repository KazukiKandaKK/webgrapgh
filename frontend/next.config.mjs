/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // avoid double-mount of imperative uPlot instances in dev
  experimental: {
    // Web Workers (`new Worker(new URL(...), import.meta.url)`) work out of the
    // box with Webpack. No special config required.
  },
};

export default nextConfig;
