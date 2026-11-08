import { v } from "convex/values";
import { action, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireUser } from "./auth";
import { MAX_STREAMS_PER_USER, parseStreamUrl } from "./lib";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    return await ctx.db
      .query("streams")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const add = mutation({
  args: { input: v.string() },
  handler: async (ctx, { input }) => {
    const userId = await requireUser(ctx);
    const parsed = parseStreamUrl(input);
    const existing = await ctx.db
      .query("streams")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    if (existing.length >= MAX_STREAMS_PER_USER) {
      throw new Error(`Max ${MAX_STREAMS_PER_USER} streams`);
    }
    if (existing.some((s) => s.url === parsed.url)) {
      throw new Error("Already watching that stream");
    }
    return await ctx.db.insert("streams", {
      userId,
      ...parsed,
      enabled: true,
      autoClip: parsed.platform === "twitch",
      status: "starting",
      updatedAt: Date.now(),
    });
  },
});

async function ownStream(ctx: MutationCtx, id: Id<"streams">) {
  const userId = await requireUser(ctx);
  const stream = await ctx.db.get(id);
  if (!stream || stream.userId !== userId) throw new Error("Not found");
  return stream;
}

export const remove = mutation({
  args: { id: v.id("streams") },
  handler: async (ctx, { id }) => {
    await ownStream(ctx, id);
    await ctx.db.delete(id);
  },
});

export const setEnabled = mutation({
  args: { id: v.id("streams"), enabled: v.boolean() },
  handler: async (ctx, { id, enabled }) => {
    await ownStream(ctx, id);
    await ctx.db.patch(id, {
      enabled,
      status: enabled ? "starting" : "stopped",
      error: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const setAutoClip = mutation({
  args: { id: v.id("streams"), autoClip: v.boolean() },
  handler: async (ctx, { id, autoClip }) => {
    await ownStream(ctx, id);
    await ctx.db.patch(id, { autoClip, updatedAt: Date.now() });
  },
});

/** When the stream worker last checked in (ms), or null if never. */
export const workerLastSeen = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const w = await ctx.db
      .query("workers")
      .withIndex("by_name", (q) => q.eq("name", "default"))
      .unique();
    return w?.lastSeen ?? null;
  },
});

export const _ownedBy = internalQuery({
  args: { id: v.id("streams"), userId: v.string() },
  handler: async (ctx, { id, userId }) => {
    const s = await ctx.db.get(id);
    if (!s || s.userId !== userId) return null;
    const worker = await ctx.db
      .query("workers")
      .withIndex("by_name", (q) => q.eq("name", "default"))
      .unique();
    return { wsUrl: worker?.wsUrl ?? null, workerLastSeen: worker?.lastSeen ?? 0 };
  },
});

/**
 * Short-lived signed token that lets the browser open the worker's
 * screencast WebSocket for one stream. Token = `${exp}.${hmac(streamId.exp)}`.
 */
export const viewerToken = action({
  args: { id: v.id("streams") },
  handler: async (ctx, { id }): Promise<{ url: string; exp: number } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const info: { wsUrl: string | null; workerLastSeen: number } | null = await ctx.runQuery(
      internal.streams._ownedBy,
      {
      id,
        userId: identity.subject,
      },
    );
    if (!info) throw new Error("Not found");
    // Worker heartbeats every 15s; treat >60s silence as offline.
    if (!info.wsUrl || Date.now() - info.workerLastSeen > 60_000) return null;
    const secret = process.env.WORKER_SECRET;
    if (!secret) throw new Error("WORKER_SECRET not set on Convex");
    const exp = Date.now() + 10 * 60_000;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${exp}`));
    const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return { url: `${info.wsUrl}/view/${id}?t=${exp}.${hex}`, exp };
  },
});
