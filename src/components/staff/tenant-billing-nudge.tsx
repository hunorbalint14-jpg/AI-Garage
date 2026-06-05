"use client";

import { useState } from "react";
import Link from "next/link";
import { CreditCard, X } from "lucide-react";

// Dismissible banner for the account owner when billing needs attention — a
// past-due subscription or a Pro trial about to end. In-memory dismiss (returns
// on a full reload), mirroring MfaNudge.
export function TenantBillingNudge({ reason, date }: { reason: "past_due" | "trial_ending"; date?: string | null }) {
  const [show, setShow] = useState(true);
  if (!show) return null;

  const message =
    reason === "past_due"
      ? "Your AI Garage payment failed. Update your card to keep your plan's features."
      : `Your Pro trial ends${date ? ` on ${date}` : " soon"}. Pick a plan to keep the extra features.`;

  return (
    <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      <CreditCard className="h-5 w-5 shrink-0 text-amber-400" />
      <span className="flex-1 leading-snug">
        {message}{" "}
        <Link
          href="/staff/settings/billing"
          className="font-semibold text-amber-100 underline underline-offset-2 hover:text-white"
        >
          Manage billing
        </Link>
      </span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setShow(false)}
        className="shrink-0 rounded p-1 text-amber-300/70 transition-colors hover:text-amber-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
