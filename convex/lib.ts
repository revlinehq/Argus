export type Platform = "twitch" | "youtube" | "kick" | "other";

/** Normalise a pasted stream URL (or bare Twitch channel name). */
export function parseStreamUrl(input: string): {
  url: string;
  platform: Platform;
  channel: string;
} {
  const raw = input.trim();
  if (/^[a-zA-Z0-9_]{3,25}$/.test(raw)) {
    return {
      url: `https://www.twitch.tv/${raw.toLowerCase()}`,
      platform: "twitch",
      channel: raw.toLowerCase(),
    };
  }
  let u: URL;
  try {
    u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    throw new Error("That doesn't look like a stream URL");
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const first = u.pathname.split("/").filter(Boolean)[0] ?? "";
  if (host === "twitch.tv" && first) {
    const channel = first.toLowerCase();
    return { url: `https://www.twitch.tv/${channel}`, platform: "twitch", channel };
  }
  if (host === "kick.com" && first) {
    const channel = first.toLowerCase();
    return { url: `https://kick.com/${channel}`, platform: "kick", channel };
  }
  if (host === "youtube.com" || host === "youtu.be") {
    const channel =
      u.searchParams.get("v") ?? (first.startsWith("@") ? first : u.pathname.slice(1)) ?? "youtube";
    return { url: u.toString(), platform: "youtube", channel };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("Only http(s) URLs are supported");
  }
  return { url: u.toString(), platform: "other", channel: host };
}

export const CLIP_MIN_SECONDS = 5;
export const CLIP_MAX_SECONDS = 120;
export const MAX_STREAMS_PER_USER = 6;
/** Must match the worker's BUFFER_SECONDS; older moments can't be (re)clipped. */
export const BUFFER_MS = 5 * 60_000;
