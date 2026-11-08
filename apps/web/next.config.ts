import path from "node:path";
import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  // npm workspaces: trace files from the repo root (also picks up ../../convex).
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // Let other machines (e.g. over Tailscale) load dev assets / HMR.
  allowedDevOrigins: ["100.112.192.49", "sonic-gamingpc", "*.ts.net"],
};

export default nextConfig;

initOpenNextCloudflareForDev();
