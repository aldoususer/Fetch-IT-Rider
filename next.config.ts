import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.LOCAL_RIDER_LAB === '1' && process.env.NODE_ENV !== 'production' ? '.next-local-rider-lab' : '.next',
  outputFileTracingIncludes: { '/api/rider/application/demo': ['./assets/rider-demo/portraits/*.png'] },
  // No `output: "standalone"` — Vercel runs `next build` natively.
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
