import tmi from "tmi.js";
import { logger, type Logger } from "./log.js";

const BUCKET_MS = 5_000;
const WINDOW_BUCKETS = 12; // 60s for chatRate
const WARMUP_MS = 120_000;
const COOLDOWN_MS = 90_000;
const RATE_FLOOR = 20; // msgs/min
const SPIKE_FACTOR = 3;
const EMA_ALPHA = BUCKET_MS / 120_000; // ~2 min time constant

type Opts = {
  streamId: string;
  channel: string;
  onRate: (msgsPerMin: number) => void;
  onSpike: (msgsPerMin: number) => void;
};

/** Anonymous Twitch chat reader that detects message-rate spikes. */
export class ChatMonitor {
  private client: tmi.Client;
  private buckets: number[] = [];
  private current = 0;
  private baseline: number | null = null;
  private startedAt = Date.now();
  private lastSpike = 0;
  private timer: NodeJS.Timeout | null = null;
  private log: Logger;

  constructor(private opts: Opts) {
    this.log = logger(`chat:${opts.channel}`);
    this.client = new tmi.Client({
      connection: { secure: true, reconnect: true },
      channels: [opts.channel],
      logger: { info: () => {}, warn: () => {}, error: (m: string) => this.log.warn(m) },
    });
    this.client.on("message", () => void this.current++);
  }

  start() {
    this.client.connect().then(
      () => this.log.info("joined"),
      (e) => this.log.warn(`connect failed: ${e}`),
    );
    this.startedAt = Date.now();
    this.timer = setInterval(() => this.roll(), BUCKET_MS);
  }

  private roll() {
    this.buckets.push(this.current);
    this.current = 0;
    if (this.buckets.length > WINDOW_BUCKETS) this.buckets.shift();

    const n = this.buckets.length;
    const perMin = (this.buckets.reduce((a, b) => a + b, 0) * 60_000) / (n * BUCKET_MS);
    const rate10 = n >= 2 ? ((this.buckets[n - 1] + this.buckets[n - 2]) * 60_000) / (2 * BUCKET_MS) : 0;
    this.opts.onRate(Math.round(perMin));

    const now = Date.now();
    const threshold = Math.max(SPIKE_FACTOR * (this.baseline ?? 0), RATE_FLOOR);
    if (
      this.baseline !== null &&
      now - this.startedAt >= WARMUP_MS &&
      now - this.lastSpike >= COOLDOWN_MS &&
      rate10 > threshold
    ) {
      this.lastSpike = now;
      this.log.info(`spike: ${Math.round(rate10)} msg/min (baseline ${this.baseline.toFixed(1)})`);
      this.opts.onSpike(Math.round(rate10));
    }
    // EMA on the per-bucket rate; spikes still leak in, which is fine (slow drift)
    const bucketRate = (this.buckets[n - 1] * 60_000) / BUCKET_MS;
    this.baseline = this.baseline === null ? bucketRate : this.baseline + EMA_ALPHA * (bucketRate - this.baseline);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    await this.client.disconnect().catch(() => {});
  }
}
