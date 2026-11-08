import { BrowserView } from "./browser.js";
import { Capture, type CaptureStatus } from "./capture.js";
import { ChatMonitor } from "./chat.js";
import type { Clipper } from "./clipper.js";
import { worker, type ActiveStream, type StreamPatch } from "./convex.js";
import { errMsg, logger, type Logger } from "./log.js";
import { broadcastFrame, clearFrame, dropStream } from "./viewers.js";

const MIN_REPORT_MS = 5_000;
const SPIKE_DELAY_MS = 10_000;
const AUTO_CLIP_SECONDS = 30;
/** Keep the browser around this long after the last viewer leaves (tab flips, reloads). */
const SLEEP_AFTER_MS = 30_000;

/** Everything the worker runs for one enabled stream. */
export class StreamSession {
  readonly id: string;
  readonly capture: Capture;
  status: CaptureStatus = "starting";
  /** Only exists while someone is watching the tile; capture/chat run regardless. */
  private view: BrowserView | null = null;
  private sleepTimer: NodeJS.Timeout | null = null;
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
    this.capture = new Capture({
      streamId: this.id,
      url: stream.url,
      onStatus: (status, error) => {
        this.status = status;
        this.report({ status, error: status === "live" ? null : (error ?? null) }, true);
      },
      onBuffered: (bufferedSeconds) => this.report({ bufferedSeconds }),
      onTitle: (title) => this.report({ title }),
      titleFromDescription: stream.platform === "twitch",
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
    this.chat?.start();
  }

  get browserAwake() {
    return this.view !== null;
  }

  /** Wake the browser for the first viewer; sleep it a while after the last leaves. */
  setViewers(count: number) {
    if (this.stopped) return;
    if (count > 0) {
      if (this.sleepTimer) clearTimeout(this.sleepTimer);
      this.sleepTimer = null;
      if (!this.view) {
        this.log.info("viewer connected; waking browser");
        const view: BrowserView = new BrowserView({
          streamId: this.id,
          url: this.stream.url,
          // Drop frames from a view that's been put to sleep (still closing).
          onFrame: (jpeg) => {
            if (!this.stopped && this.view === view) broadcastFrame(this.id, jpeg);
          },
        });
        this.view = view;
        view.start();
      }
    } else if (this.view && !this.sleepTimer) {
      this.sleepTimer = setTimeout(() => {
        this.sleepTimer = null;
        const view = this.view;
        this.view = null;
        clearFrame(this.id);
        this.log.info("no viewers; browser sleeping");
        void view?.stop();
      }, SLEEP_AFTER_MS);
    }
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
        const endAt = Date.now();
        const id = await worker.autoClip(this.id, AUTO_CLIP_SECONDS, `chat spike: ${rate} msg/min`, endAt);
        if (id) {
          this.log.info(`auto clip ${id} (${rate} msg/min)`);
          this.clipper.enqueue({ id, streamId: this.id, seconds: AUTO_CLIP_SECONDS, endAt });
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
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    dropStream(this.id);
    await Promise.allSettled([this.capture.stop(), this.view?.stop(), this.chat?.stop()]);
  }
}
