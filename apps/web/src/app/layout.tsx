import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { ConvexClientProvider } from "./providers";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Inter: the body face Twitch uses (its headline face, Roobert, is commercial).
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// Render per request: ClerkProvider needs keys (or keyless dev mode) at render
// time, so nothing is prerendered at build. This also keeps `next build`
// working before Clerk keys are configured.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Watcher",
  description: "Cloud browsers that watch live streams and clip the moments.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider appearance={{ baseTheme: dark }}>
      <html lang="en" className={`dark ${inter.variable} ${geistMono.variable}`}>
        <body className="min-h-dvh antialiased">
          <ConvexClientProvider>
            <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
            <Toaster position="bottom-right" />
          </ConvexClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
