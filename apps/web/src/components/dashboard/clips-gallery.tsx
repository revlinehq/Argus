"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { DownloadIcon, FilmIcon, Trash2Icon } from "lucide-react";
import { api } from "@convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errMessage, formatDuration, relativeTime } from "@/lib/format";
import type { ClipDoc, ClipId } from "@/lib/types";
import { useNow } from "@/lib/use-now";

export function ClipsGallery() {
  const clips: ClipDoc[] | undefined = useQuery(api.clips.list);
  const [openId, setOpenId] = useState<ClipId | null>(null);
  const now = useNow(30_000);
  const open = clips?.find((c) => c._id === openId) ?? null;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Clips</h2>
        {clips && (
          <span className="font-mono text-xs text-muted-foreground tabular-nums">{clips.length}</span>
        )}
      </div>

      {clips === undefined ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video" />
          ))}
        </div>
      ) : clips.length === 0 ? (
        <div className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
          No clips yet. Hit <span className="font-medium text-foreground">Clip</span> on a live tile,
          or enable auto-clip on a Twitch stream.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {clips.map((c) => (
            <ClipCard key={c._id} clip={c} now={now} onOpen={() => setOpenId(c._id)} />
          ))}
        </div>
      )}

      <ClipDialog clip={open} onClose={() => setOpenId(null)} />
    </section>
  );
}

function ReasonBadge({ clip }: { clip: ClipDoc }) {
  return clip.reason === "chat_spike" ? (
    <Badge variant="secondary" className="max-w-full" title={clip.note}>
      <span className="truncate">chat spike{clip.note ? ` · ${clip.note}` : ""}</span>
    </Badge>
  ) : (
    <Badge variant="outline">manual</Badge>
  );
}

function ClipCard({ clip, now, onOpen }: { clip: ClipDoc; now: number; onOpen: () => void }) {
  const working = clip.status === "pending" || clip.status === "processing";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-lg border bg-card text-left outline-none hover:border-foreground/30 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <div className="relative aspect-video w-full bg-muted">
        {clip.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={clip.thumbUrl} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
            <FilmIcon className="size-4" />
            {working ? (clip.status === "pending" ? "queued" : "processing") : clip.status === "failed" ? "failed" : ""}
          </div>
        )}
        <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1 font-mono text-[10px] text-white tabular-nums">
          {formatDuration(clip.duration ?? clip.seconds)}
        </span>
        {working && clip.thumbUrl && (
          <span className="absolute top-1.5 left-1.5 rounded bg-black/70 px-1 font-mono text-[10px] text-white">
            processing
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1.5 p-2">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="truncate font-medium">{clip.channel}</span>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
            {relativeTime(clip._creationTime, now)}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-1">
          <ReasonBadge clip={clip} />
        </div>
        {clip.status === "failed" && (
          <span className="line-clamp-2 text-[11px] text-destructive">{clip.error ?? "Clip failed"}</span>
        )}
      </div>
    </button>
  );
}

function ClipDialog({ clip, onClose }: { clip: ClipDoc | null; onClose: () => void }) {
  const remove = useMutation(api.clips.remove);
  const [deleting, setDeleting] = useState(false);

  async function del() {
    if (!clip) return;
    setDeleting(true);
    try {
      await remove({ id: clip._id });
      toast.success("Clip deleted");
      onClose();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={!!clip} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        {clip && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {clip.channel}
                <ReasonBadge clip={clip} />
              </DialogTitle>
              <DialogDescription className="font-mono text-xs tabular-nums">
                {formatDuration(clip.duration ?? clip.seconds)} ·{" "}
                {new Date(clip._creationTime).toLocaleString()}
              </DialogDescription>
            </DialogHeader>
            <div className="aspect-video w-full overflow-hidden rounded-md bg-black">
              {clip.videoUrl ? (
                <video
                  key={clip._id}
                  controls
                  src={clip.videoUrl}
                  poster={clip.thumbUrl ?? undefined}
                  className="size-full"
                />
              ) : (
                <div className="flex size-full items-center justify-center px-6 text-center text-sm text-white/60">
                  {clip.status === "failed"
                    ? (clip.error ?? "This clip failed to render.")
                    : "Processing — the video will appear here when it's ready."}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="destructive" onClick={del} disabled={deleting}>
                <Trash2Icon />
                Delete
              </Button>
              {clip.videoUrl && (
                <Button asChild>
                  <a href={clip.videoUrl} download={`${clip.channel}-${clip._id}.mp4`} target="_blank" rel="noreferrer">
                    <DownloadIcon />
                    Download
                  </a>
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
