"use client";

import { useState, useTransition } from "react";
import { acceptPlanInvite } from "./actions";
import type { PlanInterval } from "@/lib/service-plans";

export function SubscribeButtons({
  slug,
  token,
  orgColor,
  monthly,
  annual,
}: {
  slug: string;
  token: string;
  orgColor: string;
  monthly: string | null;
  annual: string | null;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go(interval: PlanInterval) {
    setError(null);
    start(async () => {
      const res = await acceptPlanInvite(slug, token, interval);
      if ("error" in res) setError(res.error);
      else window.location.href = res.url;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        {monthly && (
          <button
            onClick={() => go("month")}
            disabled={pending}
            className="rounded-xl px-6 py-3 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60 shadow-lg"
            style={{ backgroundColor: orgColor, boxShadow: `0 12px 24px -8px ${orgColor}60` }}
          >
            {pending ? "…" : `Subscribe ${monthly}/mo`}
          </button>
        )}
        {annual && (
          <button
            onClick={() => go("year")}
            disabled={pending}
            className="rounded-xl border border-white/15 bg-white/5 px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-60"
          >
            {pending ? "…" : `${annual}/yr`}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
