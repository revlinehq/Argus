import path from "node:path";
import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  // npm workspaces: trace files from the repo root (also picks up ../../convex).
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // Let other machines (e.g. over Tailscale) load dev assets / HMR.
  // Comma-separated hosts, e.g. ALLOWED_DEV_ORIGINS=100.64.0.1,my-pc,*.ts.net
  allowedDevOrigins: process.env.ALLOWED_DEV_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean),
};

export default nextConfig;

initOpenNextCloudflareForDev();
