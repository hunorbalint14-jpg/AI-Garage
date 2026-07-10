"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { dismissDeferred, recoverDeferred, reopenDeferred } from "./actions";

// Row lifecycle actions for the deferred-work pipeline (#498 PR 4).
// Dismiss expands an inline reason input; recover/reopen are one tap.

export function DeferredRowActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<{ error: string } | { success: true }>) {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if ("error" in res) return setError(res.error);
    setDismissing(false);
    setReason("");
    router.refresh();
  }

  if (status !== "open") {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button variant="outline" size="sm" onClick={() => run(() => reopenDeferred(id))} loading={busy}>
          Reopen
        </Button>
        {error && <p className="text-xs text-ws-red">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {dismissing ? (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run(() => dismissDeferred(id, reason))}
            placeholder="Reason (optional)"
            className="w-40 rounded-md border bg-transparent px-2 py-1 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            disabled={busy}
          />
          <Button size="sm" variant="outline" onClick={() => run(() => dismissDeferred(id, reason))} loading={busy}>
            Confirm
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDismissing(false)} disabled={busy}>
            ✕
          </Button>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" onClick={() => run(() => recoverDeferred(id))} loading={busy}>
            Mark recovered
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDismissing(true)} disabled={busy}>
            Dismiss
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-ws-red">{error}</p>}
    </div>
  );
}
