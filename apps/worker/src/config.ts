import path from "node:path";
import { fileURLToPath } from "node:url";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const port = Number(process.env.WORKER_PORT ?? 8788);

export const config = {
  convexUrl: required("CONVEX_URL"),
  secret: required("WORKER_SECRET"),
  port,
  publicWsUrl: process.env.PUBLIC_WS_URL ?? `ws://localhost:${port}`,
  bufferSeconds: Number(process.env.BUFFER_SECONDS ?? 300),
  dataDir: path.resolve(
    process.env.DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data"),
  ),
  segmentSeconds: 2,
};
