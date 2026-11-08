import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./auth";
import { BUFFER_MS, CLIP_MAX_SECONDS, CLIP_MIN_SECONDS } from "./lib";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const clips = await ctx.db
      .query("clips")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(60);
    return await Promise.all(
      clips.map(async (c) => ({
        ...c,
        videoUrl: c.videoId ? await ctx.storage.getUrl(c.videoId) : null,
        thumbUrl: c.thumbId ? await ctx.storage.getUrl(c.thumbId) : null,
      })),
    );
  },
});

export const request = mutation({
  args: { streamId: v.id("streams"), seconds: v.number() },
  handler: async (ctx, { streamId, seconds }) => {
    const userId = await requireUser(ctx);
    const stream = await ctx.db.get(streamId);
    if (!stream || stream.userId !== userId) throw new Error("Not found");
    if (stream.status !== "live") throw new Error("Stream isn't live");
    const secs = Math.round(Math.min(CLIP_MAX_SECONDS, Math.max(CLIP_MIN_SECONDS, seconds)));
    return await ctx.db.insert("clips", {
      userId,
      streamId,
      channel: stream.channel,
      status: "pending",
      reason: "manual",
      seconds: secs,
      stage: "queued",
      endAt: Date.now(),
    });
  },
});

/** Re-run a failed clip for the same moment, if it's still in the buffer. */
export const retry = mutation({
  args: { id: v.id("clips") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const clip = await ctx.db.get(id);
    if (!clip || clip.userId !== userId) throw new Error("Not found");
    if (clip.status !== "failed") throw new Error("Only failed clips can be retried");
    const endAt = clip.endAt ?? clip._creationTime;
    if (Date.now() - endAt + clip.seconds * 1000 > BUFFER_MS) {
      throw new Error("That moment has left the 5-minute buffer");
    }
    const stream = await ctx.db.get(clip.streamId);
    if (!stream || !stream.enabled) throw new Error("Stream is no longer being watched");
    await ctx.db.patch(id, { status: "pending", stage: "queued", error: undefined });
  },
});

export const remove = mutation({
  args: { id: v.id("clips") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const clip = await ctx.db.get(id);
    if (!clip || clip.userId !== userId) throw new Error("Not found");
    if (clip.videoId) await ctx.storage.delete(clip.videoId);
    if (clip.thumbId) await ctx.storage.delete(clip.thumbId);
    await ctx.db.delete(id);
  },
});
