import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, SignUpButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-8 px-6">
      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        streamwatcher · experimental
      </div>
      <div className="space-y-3">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Watcher</h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          Cloud browsers that watch live streams and clip the moments.
        </p>
        <p className="max-w-xl text-sm text-muted-foreground">
          Paste a Twitch, Kick or YouTube stream. A headless Chromium opens it in the cloud, keeps a
          rolling buffer, and cuts the last N seconds on demand — or automatically when chat spikes.
        </p>
      </div>
      <div className="flex gap-2">
        <SignedOut>
          <SignInButton forceRedirectUrl="/dashboard">
            <Button size="lg">Sign in</Button>
          </SignInButton>
          <SignUpButton forceRedirectUrl="/dashboard">
            <Button size="lg" variant="outline">
              Create account
            </Button>
          </SignUpButton>
        </SignedOut>
        <SignedIn>
          <Button size="lg" asChild>
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        </SignedIn>
      </div>
    </main>
  );
}
