import { ConvexClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import { config } from "./config.js";

import type { Id } from "../../../convex/_generated/dataModel.js";

export { api };

// IDs travel through the worker as plain strings; cast at the API boundary.
const sid = (id: string) => id as Id<"streams">;
const cid = (id: string) => id as Id<"clips">;
const fid = (id: string) => id as Id<"_storage">;

export const convex = new ConvexClient(config.convexUrl);

/** Shapes returned by convex/worker.ts. */
export type ActiveStream = {
  _id: string;
  url: string;
  platform: "twitch" | "youtube" | "kick" | "other";
  channel: string;
  autoClip: boolean;
};

export type PendingClip = { _id: string; streamId: string; seconds: number; endAt?: number };
export type ClipStage = "queued" | "building" | "uploading";

export type StreamPatch = {
  status?: "starting" | "live" | "offline" | "error";
  title?: string;
  chatRate?: number;
  bufferedSeconds?: number;
  error?: string | null;
};

const secret = config.secret;

/** Worker API wrappers — every call carries the shared secret. */
export const worker = {
  heartbeat: () => convex.mutation(api.worker.heartbeat, { secret, wsUrl: config.publicWsUrl }),
  updateStream: (id: string, patch: StreamPatch) =>
    convex.mutation(api.worker.updateStream, { secret, id: sid(id), ...patch }),
  autoClip: (streamId: string, seconds: number, note: string, endAt: number): Promise<string | null> =>
    convex.mutation(api.worker.autoClip, { secret, streamId: sid(streamId), seconds, note, endAt }),
  claimClip: (id: string): Promise<boolean> => convex.mutation(api.worker.claimClip, { secret, id: cid(id) }),
  failOrphanedClips: (): Promise<number> => convex.mutation(api.worker.failOrphanedClips, { secret }),
  setClipStage: (id: string, stage: ClipStage) =>
    convex.mutation(api.worker.setClipStage, { secret, id: cid(id), stage }),
  generateUploadUrl: (): Promise<string> => convex.mutation(api.worker.generateUploadUrl, { secret }),
  completeClip: (id: string, videoId: string, thumbId: string | undefined, duration: number) =>
    convex.mutation(api.worker.completeClip, {
      secret,
      id: cid(id),
      videoId: fid(videoId),
      thumbId: thumbId ? fid(thumbId) : undefined,
      duration,
    }),
  failClip: (id: string, error: string) =>
    convex.mutation(api.worker.failClip, { secret, id: cid(id), error: error.slice(0, 500) }),
  onActiveStreams: (cb: (s: ActiveStream[]) => void, onErr: (e: Error) => void) =>
    convex.onUpdate(api.worker.activeStreams, { secret }, cb, onErr),
  onPendingClips: (cb: (c: PendingClip[]) => void, onErr: (e: Error) => void) =>
    convex.onUpdate(api.worker.pendingClips, { secret }, cb, onErr),
};
