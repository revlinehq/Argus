"use client";

import { useAction } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import { errMessage } from "@/lib/format";
import type { StreamId } from "@/lib/types";

export type ScreencastState =
  | "idle" // not connecting (stream paused)
  | "connecting"
  | "open" // socket open
  | "worker-offline" // viewerToken returned null
  | "error";

type Token = { url: string; exp: number };

const REFRESH_MARGIN_MS = 60_000; // reconnect with a fresh token this long before exp
const OFFLINE_RETRY_MS = 15_000;
const MAX_BACKOFF_MS = 30_000;
const STALE_AFTER_MS = 3_000;

/** True while the page is visible; a hidden tab lets the worker's browser sleep. */
function usePageVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

/**
 * Streams JPEG frames from the worker's screencast WebSocket into a canvas.
 * Frames are drawn imperatively (no React state per frame); `receiving` is
 * sampled once a second.
 */
export function useScreencast(id: StreamId, active: boolean) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const getToken = useAction(api.streams.viewerToken);
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const [state, setState] = useState<ScreencastState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [hasFrame, setHasFrame] = useState(false);
  const [waking, setWaking] = useState(false);
  const wakingRef = useRef(false);
  const lastFrameAt = useRef(0);
  const visible = usePageVisible();
  const connected = active && visible;

  useEffect(() => {
    const setWake = (v: boolean) => {
      if (wakingRef.current === v) return;
      wakingRef.current = v;
      setWaking(v);
    };
    setWake(false);
    if (!connected) {
      setState("idle");
      return;
    }

    let cancelled = false;
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let decoding = false;
    let pending: Blob | null = null;

    const clearTimers = () => {
      clearTimeout(retryTimer);
      clearTimeout(refreshTimer);
    };

    const closeSocket = () => {
      if (!ws) return;
      const s = ws;
      ws = null;
      s.onopen = s.onclose = s.onerror = s.onmessage = null;
      try {
        s.close();
      } catch {}
    };

    const scheduleRetry = (ms?: number) => {
      if (cancelled) return;
      const delay = ms ?? Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
      attempt++;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, delay);
    };

    const draw = async (blob: Blob) => {
      if (decoding) {
        pending = blob; // keep only the newest frame while decoding
        return;
      }
      decoding = true;
      try {
        let next: Blob | null = blob;
        while (next && !cancelled) {
          pending = null;
          const bmp = await createImageBitmap(next);
          const c = canvasRef.current;
          if (c) {
            if (c.width !== bmp.width || c.height !== bmp.height) {
              c.width = bmp.width;
              c.height = bmp.height;
            }
            c.getContext("2d")?.drawImage(bmp, 0, 0);
          }
          bmp.close();
          next = pending;
        }
      } catch {
        // corrupt frame; skip it
      } finally {
        decoding = false;
      }
    };

    async function connect() {
      if (cancelled) return;
      clearTimers();
      closeSocket();
      setState("connecting");

      let token: Token | null;
      try {
        token = (await getTokenRef.current({ id })) as Token | null;
      } catch (e) {
        if (cancelled) return;
        setError(errMessage(e));
        setState("error");
        scheduleRetry();
        return;
      }
      if (cancelled) return;
      if (!token) {
        setState("worker-offline");
        scheduleRetry(OFFLINE_RETRY_MS);
        return;
      }

      setError(null);
      const sock = new WebSocket(token.url);
      sock.binaryType = "blob";
      ws = sock;

      sock.onopen = () => {
        if (cancelled) return;
        setState("open");
      };
      sock.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          // Worker's browser was asleep and is booting for us.
          if (ev.data.includes('"waking"')) {
            lastFrameAt.current = 0;
            setHasFrame(false);
            setWake(true);
          }
          return;
        }
        setWake(false); // no-op after the first frame (ref guard)
        attempt = 0;
        lastFrameAt.current = Date.now();
        void draw(ev.data);
      };
      sock.onerror = () => {
        // onclose follows; handled there
      };
      sock.onclose = () => {
        if (cancelled || ws !== sock) return;
        ws = null;
        setWake(false);
        setState("connecting");
        // Every reconnect fetches a fresh token, so auth rejections recover too.
        scheduleRetry();
      };

      const refreshIn = Math.max(5_000, token.exp - Date.now() - REFRESH_MARGIN_MS);
      refreshTimer = setTimeout(() => {
        attempt = 0;
        void connect();
      }, refreshIn);
    }

    void connect();

    return () => {
      cancelled = true;
      clearTimers();
      closeSocket();
    };
  }, [id, connected]);

  // Sample frame liveness once a second rather than re-rendering per frame.
  useEffect(() => {
    const t = setInterval(() => {
      const fresh = Date.now() - lastFrameAt.current < STALE_AFTER_MS;
      setReceiving(fresh);
      if (fresh) setHasFrame(true);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  return { canvasRef, state, error, receiving, hasFrame, waking };
}
