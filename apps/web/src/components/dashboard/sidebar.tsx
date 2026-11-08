"use client";

import { useQuery } from "convex/react";
import { ArrowLeftToLine, ArrowRightFromLine, Scissors } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@convex/_generated/api";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import type { ClipDoc, StreamDoc } from "@/lib/types";
import { useNow } from "@/lib/use-now";

const STORAGE_KEY = "watcher:sidebar-collapsed";

/** Twitch-style left rail: the streams you're watching, then recent clips. */
export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {}
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(STORAGE_KEY, c ? "0" : "1");
      } catch {}
      return !c;
    });
  };

  const streams: StreamDoc[] | undefined = useQuery(api.streams.list);
  const clips: ClipDoc[] | undefined = useQuery(api.clips.list);
  const now = useNow(30_000);

  // Live first (busiest chat on top), then the rest alphabetically.
  const sorted = streams?.slice().sort((a, b) => {
    const al = a.status === "live" ? 1 : 0;
    const bl = b.status === "live" ? 1 : 0;
    if (al !== bl) return bl - al;
    if (al) return (b.chatRate ?? 0) - (a.chatRate ?? 0);
    return a.channel.localeCompare(b.channel);
  });
  const recent = clips?.filter((c) => c.status === "ready").slice(0, 5);

  return (
    <aside
      className={cn(
        "sticky top-12 hidden h-[calc(100dvh-3rem)] shrink-0 flex-col overflow-y-auto border-r bg-sidebar md:flex",
        collapsed ? "w-[52px]" : "w-60",
      )}
    >
      <div className={cn("flex h-10 items-center px-2.5", collapsed ? "justify-center" : "justify-between")}>
        {!collapsed && (
          <span className="text-[13px] font-semibold tracking-wide text-sidebar-foreground uppercase">
            Watching
          </span>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="rounded p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          {collapsed ? <ArrowRightFromLine className="size-4" /> : <ArrowLeftToLine className="size-4" />}
        </button>
      </div>

      <nav className="flex flex-col">
        {sorted?.map((s) => <StreamRow key={s._id} stream={s} collapsed={collapsed} />)}
        {sorted?.length === 0 && !collapsed && (
          <p className="px-2.5 py-2 text-xs text-muted-foreground">No streams yet.</p>
        )}
      </nav>

      {!collapsed && recent && recent.length > 0 && (
        <>
          <div className="mt-4 flex h-10 items-center px-2.5">
            <span className="text-[13px] font-semibold tracking-wide text-sidebar-foreground uppercase">
              Recent clips
            </span>
          </div>
          <div className="flex flex-col">
            {recent.map((c) => (
              <a
                key={c._id}
                href={`#clip-${c._id}`}
                className="flex items-center gap-2.5 px-2.5 py-1.5 hover:bg-sidebar-accent"
              >
                <div className="relative h-8 w-14 shrink-0 overflow-hidden rounded-sm bg-muted">
                  {c.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.thumbUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <Scissors className="m-auto mt-2 size-4 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{c.channel}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {c.reason === "chat_spike" ? "chat spike" : "manual"} · {relativeTime(c._creationTime, now)}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

function StreamRow({ stream, collapsed }: { stream: StreamDoc; collapsed: boolean }) {
  const live = stream.status === "live";
  const jump = () =>
    document.getElementById(`tile-${stream._id}`)?.scrollIntoView({ block: "start" });

  const row = (
    <button
      type="button"
      onClick={jump}
      className={cn(
        "flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left hover:bg-sidebar-accent",
        collapsed && "justify-center",
      )}
    >
      <Avatar stream={stream} />
      {!collapsed && (
        <>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">{stream.channel}</div>
            <div className="truncate text-[13px] text-muted-foreground">
              {live ? stream.title || platformName(stream.platform) : platformName(stream.platform)}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 self-start pt-0.5 text-[13px]">
            {live ? (
              <>
                <span className="size-2 rounded-full bg-[#eb0400]" />
                <span className="font-mono tabular-nums">{formatRate(stream.chatRate)}</span>
              </>
            ) : (
              <span className="text-muted-foreground">{stream.enabled ? "Offline" : "Paused"}</span>
            )}
          </div>
        </>
      )}
    </button>
  );

  if (!collapsed) return row;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="right">
        {stream.channel} · {live ? `live · ${formatRate(stream.chatRate)} msg/min` : "offline"}
      </TooltipContent>
    </Tooltip>
  );
}

const AVATAR_COLORS = ["#9147ff", "#00b5ad", "#eb0400", "#f59e0b", "#1f69ff", "#00c853", "#ff6ad5"];

function Avatar({ stream }: { stream: StreamDoc }) {
  const [failed, setFailed] = useState(false);
  const live = stream.status === "live";
  // Public avatar lookup for Twitch channels; initials everywhere else / on failure.
  const src = stream.platform === "twitch" && !failed ? `https://unavatar.io/twitch/${stream.channel}` : null;
  const color = AVATAR_COLORS[hash(stream.channel) % AVATAR_COLORS.length];
  return (
    <div className={cn("relative size-[30px] shrink-0 overflow-hidden rounded-full", !live && "grayscale opacity-60")}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <div
          className="flex size-full items-center justify-center text-xs font-bold text-white uppercase"
          style={{ background: color }}
        >
          {stream.channel.replace(/^@/, "").slice(0, 1)}
        </div>
      )}
    </div>
  );
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function platformName(p: StreamDoc["platform"]) {
  return { twitch: "Twitch", kick: "Kick", youtube: "YouTube", other: "Web" }[p];
}

function formatRate(r?: number) {
  if (r === undefined) return "—";
  return r >= 1000 ? `${(r / 1000).toFixed(1)}K` : String(Math.round(r));
}
