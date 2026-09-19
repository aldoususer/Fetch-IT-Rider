import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No `output: "standalone"` — Vercel runs `next build` natively.
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
