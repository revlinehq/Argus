import { createHmac, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { config } from "./config.js";
import { logger } from "./log.js";

const log = logger("ws");
const MAX_BUFFERED = 1024 * 1024; // drop frames for clients this far behind

const clients = new Map<string, Set<WebSocket>>();
const latest = new Map<string, Buffer>();

/** Notified whenever a stream's viewer count changes (drives browser wake/sleep). */
let onViewers: (streamId: string, count: number) => void = () => {};
export function setViewerListener(fn: typeof onViewers) {
  onViewers = fn;
}

/** Browser went to sleep: forget its last frame so nobody sees a stale one. */
export function clearFrame(streamId: string) {
  latest.delete(streamId);
}

/** Push a JPEG frame to every viewer of a stream (and remember it for new viewers). */
export function broadcastFrame(streamId: string, jpeg: Buffer) {
  latest.set(streamId, jpeg);
  for (const ws of clients.get(streamId) ?? []) {
    if (ws.readyState === ws.OPEN && ws.bufferedAmount < MAX_BUFFERED) ws.send(jpeg);
  }
}

export function viewerCount(streamId: string) {
  return clients.get(streamId)?.size ?? 0;
}

/** Stream stopped: forget its frame and disconnect its viewers. */
export function dropStream(streamId: string) {
  latest.delete(streamId);
  for (const ws of clients.get(streamId) ?? []) ws.close(1001, "stream stopped");
  clients.delete(streamId);
}

/** Token format (see convex/streams.ts viewerToken): `${exp}.${hex hmac(streamId.exp)}`. */
export function verifyToken(streamId: string, token: string | null): boolean {
  if (!token) return false;
  const [expStr, hex] = token.split(".");
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= Date.now() || !hex || !/^[0-9a-f]{64}$/.test(hex)) return false;
  const expected = createHmac("sha256", config.secret).update(`${streamId}.${expStr}`).digest();
  return timingSafeEqual(expected, Buffer.from(hex, "hex"));
}

export type StreamInfo = { id: string; status: string; browser: boolean };

export function startViewerServer(getStreams: () => StreamInfo[]) {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url?.split("?")[0] === "/health") {
      const streams = getStreams().map((s) => ({ ...s, viewers: viewerCount(s.id) }));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ streams }));
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://x");
    const m = url.pathname.match(/^\/view\/([a-z0-9]+)$/i);
    if (!m) return socket.destroy();
    const streamId = m[1];
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!verifyToken(streamId, url.searchParams.get("t"))) return ws.close(4401, "unauthorized");
      let set = clients.get(streamId);
      if (!set) clients.set(streamId, (set = new Set()));
      set.add(ws);
      const frame = latest.get(streamId);
      if (frame) ws.send(frame);
      else ws.send(JSON.stringify({ state: "waking" })); // browser is booting
      onViewers(streamId, set.size);
      ws.on("close", () => {
        set.delete(ws);
        // Ask the map, not `set`: dropStream may have replaced it meanwhile.
        onViewers(streamId, viewerCount(streamId));
      });
      ws.on("error", () => ws.terminate());
    });
  });

  server.listen(config.port, () => log.info(`listening on :${config.port}`));

  return {
    close: () =>
      new Promise<void>((resolve) => {
        for (const ws of wss.clients) ws.terminate();
        wss.close();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
