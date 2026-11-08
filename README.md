# Watcher

Cloud browsers that watch live streams and clip the moments.

Every stream you add gets its own real headless Chromium tab (shown live in the
dashboard grid) plus a rolling video buffer. Hit **Clip** to save the last N
seconds as an mp4, or let chat spikes trigger auto-clips (Twitch).

> Experimental project. It watches streams for clipping; it does not inflate
> viewer counts and doesn't use proxies or stealth tricks.

## Architecture

```
apps/web     Next.js 15 + shadcn/ui + Clerk   → Cloudflare Workers (OpenNext)
convex/      Convex: streams, clips, file storage, worker API
apps/worker  Node service: Playwright browsers, yt-dlp + ffmpeg buffers,
             clip builder, Twitch chat-spike detector, screencast WebSocket
```

Flow: add a stream in the UI → Convex → the worker (subscribed) opens a browser
and starts a 5-min segment buffer → tile goes live → Clip → worker concats the
last N seconds (`-c copy`, instant) → uploads to Convex storage → gallery updates.

The worker runs on its own (the dashboard can be closed). It needs a real
machine: your PC, a VPS, or Cloudflare Containers (`apps/worker/Dockerfile`).

## Setup

Requirements: Node 22, `ffmpeg`, `yt-dlp`.

```bash
npm install
npx playwright install chromium
```

1. **Convex.** `npx convex dev` (creates `.env.local`). Then set a worker secret:
   `npx convex env set WORKER_SECRET $(openssl rand -hex 32)`
2. **Clerk.** Create an app at dashboard.clerk.com and enable the **Convex**
   integration (Configure → Integrations). Then:
   - `npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-app>.clerk.accounts.dev`
   - put `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` in `apps/web/.env.local`
     along with `NEXT_PUBLIC_CONVEX_URL`
3. **Worker.** `apps/worker/.env`: `CONVEX_URL`, `WORKER_SECRET` (same value),
   `WORKER_PORT=8788`, `PUBLIC_WS_URL=ws://localhost:8788`, `BUFFER_SECONDS=300`

```bash
npm run dev     # convex + web (localhost:3000) + worker
```

## Deploy

- **Web → Cloudflare:** `npm run deploy -w web` (set the Clerk + Convex env vars
  as Worker secrets/vars first).
- **Convex:** `npx convex deploy`
- **Worker:** `docker build -f apps/worker/Dockerfile -t watcher-worker .` → run on a
  VPS or Cloudflare Containers with the worker env vars. Set `PUBLIC_WS_URL`
  to its public `wss://` URL.
