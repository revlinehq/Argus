import path from "node:path";
import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  // npm workspaces: trace files from the repo root (also picks up ../../convex).
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;

initOpenNextCloudflareForDev();
