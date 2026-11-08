import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const platform = v.union(
  v.literal("twitch"),
  v.literal("youtube"),
  v.literal("kick"),
  v.literal("other"),
);

export const streamStatus = v.union(
  v.literal("starting"), // worker is spinning up browser + capture
  v.literal("live"), // browser open, buffer recording
  v.literal("offline"), // channel not live; worker retries periodically
  v.literal("error"),
  v.literal("stopped"), // disabled by user
);

export const clipStatus = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("ready"),
  v.literal("failed"),
);

/** Progress within "processing", reported by the worker. */
export const clipStage = v.union(v.literal("queued"), v.literal("building"), v.literal("uploading"));

export const clipReason = v.union(v.literal("manual"), v.literal("chat_spike"));

export default defineSchema({
  streams: defineTable({
    userId: v.string(),
    url: v.string(),
    platform,
    channel: v.string(),
    enabled: v.boolean(),
    autoClip: v.boolean(),
    status: streamStatus,
    title: v.optional(v.string()),
    chatRate: v.optional(v.number()), // messages / minute, Twitch only
    error: v.optional(v.string()),
    liveSince: v.optional(v.number()),
    bufferedSeconds: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_enabled", ["enabled"]),

  clips: defineTable({
    userId: v.string(),
    streamId: v.id("streams"),
    channel: v.string(),
    status: clipStatus,
    reason: clipReason,
    seconds: v.number(),
    note: v.optional(v.string()),
    videoId: v.optional(v.id("_storage")),
    thumbId: v.optional(v.id("_storage")),
    duration: v.optional(v.number()),
    error: v.optional(v.string()),
    stage: v.optional(clipStage),
    /** Wall-clock moment the clip ends at (click time / spike time). */
    endAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_status", ["status"])
    .index("by_stream", ["streamId"]),

  workers: defineTable({
    name: v.string(),
    wsUrl: v.string(),
    lastSeen: v.number(),
  }).index("by_name", ["name"]),
});
