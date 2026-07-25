"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-provider";
import { goLive } from "./actions";

// Going live is one-way from the UI, and the first thing it does is message
// real customers — so the confirm spells out the volume rather than asking a
// vague "are you sure?".
export function GoLiveButton({
  locationName,
  pending,
  firstDayCap,
  canGoLive,
}: {
  locationName: string;
  pending: number;
  /** Null = no first-day limit. */
  firstDayCap: number | null;
  canGoLive: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handle() {
    const ok = await confirm({
      title: `Take ${locationName} live?`,
      description:
        pending > 0
          ? `${pending} message${pending === 1 ? "" : "s"} will start going to real customers from the next scheduled run` +
            (firstDayCap != null && pending > firstDayCap
              ? `, up to ${firstDayCap} on the first day and the rest over the following runs.`
              : ".") +
            " This can't be undone from here."
          : "Automatic messages to customers start from the next scheduled run. This can't be undone from here.",
      confirmLabel: "Go live",
    });
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const res = await goLive();
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button onClick={handle} loading={busy} disabled={!canGoLive}>
          <Radio className="mr-1.5 h-4 w-4" /> Go live
        </Button>
      </div>
      {!canGoLive && (
        <p className="text-xs text-muted-foreground">Only the account owner can take a branch live.</p>
      )}
      {error && <p className="text-sm text-ws-red">{error}</p>}
    </div>
  );
}
