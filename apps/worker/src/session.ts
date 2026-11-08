import { BrowserView } from "./browser.js";
import { Capture, type CaptureStatus } from "./capture.js";
import { ChatMonitor } from "./chat.js";
import type { Clipper } from "./clipper.js";
import { worker, type ActiveStream, type StreamPatch } from "./convex.js";
import { errMsg, logger, type Logger } from "./log.js";
import { broadcastFrame, dropStream } from "./viewers.js";

const MIN_REPORT_MS = 5_000;
const SPIKE_DELAY_MS = 10_000;
const AUTO_CLIP_SECONDS = 30;

/** Everything the worker runs for one enabled stream. */
export class StreamSession {
  readonly id: string;
  readonly capture: Capture;
  status: CaptureStatus = "starting";
  private view: BrowserView;
  private chat: ChatMonitor | null = null;
  private pending: StreamPatch = {};
  private lastReport = 0;
  private flushTimer: NodeJS.Timeout | null = null;
  private spikeTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private log: Logger;

  constructor(
    public stream: ActiveStream,
    private clipper: Clipper,
  ) {
    this.id = stream._id;
    this.log = logger(`session:${stream.channel}`);
    this.view = new BrowserView({
      streamId: this.id,
      url: stream.url,
      onFrame: (jpeg) => {
        if (!this.stopped) broadcastFrame(this.id, jpeg);
      },
      onTitle: (title) => this.report({ title }),
    });
    this.capture = new Capture({
      streamId: this.id,
      url: stream.url,
      onStatus: (status, error) => {
        this.status = status;
        this.report({ status, error: status === "live" ? null : (error ?? null) }, true);
      },
      onBuffered: (bufferedSeconds) => this.report({ bufferedSeconds }),
    });
    if (stream.platform === "twitch") {
      this.chat = new ChatMonitor({
        streamId: this.id,
        channel: stream.channel,
        onRate: (chatRate) => this.report({ chatRate }),
        onSpike: (rate) => this.onSpike(rate),
      });
    }
  }

  async start() {
    this.log.info(`starting ${this.stream.url}`);
    this.report({ status: "starting", error: null }, true);
    await this.capture.start();
    this.view.start();
    this.chat?.start();
  }

  /** Coalesce patches: status transitions go out now, the rest at most every 5s. */
  private report(patch: StreamPatch, immediate = false) {
    if (this.stopped) return;
    Object.assign(this.pending, patch);
    if (immediate || Date.now() - this.lastReport >= MIN_REPORT_MS) return this.flush();
    this.flushTimer ??= setTimeout(() => this.flush(), this.lastReport + MIN_REPORT_MS - Date.now());
  }

  private flush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.stopped || Object.keys(this.pending).length === 0) return;
    const patch = this.pending;
    this.pending = {};
    this.lastReport = Date.now();
    if (patch.error) patch.error = patch.error.slice(0, 500);
    worker.updateStream(this.id, patch).catch((e) => this.log.warn(`updateStream: ${errMsg(e)}`));
  }

  private onSpike(rate: number) {
    if (!this.stream.autoClip || this.spikeTimer) return;
    // wait so the clip includes the reaction, not just the build-up
    this.spikeTimer = setTimeout(async () => {
      this.spikeTimer = null;
      if (this.stopped || !this.stream.autoClip || this.status !== "live") return;
      try {
        const id = await worker.autoClip(this.id, AUTO_CLIP_SECONDS, `chat spike: ${rate} msg/min`);
        if (id) {
          this.log.info(`auto clip ${id} (${rate} msg/min)`);
          this.clipper.enqueue({ id, streamId: this.id, seconds: AUTO_CLIP_SECONDS });
        }
      } catch (e) {
        this.log.warn(`autoClip: ${errMsg(e)}`);
      }
    }, SPIKE_DELAY_MS);
  }

  async stop() {
    this.log.info("stopping");
    this.stopped = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.spikeTimer) clearTimeout(this.spikeTimer);
    dropStream(this.id);
    await Promise.allSettled([this.capture.stop(), this.view.stop(), this.chat?.stop()]);
  }
}
