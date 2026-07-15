import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This repository intentionally lives inside a protected parent checkout.
  // Pin Turbopack here so the parent's lockfile cannot widen tracing into the
  // legacy tree or produce misleading attachment-store trace warnings.
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
