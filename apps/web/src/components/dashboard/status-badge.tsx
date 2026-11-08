import { cn } from "@/lib/utils";
import type { StreamDoc } from "@/lib/types";

const STYLES: Record<StreamDoc["status"], { label: string; dot: string; text: string }> = {
  starting: { label: "starting", dot: "bg-amber-400", text: "text-amber-200" },
  live: { label: "live", dot: "bg-[#eb0400]", text: "text-white" },
  offline: { label: "offline", dot: "bg-zinc-400", text: "text-zinc-300" },
  error: { label: "error", dot: "bg-orange-500", text: "text-orange-200" },
  stopped: { label: "stopped", dot: "bg-zinc-600", text: "text-zinc-400" },
};

export function StatusBadge({ status, className }: { status: StreamDoc["status"]; className?: string }) {
  const s = STYLES[status] ?? STYLES.offline;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide uppercase",
        s.text,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}
