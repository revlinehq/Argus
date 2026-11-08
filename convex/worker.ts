/**
 * Functions called by the stream worker (apps/worker). Every function is
 * public but gated on WORKER_SECRET, which only the worker knows.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { checkWorkerSecret } from "./auth";
import { streamStatus } from "./schema";

const secret = v.string();

export const activeStreams = query({
  args: { secret },
  handler: async (ctx, args) => {
    checkWorkerSecret(args.secret);
    const streams = await ctx.db
      .query("streams")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .collect();
    return streams.map((s) => ({
      _id: s._id,
      url: s.url,
      platform: s.platform,
      channel: s.channel,
      autoClip: s.autoClip,
    }));
  },
});

export const pendingClips = query({
  args: { secret },
  handler: async (ctx, args) => {
    checkWorkerSecret(args.secret);
    return await ctx.db
      .query("clips")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(20);
  },
});

export const heartbeat = mutation({
  args: { secret, wsUrl: v.string() },
  handler: async (ctx, args) => {
    checkWorkerSecret(args.secret);
    const existing = await ctx.db
      .query("workers")
      .withIndex("by_name", (q) => q.eq("name", "default"))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { wsUrl: args.wsUrl, lastSeen: Date.now() });
    else await ctx.db.insert("workers", { name: "default", wsUrl: args.wsUrl, lastSeen: Date.now() });
  },
});

export const updateStream = mutation({
  args: {
    secret,
    id: v.id("streams"),
    status: v.optional(streamStatus),
    title: v.optional(v.string()),
    chatRate: v.optional(v.number()),
    bufferedSeconds: v.optional(v.number()),
    error: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { secret: s, id, error, ...patch }) => {
    checkWorkerSecret(s);
    const stream = await ctx.db.get(id);
    if (!stream || !stream.enabled) return; // deleted or stopped meanwhile
    const next: Record<string, unknown> = { ...patch, updatedAt: Date.now() };
    if (error !== undefined) next.error = error ?? undefined;
    if (patch.status === "live" && stream.status !== "live") next.liveSince = Date.now();
    if (patch.status && patch.status !== "live") next.liveSince = undefined;
    await ctx.db.patch(id, next);
  },
});

/** Worker detected a highlight (chat spike) → create + claim a clip in one go. */
export const autoClip = mutation({
  args: { secret, streamId: v.id("streams"), seconds: v.number(), note: v.string() },
  handler: async (ctx, args) => {
    checkWorkerSecret(args.secret);
    const stream = await ctx.db.get(args.streamId);
    if (!stream || !stream.autoClip) return null;
    return await ctx.db.insert("clips", {
      userId: stream.userId,
      streamId: stream._id,
      channel: stream.channel,
      status: "processing",
      reason: "chat_spike",
      seconds: args.seconds,
      note: args.note,
    });
  },
});

/** Atomically move a pending clip to processing. Returns false if already taken. */
export const claimClip = mutation({
  args: { secret, id: v.id("clips") },
  handler: async (ctx, args) => {
    checkWorkerSecret(args.secret);
    const clip = await ctx.db.get(args.id);
    if (!clip || clip.status !== "pending") return false;
    await ctx.db.patch(args.id, { status: "processing" });
    return true;
  },
});

/** On worker boot: anything still "processing" was orphaned by the previous run. */
export const failOrphanedClips = mutation({
  args: { secret },
  handler: async (ctx, args) => {
    checkWorkerSecret(args.secret);
    const stuck = await ctx.db
      .query("clips")
      .withIndex("by_status", (q) => q.eq("status", "processing"))
      .collect();
    for (const c of stuck) {
      await ctx.db.patch(c._id, { status: "failed", error: "Worker restarted mid-clip" });
    }
    return stuck.length;
  },
});

export const generateUploadUrl = mutation({
  args: { secret },
  handler: async (ctx, args) => {
    checkWorkerSecret(args.secret);
    return await ctx.storage.generateUploadUrl();
  },
});

export const completeClip = mutation({
  args: {
    secret,
    id: v.id("clips"),
    videoId: v.id("_storage"),
    thumbId: v.optional(v.id("_storage")),
    duration: v.number(),
  },
  handler: async (ctx, { secret: s, id, ...rest }) => {
    checkWorkerSecret(s);
    const clip = await ctx.db.get(id);
    if (!clip) {
      // user deleted it mid-flight; don't leak storage
      await ctx.storage.delete(rest.videoId);
      if (rest.thumbId) await ctx.storage.delete(rest.thumbId);
      return;
    }
    await ctx.db.patch(id, { ...rest, status: "ready" });
  },
});

export const failClip = mutation({
  args: { secret, id: v.id("clips"), error: v.string() },
  handler: async (ctx, args) => {
    checkWorkerSecret(args.secret);
    const clip = await ctx.db.get(args.id);
    if (clip) await ctx.db.patch(args.id, { status: "failed", error: args.error });
  },
});
