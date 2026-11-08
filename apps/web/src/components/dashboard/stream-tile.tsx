"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import {
  ExternalLinkIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  ScissorsIcon,
  Trash2Icon,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errMessage, PLATFORM_LABEL } from "@/lib/format";
import type { StreamDoc } from "@/lib/types";
import { useScreencast, type ScreencastState } from "./use-screencast";
import { StatusBadge } from "./status-badge";

const DURATIONS = [15, 30, 60, 90] as const;

export function StreamTile({ stream }: { stream: StreamDoc }) {
  const active = stream.enabled && stream.status !== "stopped";
  const { canvasRef, state, error, receiving, hasFrame, waking } = useScreencast(stream._id, active);

  const requestClip = useMutation(api.clips.request);
  const setEnabled = useMutation(api.streams.setEnabled);
  const setAutoClip = useMutation(api.streams.setAutoClip);
  const remove = useMutation(api.streams.remove);

  const [seconds, setSeconds] = useState<string>("30");
  const [clipping, setClipping] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const isLive = stream.status === "live";

  async function clip() {
    setClipping(true);
    try {
      await requestClip({ streamId: stream._id, seconds: Number(seconds) });
      toast.success(`Clipping last ${seconds}s of ${stream.channel}`);
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setClipping(false);
    }
  }

  async function run(p: Promise<unknown>, ok?: string) {
    try {
      await p;
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(errMessage(e));
    }
  }

  return (
    <div id={`tile-${stream._id}`} className="flex scroll-mt-16 flex-col overflow-hidden rounded-lg border bg-card">
      {/* Live browser view */}
      <div className="relative aspect-video w-full bg-black">
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 size-full object-contain ${hasFrame ? "" : "invisible"} ${
            hasFrame && !receiving ? "opacity-40" : ""
          }`}
        />
        {!(hasFrame && receiving) && (
          <Placeholder
            state={state}
            active={active}
            hasFrame={hasFrame}
            waking={waking}
            error={error}
            stream={stream}
          />
        )}

        {/* top overlay */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent p-2">
          <div className="flex min-w-0 items-center gap-1.5 text-xs">
            <span className="rounded bg-white/10 px-1.5 py-0.5 font-medium text-white/80">
              {PLATFORM_LABEL[stream.platform] ?? stream.platform}
            </span>
            <span className="truncate font-medium text-white">{stream.channel}</span>
          </div>
          <StatusBadge status={stream.status} />
        </div>

        {/* bottom overlay */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/80 to-transparent p-2 pt-6 text-[11px] text-white/80">
          <span className="min-w-0 truncate" title={stream.title}>
            {stream.title ?? ""}
          </span>
          <div className="flex shrink-0 items-center gap-2.5 font-mono tabular-nums">
            {stream.chatRate !== undefined && <span>{Math.round(stream.chatRate)} msg/min</span>}
            {stream.bufferedSeconds !== undefined && (
              <span>buf {Math.round(stream.bufferedSeconds)}s</span>
            )}
            <span className="flex items-center gap-1">
              <span
                className={`size-1.5 rounded-full ${receiving ? "bg-emerald-400" : "bg-white/30"}`}
              />
              browser
            </span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t p-2">
        <div className="flex items-center">
          <Select value={seconds} onValueChange={setSeconds}>
            <SelectTrigger size="sm" className="rounded-r-none border-r-0 font-mono" aria-label="Clip length">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DURATIONS.map((d) => (
                <SelectItem key={d} value={String(d)} className="font-mono">
                  {d}s
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={isLive ? -1 : 0}>
                <Button
                  size="sm"
                  className="rounded-l-none"
                  disabled={!isLive || clipping}
                  onClick={clip}
                >
                  <ScissorsIcon />
                  Clip
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {isLive ? `Save the last ${seconds} seconds` : "Available while the stream is live"}
            </TooltipContent>
          </Tooltip>
        </div>

        {stream.platform === "twitch" && (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <Switch
              size="sm"
              checked={stream.autoClip}
              onCheckedChange={(v) =>
                run(setAutoClip({ id: stream._id, autoClip: v }))
              }
            />
            Auto-clip chat spikes
          </label>
        )}

        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={stream.enabled ? "Pause" : "Resume"}
                onClick={() => run(setEnabled({ id: stream._id, enabled: !stream.enabled }))}
              >
                {stream.enabled ? <PauseIcon /> : <PlayIcon />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{stream.enabled ? "Pause watching" : "Resume watching"}</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label="More">
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <a href={stream.url} target="_blank" rel="noreferrer">
                  <ExternalLinkIcon />
                  Open stream
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmRemove(true)}>
                <Trash2Icon />
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop watching {stream.channel}?</AlertDialogTitle>
            <AlertDialogDescription>
              The cloud browser for this stream will close. Existing clips are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => run(remove({ id: stream._id }), `Removed ${stream.channel}`)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Placeholder({
  state,
  active,
  hasFrame,
  waking,
  error,
  stream,
}: {
  state: ScreencastState;
  active: boolean;
  hasFrame: boolean;
  waking: boolean;
  error: string | null;
  stream: StreamDoc;
}) {
  let title: string;
  let detail: string | null = null;
  if (!active) {
    title = "Paused";
    detail = "Resume to reopen the cloud browser.";
  } else if (state === "worker-offline") {
    title = "Worker offline";
    detail = "No worker has registered. Start apps/worker.";
  } else if (state === "error") {
    title = "Can't reach browser view";
    detail = error;
  } else if (stream.status === "error") {
    title = "Stream error";
    detail = stream.error ?? null;
  } else if (stream.status === "offline") {
    title = "Channel offline";
    detail = "The worker will check again periodically.";
  } else if (waking) {
    title = "Waking browser";
    detail = "The cloud browser sleeps when nobody is watching. Clipping never stops.";
  } else if (hasFrame) {
    title = "Frames stalled";
    detail = "Waiting for the browser to send new frames.";
  } else {
    title = stream.status === "starting" ? "Opening browser" : "Waiting for frames";
    detail = state === "open" ? "Connected — waiting for the first frame." : "Connecting to worker.";
  }

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-6 text-center">
      <span className="text-sm font-medium text-white/80">{title}</span>
      {detail && <span className="line-clamp-2 text-xs text-white/50">{detail}</span>}
    </div>
  );
}
