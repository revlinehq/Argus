"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errMessage } from "@/lib/format";

export function AddStreamForm({ disabled }: { disabled?: boolean }) {
  const add = useMutation(api.streams.add);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const input = value.trim();
    if (!input) return;
    setBusy(true);
    try {
      await add({ input });
      setValue("");
      toast.success("Stream added — opening a cloud browser");
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex w-full gap-2 sm:max-w-xl">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="twitch.tv/channel, channel name, kick.com/…, youtube.com/watch?v=…"
        aria-label="Stream URL or channel"
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
      />
      <Button type="submit" disabled={disabled || busy || !value.trim()}>
        <PlusIcon />
        Add stream
      </Button>
    </form>
  );
}
