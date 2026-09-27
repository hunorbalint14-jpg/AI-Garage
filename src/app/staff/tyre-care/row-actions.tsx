"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { dismissTyreRecommendation, reopenTyreRecommendation } from "./actions";

// Row actions for the tyre-care review queue (#596 PR 4). Dismissal asks for a
// reason — quick picks cover the common ones, and "Wait for MOT" is the spec's
// bundle_with_mot: hold the nudge so it rides along with the MOT reminder.

const REASONS = [
  { value: "Wait for MOT", label: "Wait for MOT" },
  { value: "Already done elsewhere", label: "Already done elsewhere" },
  { value: "Customer not interested", label: "Customer not interested" },
  { value: "Evidence looks wrong", label: "Evidence looks wrong" },
];

export function TyreCareRowActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState(REASONS[0].value);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<{ error: string } | { success: true }>) {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if ("error" in res) return setError(res.error);
    setDismissing(false);
    router.refresh();
  }

  if (status === "dismissed") {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button variant="outline" size="sm" onClick={() => run(() => reopenTyreRecommendation(id))} loading={busy}>
          Reopen
        </Button>
        {error && <p className="text-xs text-ws-red">{error}</p>}
      </div>
    );
  }

  if (status !== "pending_review") return null;

  return (
    <div className="flex flex-col items-end gap-1.5">
      {dismissing ? (
        <div className="flex items-center gap-1.5">
          <select
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            className="rounded-md border bg-background px-2 py-1 text-xs"
          >
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={() => run(() => dismissTyreRecommendation(id, reason))} loading={busy}>
            Dismiss
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDismissing(false)} disabled={busy}>
            ✕
          </Button>
        </div>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setDismissing(true)} disabled={busy}>
          Dismiss
        </Button>
      )}
      {error && <p className="text-xs text-ws-red">{error}</p>}
    </div>
  );
}
