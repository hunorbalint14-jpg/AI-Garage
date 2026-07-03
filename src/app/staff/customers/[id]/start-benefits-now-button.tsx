"use client";

import { useState, useTransition } from "react";
import { markPlanBenefitsStartNow } from "./plan-invite-actions";
import { useConfirm } from "@/components/confirm-provider";

// Staff override for the §3.1 onboarding gate: bring a membership's
// benefits_start_at forward to now (use when the customer was enrolled right
// after a service + MOT). Covered draws stay gated by funding.
export function StartBenefitsNowButton({ subscriptionId }: { subscriptionId: string }) {
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) return <p className="text-xs text-green-700">Benefits now active (funding permitting).</p>;

  async function go() {
    const ok = await confirm({
      title: "Start plan benefits now?",
      description: "Use only when the customer was just enrolled after a full service + MOT. Covered draws stay gated by funding.",
      confirmLabel: "Start benefits",
    });
    if (!ok) return;
    setError(null);
    start(async () => {
      const res = await markPlanBenefitsStartNow(subscriptionId);
      if ("error" in res) setError(res.error);
      else setDone(true);
    });
  }

  return (
    <div>
      <button
        onClick={go}
        disabled={pending}
        className="text-xs font-medium text-blue-700 underline transition-colors hover:text-blue-900 disabled:opacity-60"
      >
        {pending ? "Starting…" : "Start benefits now"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
