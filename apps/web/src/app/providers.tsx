"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import type { ReactNode } from "react";

export const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

// A placeholder keeps the provider tree valid when the env var is missing;
// the dashboard shows a config notice instead of crashing.
const convex = new ConvexReactClient(CONVEX_URL ?? "https://missing-convex-url.convex.cloud");

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
