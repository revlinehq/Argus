import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright";
import { errMsg, logger, type Logger } from "./log.js";

const log = logger("browser");
let browserPromise: Promise<Browser> | null = null;
let closing = false;

const IDLE_CLOSE_MS = 15_000;
let openViews = 0;
let idleTimer: NodeJS.Timeout | null = null;

/** One shared headless Chromium for all awake views, relaunched if it dies. */
function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const promise: Promise<Browser> = chromium
      .launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] })
      .then((b) => {
        log.info("chromium launched");
        b.on("disconnected", () => {
          // Ignore if we closed it on purpose (idle) and already moved on.
          if (browserPromise !== promise) return;
          if (!closing) log.warn("chromium disconnected");
          browserPromise = null;
        });
        return b;
      })
      .catch((e) => {
        if (browserPromise === promise) browserPromise = null;
        throw e;
      });
    browserPromise = promise;
  }
  return browserPromise;
}

/** Views hold a reference; when none are awake, Chromium itself shuts down. */
function acquireBrowser() {
  openViews++;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

function releaseBrowser() {
  openViews = Math.max(0, openViews - 1);
  if (openViews > 0 || idleTimer) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (openViews > 0 || !browserPromise) return;
    const p = browserPromise;
    browserPromise = null;
    log.info("no awake views; closing chromium");
    void p.then((b) => b.close()).catch(() => {});
  }, IDLE_CLOSE_MS);
}

export async function closeBrowser() {
  closing = true;
  const p = browserPromise;
  browserPromise = null;
  if (p) await (await p.catch(() => null))?.close().catch(() => {});
}

// Twitch mature-content gate, cookie banners, generic "continue" prompts.
const GATE_SELECTORS = [
  '[data-a-target="content-classification-gate-overlay-start-watching-button"]',
  '[data-a-target="player-overlay-mature-accept"]',
  '[data-a-target="consent-banner-accept"]',
];
const GATE_TEXT = /^(start watching|accept|accept all|i accept|i understand|agree|continue watching)$/i;

type Opts = {
  streamId: string;
  url: string;
  onFrame: (jpeg: Buffer) => void;
};

/**
 * Headless page for one stream, screencast via CDP. Purely a showcase:
 * failures are logged and retried, never fatal.
 */
export class BrowserView {
  private ctx: BrowserContext | null = null;
  private stopped = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private log: Logger;

  constructor(private opts: Opts) {
    this.log = logger(`view:${opts.streamId.slice(-6)}`);
  }

  private holding = false;

  start() {
    acquireBrowser();
    this.holding = true;
    void this.open();
  }

  private async open() {
    if (this.stopped) return;
    try {
      const browser = await getBrowser();
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      if (this.stopped) {
        await ctx.close().catch(() => {});
        return;
      }
      this.ctx = ctx;
      const page = await ctx.newPage();
      page.on("crash", () => this.restart("page crashed"));
      page.on("close", () => this.restart("page closed"));
      const cdp = await ctx.newCDPSession(page);
      await this.screencast(cdp);
      await page.goto(this.opts.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      this.log.info("page loaded");
      void this.dismissGates(page);
    } catch (e) {
      this.restart(`open failed: ${errMsg(e)}`);
    }
  }

  private async screencast(cdp: CDPSession) {
    cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
      cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
      this.opts.onFrame(Buffer.from(data, "base64"));
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 60,
      maxWidth: 960,
      maxHeight: 540,
      everyNthFrame: 4, // ~15fps from a 60fps page; plenty for tiles
    });
  }

  /** Click through consent/mature gates for ~30s after load. */
  private async dismissGates(page: Page) {
    for (let i = 0; i < 15 && !this.stopped && !page.isClosed(); i++) {
      try {
        for (const sel of GATE_SELECTORS) {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 200 })) {
            await el.click({ timeout: 2000 });
            this.log.info(`dismissed gate ${sel}`);
          }
        }
        const btn = page.getByRole("button", { name: GATE_TEXT }).first();
        if (await btn.isVisible({ timeout: 200 })) {
          await btn.click({ timeout: 2000 });
          this.log.info("dismissed gate (button text)");
        }
      } catch {
        /* best effort */
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  private restart(reason: string) {
    if (this.stopped || this.retryTimer) return;
    this.log.warn(`${reason}; recreating in 10s`);
    void this.teardown();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.open();
    }, 10_000);
  }

  private async teardown() {
    const ctx = this.ctx;
    this.ctx = null;
    await ctx?.close().catch(() => {});
  }

  async stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    await this.teardown();
    if (this.holding) releaseBrowser();
    this.holding = false;
  }
}
