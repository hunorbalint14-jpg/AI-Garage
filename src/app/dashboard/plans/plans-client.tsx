"use client";

import { useState, useTransition } from "react";
import { subscribeToPlan, cancelSubscription } from "./actions";
import type { PlanInterval } from "@/lib/service-plans";

export function SubscribeButtons({
  planId,
  orgColor,
  monthly,
  annual,
}: {
  planId: string;
  orgColor: string;
  monthly: string | null;
  annual: string | null;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go(interval: PlanInterval) {
    setError(null);
    start(async () => {
      const res = await subscribeToPlan(planId, interval);
      if ("error" in res) setError(res.error);
      else window.location.href = res.url;
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {monthly && (
          <button
            onClick={() => go("month")}
            disabled={pending}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: orgColor }}
          >
            {pending ? "…" : `Subscribe ${monthly}/mo`}
          </button>
        )}
        {annual && (
          <button
            onClick={() => go("year")}
            disabled={pending}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-60"
          >
            {pending ? "…" : `${annual}/yr`}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}

export function CancelButton({ subscriptionId }: { subscriptionId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function go() {
    if (!confirm("Cancel this plan at the end of the current period?")) return;
    setError(null);
    start(async () => {
      const res = await cancelSubscription(subscriptionId);
      if ("error" in res) setError(res.error);
      else setDone(true);
    });
  }

  if (done) return <p className="shrink-0 text-sm text-gray-400">Cancelling at period end.</p>;

  return (
    <div className="shrink-0 text-right">
      <button
        onClick={go}
        disabled={pending}
        className="text-sm text-gray-400 underline transition-colors hover:text-white disabled:opacity-60"
      >
        {pending ? "Cancelling…" : "Cancel plan"}
      </button>
      {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
    </div>
  );
}
