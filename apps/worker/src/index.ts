import { config } from "./config.js";
import { Clipper } from "./clipper.js";
import { convex, worker, type ActiveStream } from "./convex.js";
import { closeBrowser } from "./browser.js";
import { errMsg, logger } from "./log.js";
import { StreamSession } from "./session.js";
import { setViewerListener, startViewerServer, viewerCount } from "./viewers.js";

const log = logger("worker");
const sessions = new Map<string, StreamSession>();
const clipper = new Clipper((id) => sessions.get(id)?.capture);

const server = startViewerServer(() =>
  [...sessions.values()].map((s) => ({ id: s.id, status: s.status, browser: s.browserAwake })),
);
setViewerListener((id, count) => sessions.get(id)?.setViewers(count));

/** Make running sessions match the enabled streams in Convex. */
function reconcile(streams: ActiveStream[]) {
  const wanted = new Map(streams.map((s) => [s._id, s]));
  for (const [id, session] of sessions) {
    const next = wanted.get(id);
    if (!next || next.url !== session.stream.url) {
      sessions.delete(id);
      void session.stop();
    } else {
      session.stream = next; // picks up autoClip toggles
    }
  }
  for (const s of streams) {
    if (sessions.has(s._id)) continue;
    const session = new StreamSession(s, clipper);
    sessions.set(s._id, session);
    session.start().catch((e) => log.error(`start ${s.channel}: ${errMsg(e)}`));
    session.setViewers(viewerCount(s._id));
  }
  log.info(`${sessions.size} active stream(s)`);
}

// Clips left "processing" by a previous run will never finish; fail them first.
await worker
  .failOrphanedClips()
  .then((n) => n && log.warn(`marked ${n} orphaned clip(s) failed`))
  .catch((e) => log.warn(`failOrphanedClips: ${errMsg(e)}`));

const unsubStreams = worker.onActiveStreams(reconcile, (e) => log.error(`activeStreams: ${e.message}`));
const unsubClips = worker.onPendingClips(
  (clips) => void clipper.onPending(clips),
  (e) => log.error(`pendingClips: ${e.message}`),
);

const beat = () => worker.heartbeat().catch((e) => log.warn(`heartbeat: ${errMsg(e)}`));
void beat();
const heartbeatTimer = setInterval(beat, 15_000);

log.info(`started (data=${config.dataDir}, buffer=${config.bufferSeconds}s, ws=${config.publicWsUrl})`);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal}: shutting down`);
  const force = setTimeout(() => process.exit(1), 10_000);
  clearInterval(heartbeatTimer);
  unsubStreams();
  unsubClips();
  await Promise.allSettled([...sessions.values()].map((s) => s.stop()));
  sessions.clear();
  await Promise.allSettled([closeBrowser(), server.close(), convex.close()]);
  clearTimeout(force);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
