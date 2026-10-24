import type { NextConfig } from "next";

// LIVE-BUILD GUARD (CSA 2026-10-22): `next build` in the live directory overwrites production without a backup
// (happened 2026-10-22 00:19Z). Build in .stage-<name> and release with claude-ops mc-release.
const LIVE_DIRS = ["/workspace/projects/mission-control", "/opt/shared/agentic-sandbox/workspace/projects/mission-control"];
if (process.argv.includes("build") && LIVE_DIRS.includes(process.cwd()) && process.env.MC_ALLOW_LIVE_BUILD !== "1") {
  throw new Error("REFUSED: next build in the LIVE Mission Control directory overwrites production. Build in .stage-<name> and use mc-release.");
}

const nextConfig: NextConfig = {
  // Environment state is NEVER part of a deployable server trace.
  // Both rooms run this identical config while owning distinct runtime
  // data, secret and preview directories. These files stay on their own
  // disks; native agents read them only at execution time.
  outputFileTracingExcludes: {
    "/*": [
      "./data/**/*",
      "./.preview-acf-home/**/*",
      "./.preview-native-home/**/*",
      "./.preview-ops/**/*",
      "./.preview-omi/**/*",
      "./.werkplaats-release-source/**/*",
      "./theme/**/*",
    ],
  },
  // This repository intentionally lives inside a protected parent checkout.
  // Pin Turbopack here so the parent's lockfile cannot widen tracing into the
  // legacy tree or produce misleading attachment-store trace warnings.
  turbopack: {
    root: process.cwd(),
  },
  // The server-side browser (container mc-browser, see agentic-collaboration-fabric/hostops/mc_browser)
  // is served under /browser/ through Mission Control, websockets included, so it rides the same tunnel.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: "/browser", destination: "http://mc-browser:3000/browser/" },
      { source: "/browser/:path*", destination: "http://mc-browser:3000/browser/:path*" },
    ];
  },
};

export default nextConfig;
