"use client";

import Link from "next/link";
import { RedirectToSignIn, UserButton, useAuth } from "@clerk/nextjs";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Skeleton } from "@/components/ui/skeleton";
import { CONVEX_URL } from "@/app/providers";
import type { StreamDoc } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import { AddStreamForm } from "./add-stream-form";
import { ClipsGallery } from "./clips-gallery";
import { StreamTile } from "./stream-tile";

export function Dashboard() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { isLoaded: clerkLoaded, isSignedIn } = useAuth();

  let body: React.ReactNode;
  if (!CONVEX_URL) {
    body = (
      <Notice title="Convex isn't configured">
        Set <Code>NEXT_PUBLIC_CONVEX_URL</Code> in <Code>apps/web/.env.local</Code> (run{" "}
        <Code>npx convex dev</Code> at the repo root) and restart the dev server.
      </Notice>
    );
  } else if (isLoading) {
    body = <LoadingGrid />;
  } else if (!isAuthenticated) {
    body = isSignedIn ? (
      <Notice title="Convex couldn't verify your Clerk session">
        In Clerk, create a JWT template named <Code>convex</Code> (Convex preset), then set{" "}
        <Code>CLERK_JWT_ISSUER_DOMAIN</Code> on your Convex deployment with{" "}
        <Code>npx convex env set CLERK_JWT_ISSUER_DOMAIN https://…clerk.accounts.dev</Code>.
      </Notice>
    ) : clerkLoaded ? (
      // Middleware normally redirects; this covers Clerk keyless dev mode,
      // where the first request can arrive before keys are in a cookie.
      <RedirectToSignIn />
    ) : (
      <LoadingGrid />
    );
  } else {
    body = <AuthedDashboard />;
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b bg-background">
        <div className="mx-auto flex h-12 max-w-[1600px] items-center gap-4 px-4">
          <Link href="/" className="font-semibold tracking-tight">
            Watcher
          </Link>
          {isAuthenticated && <StreamCounts />}
          <div className="ml-auto flex items-center">
            <UserButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] space-y-8 px-4 py-6">{body}</main>
    </div>
  );
}

function StreamCounts() {
  const streams: StreamDoc[] | undefined = useQuery(api.streams.list);
  const lastSeen = useQuery(api.streams.workerLastSeen);
  const now = useNow(10_000);
  if (!streams) return null;
  const enabled = streams.filter((s) => s.enabled);
  const live = streams.filter((s) => s.status === "live").length;
  // Worker heartbeats every 15s.
  const stuck = lastSeen === undefined ? false : !lastSeen || now - lastSeen > 60_000;
  return (
    <div className="flex items-center gap-3 font-mono text-xs text-muted-foreground tabular-nums">
      <span className="flex items-center gap-1.5">
        <span className={`size-1.5 rounded-full ${stuck ? "bg-zinc-500" : "bg-emerald-500"}`} />
        {stuck ? "worker offline" : "worker"}
      </span>
      <span>
        {live}/{enabled.length} live
      </span>
    </div>
  );
}

function AuthedDashboard() {
  const streams: StreamDoc[] | undefined = useQuery(api.streams.list);
  const sorted = streams?.slice().sort((a, b) => a._creationTime - b._creationTime);

  return (
    <>
      <AddStreamForm />

      <section className="rounded-xl border bg-muted/20 p-3 sm:p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
            watched in cloud
          </h2>
          {sorted && (
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {sorted.length} {sorted.length === 1 ? "browser" : "browsers"}
            </span>
          )}
        </div>
        {sorted === undefined ? (
          <TileSkeletons />
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-6 py-16 text-center">
            <span className="text-sm font-medium">Nothing watched yet</span>
            <span className="max-w-sm text-xs text-muted-foreground">
              Add a Twitch, Kick or YouTube stream above. The worker opens it in a headless browser
              and you&apos;ll see that browser live here.
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sorted.map((s) => (
              <StreamTile key={s._id} stream={s} />
            ))}
          </div>
        )}
      </section>

      <ClipsGallery />
    </>
  );
}

function TileSkeletons() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="aspect-video" />
      ))}
    </div>
  );
}

function LoadingGrid() {
  return (
    <>
      <Skeleton className="h-8 w-full sm:max-w-xl" />
      <TileSkeletons />
    </>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl rounded-lg border bg-card p-5">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">{children}</code>;
}
