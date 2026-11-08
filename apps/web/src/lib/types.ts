import type { Doc, Id } from "@convex/_generated/dataModel";

export type StreamDoc = Doc<"streams">;
export type StreamId = Id<"streams">;
export type ClipDoc = Doc<"clips"> & { videoUrl: string | null; thumbUrl: string | null };
export type ClipId = Id<"clips">;
