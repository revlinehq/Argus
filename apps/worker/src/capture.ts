import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { errMsg, logger, type Logger } from "./log.js";
import { lastLine, run } from "./proc.js";

export type CaptureStatus = "starting" | "live" | "offline" | "error";

type Opts = {
  streamId: string;
  url: string;
  onStatus: (status: CaptureStatus, error?: string) => void;
  onBuffered: (seconds: number) => void;
};

const SEG_RE = /^seg_(\d{6})\.ts$/;
const OFFLINE_RETRY_MS = 60_000;
const STALL_MS = 30_000;

export type Segment = { file: string; mtime: number };

/**
 * Rolling HLS capture: yt-dlp resolves the stream URL, ffmpeg copies it into
 * 2s .ts segments, a janitor trims anything older than BUFFER_SECONDS.
 */
export class Capture {
  readonly dir: string;
  private proc: ChildProcess | null = null;
  private stopped = false;
  private status: CaptureStatus = "starting";
  private backoffMs = 2000;
  private retryTimer: NodeJS.Timeout | null = null;
  private tick: NodeJS.Timeout | null = null;
  private lastSegCount = 0;
  private lastNewSegAt = 0;
  private log: Logger;

  constructor(private opts: Opts) {
    this.dir = path.join(config.dataDir, opts.streamId);
    this.log = logger(`cap:${opts.streamId.slice(-6)}`);
  }

  async start() {
    // stale segments from a previous run would break the timeline
    await fs.rm(this.dir, { recursive: true, force: true });
    await fs.mkdir(this.dir, { recursive: true });
    this.tick = setInterval(() => void this.housekeep(), 2000);
    void this.launch();
  }

  get isRecording() {
    return this.proc !== null;
  }

  private setStatus(s: CaptureStatus, error?: string) {
    if (s === this.status && s !== "error") return;
    this.status = s;
    this.opts.onStatus(s, error);
  }

  private async launch() {
    if (this.stopped) return;
    let hls: string;
    try {
      const out = await run("yt-dlp", ["-g", "-f", "best", "--no-warnings", this.opts.url], 60_000);
      hls = out.trim().split("\n")[0];
      if (!hls) throw new Error("yt-dlp returned no URL");
    } catch (e) {
      const msg = errMsg(e);
      this.log.info(`not live (${lastLine(msg).slice(0, 120)}); retry in 60s`);
      this.setStatus("offline", msg);
      return this.schedule(OFFLINE_RETRY_MS);
    }
    if (this.stopped) return;

    await fs.mkdir(this.dir, { recursive: true });
    const startNumber = (await this.lastIndex()) + 1;
    const args = [
      "-hide_banner", "-loglevel", "error", "-nostdin",
      "-rw_timeout", "15000000",
      "-i", hls,
      "-map", "0:v:0?", "-map", "0:a:0?",
      "-c", "copy",
      "-f", "segment",
      "-segment_time", String(config.segmentSeconds),
      "-segment_start_number", String(startNumber),
      "-reset_timestamps", "1",
      path.join(this.dir, "seg_%06d.ts"),
    ];
    this.log.info(`ffmpeg starting (seg #${startNumber})`);
    const startedAt = Date.now();
    this.lastNewSegAt = startedAt;
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    this.proc = proc;
    let stderr = "";
    proc.stderr!.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
    proc.on("error", (e) => this.log.error(`ffmpeg spawn: ${e.message}`));
    proc.on("close", (code, signal) => {
      this.proc = null;
      if (this.stopped) return;
      const ranLong = Date.now() - startedAt > 60_000;
      this.backoffMs = ranLong ? 2000 : Math.min(this.backoffMs * 2, 60_000);
      const why = lastLine(stderr) || `exit ${signal ?? code}`;
      this.log.warn(`ffmpeg exited (${why}); re-resolving in ${this.backoffMs / 1000}s`);
      // Not live until fresh segments arrive again (broadcast may have ended).
      if (ranLong) this.setStatus("starting");
      else this.setStatus("error", `capture stopped: ${why}`);
      this.schedule(this.backoffMs);
    });
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.launch();
    }, ms);
  }

  private async lastIndex(): Promise<number> {
    const files = await this.listFiles();
    const last = files[files.length - 1];
    return last ? Number(last.match(SEG_RE)![1]) : -1;
  }

  private async listFiles(): Promise<string[]> {
    const names = await fs.readdir(this.dir).catch(() => [] as string[]);
    return names.filter((n) => SEG_RE.test(n)).sort();
  }

  /** Completed segments, oldest first (excludes the one ffmpeg is still writing). */
  async segments(): Promise<Segment[]> {
    const files = await this.listFiles();
    if (this.proc) files.pop();
    const segs = await Promise.all(
      files.map(async (f) => {
        const file = path.join(this.dir, f);
        const st = await fs.stat(file).catch(() => null);
        return st ? { file, mtime: st.mtimeMs } : null;
      }),
    );
    return segs.filter((s): s is Segment => s !== null && s.mtime > 0);
  }

  /** Janitor + liveness: trim old segments, flip to live, detect stalls, report buffer. */
  private async housekeep() {
    if (this.stopped) return;
    const segs = await this.segments();
    const cutoff = Date.now() - config.bufferSeconds * 1000;
    const keep: Segment[] = [];
    for (const s of segs) {
      if (s.mtime < cutoff) await fs.rm(s.file, { force: true });
      else keep.push(s);
    }
    const count = (await this.listFiles()).length;
    if (count !== this.lastSegCount) {
      this.lastSegCount = count;
      this.lastNewSegAt = Date.now();
      if (this.proc && keep.length > 0) this.setStatus("live");
    } else if (this.proc && Date.now() - this.lastNewSegAt > STALL_MS) {
      this.log.warn("no new segments for 30s; restarting ffmpeg");
      this.lastNewSegAt = Date.now();
      this.proc.kill("SIGKILL");
    }
    if (keep.length > 0) {
      const span = (keep[keep.length - 1].mtime - keep[0].mtime) / 1000 + config.segmentSeconds;
      this.opts.onBuffered(Math.round(Math.min(span, config.bufferSeconds)));
    }
  }

  async stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.tick) clearInterval(this.tick);
    const p = this.proc;
    if (p) {
      const exited = new Promise<void>((r) => p.once("close", () => r()));
      p.kill("SIGTERM");
      const t = setTimeout(() => p.kill("SIGKILL"), 3000);
      await exited;
      clearTimeout(t);
    }
    // Don't rm the dir here: a restarted session for the same stream may
    // already own it (start() wipes it). Leftover segments are cleared there.
  }
}
