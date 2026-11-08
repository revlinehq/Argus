import fs from "node:fs/promises";
import path from "node:path";
import type { Capture, Segment } from "./capture.js";
import { config } from "./config.js";
import { worker, type ClipStage, type PendingClip } from "./convex.js";
import { errMsg, logger } from "./log.js";
import { run } from "./proc.js";

const log = logger("clip");
const MAX_CONCURRENT = 2;
const END_SLACK_MS = 4_000;

type Job = { id: string; streamId: string; seconds: number; endAt?: number };

/**
 * Pick the newest segments covering `seconds`. Live HLS input lands in bursts,
 * so file mtimes don't reflect media time — count by nominal segment length
 * instead (Twitch/Kick/YouTube cut on 2s keyframes, matching -segment_time).
 */
export function pickSegments(segs: Segment[], seconds: number, endAt?: number): Segment[] {
  const n = Math.max(1, Math.ceil(seconds / config.segmentSeconds));
  // Clip the moment that was asked for, not "now": keep segments written by
  // endAt plus slack, since live HLS lands in bursts a few seconds late.
  const upTo = endAt ? segs.filter((s) => s.mtime <= endAt + END_SLACK_MS) : segs;
  return upTo.slice(-n);
}

async function upload(file: string, contentType: string): Promise<string> {
  const url = await worker.generateUploadUrl();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: await fs.readFile(file),
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
  const { storageId } = (await res.json()) as { storageId: string };
  return storageId;
}

/** Concat segments into a faststart mp4 + thumbnail. Returns paths and duration. */
export async function buildClip(segs: Segment[], workDir: string) {
  await fs.mkdir(workDir, { recursive: true });
  const list = path.join(workDir, "list.txt");
  const out = path.join(workDir, "out.mp4");
  const thumb = path.join(workDir, "thumb.jpg");
  await fs.writeFile(list, segs.map((s) => `file '${s.file.replace(/'/g, "'\\''")}'`).join("\n"));
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "concat", "-safe", "0", "-i", list,
    "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart",
    out,
  ], 120_000);
  const probe = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out,
  ]);
  const duration = Number(probe.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("clip has no duration");
  let hasThumb = true;
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-ss", (duration / 2).toFixed(2), "-i", out,
    "-frames:v", "1", "-vf", "scale=480:-2", thumb,
  ]).catch((e) => {
    hasThumb = false;
    log.warn(`thumbnail failed: ${errMsg(e)}`);
  });
  return { out, thumb: hasThumb ? thumb : null, duration };
}

/** Builds + uploads clips, at most MAX_CONCURRENT at a time. */
export class Clipper {
  private queue: Job[] = [];
  private active = 0;
  private known = new Set<string>(); // ids already claimed/queued by us

  constructor(private getCapture: (streamId: string) => Capture | undefined) {}

  /** Handle the pendingClips subscription: claim each new one, then queue it. */
  async onPending(clips: PendingClip[]) {
    for (const c of clips) {
      if (this.known.has(c._id)) continue;
      this.known.add(c._id);
      try {
        if (!(await worker.claimClip(c._id))) {
          this.known.delete(c._id);
          continue;
        }
      } catch (e) {
        log.error(`claim ${c._id}: ${errMsg(e)}`);
        this.known.delete(c._id);
        continue;
      }
      this.enqueue({ id: c._id, streamId: c.streamId, seconds: c.seconds, endAt: c.endAt });
    }
  }

  /** Queue an already-processing clip (e.g. from autoClip). */
  enqueue(job: Job) {
    this.known.add(job.id);
    this.queue.push(job);
    this.pump();
  }

  private pump() {
    while (this.active < MAX_CONCURRENT && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.active++;
      void this.process(job).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async process(job: Job) {
    const workDir = path.join(config.dataDir, "tmp", job.id);
    const started = Date.now();
    try {
      const capture = this.getCapture(job.streamId);
      if (!capture) throw new Error("Stream is not being recorded by the worker");
      const segs = pickSegments(await capture.segments(), job.seconds, job.endAt);
      if (segs.length === 0) throw new Error("No buffered video for that moment");
      const stage = (s: ClipStage) => worker.setClipStage(job.id, s).catch(() => {});
      await stage("building");
      const { out, thumb, duration } = await buildClip(segs, workDir);
      await stage("uploading");
      const videoId = await upload(out, "video/mp4");
      const thumbId = thumb ? await upload(thumb, "image/jpeg") : undefined;
      await worker.completeClip(job.id, videoId, thumbId, Math.round(duration * 10) / 10);
      log.info(`${job.id} ready (${duration.toFixed(1)}s, ${segs.length} segs, ${Date.now() - started}ms)`);
    } catch (e) {
      log.warn(`${job.id} failed: ${errMsg(e)}`);
      await worker.failClip(job.id, errMsg(e)).catch((e2) => log.error(`failClip: ${errMsg(e2)}`));
    } finally {
      this.known.delete(job.id);
      await fs.rm(workDir, { recursive: true, force: true });
    }
  }
}
