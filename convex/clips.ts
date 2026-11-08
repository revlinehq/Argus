import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./auth";
import { CLIP_MAX_SECONDS, CLIP_MIN_SECONDS } from "./lib";

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
    });
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
