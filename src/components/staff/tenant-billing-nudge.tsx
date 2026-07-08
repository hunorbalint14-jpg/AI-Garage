"use client";

import { useState } from "react";
import Link from "next/link";
import { CreditCard, TriangleAlert, X } from "lucide-react";

export type BillingNudgeReason = "trial_ending" | "trial_ended" | "grace" | "lapsed";

// Owner banner for the billing lifecycle (docs/billing-lapse-policy.md).
// "trial_ending" is a soft, dismissible heads-up (in-memory dismiss, returns on
// a full reload, mirroring MfaNudge). The other three are persistent — premium
// features are (about to be) off and only the owner can fix it, so there is no
// dismiss until billing is back in good standing.
export function TenantBillingNudge({ reason, date }: { reason: BillingNudgeReason; date?: string | null }) {
  const [show, setShow] = useState(true);
  if (!show) return null;

  const dismissible = reason === "trial_ending";

  const message =
    reason === "trial_ending"
      ? `Your Pro trial ends${date ? ` on ${date}` : " soon"}. Pick a plan to keep the extra features.`
      : reason === "trial_ended"
        ? "Your Pro trial has ended, so your account is on Starter features. Pick a plan to switch them back on — nothing has been deleted."
        : reason === "grace"
          ? `Your AI Garage payment failed. Update your card${date ? ` by ${date}` : ""} to keep your plan's features.`
          : "Your AI Garage subscription has lapsed, so your account is on Starter features and the 2% platform fee. Jobs, invoices and payments are unaffected — pick a plan to restore your features.";

  const tone =
    reason === "lapsed"
      ? "border-red-500/30 bg-red-500/10 text-red-200"
      : "border-amber-500/30 bg-amber-500/10 text-amber-200";
  const iconTone = reason === "lapsed" ? "text-red-400" : "text-amber-400";
  const linkTone =
    reason === "lapsed"
      ? "text-red-100 hover:text-white"
      : "text-amber-100 hover:text-white";

  const Icon = reason === "lapsed" ? TriangleAlert : CreditCard;

  return (
    <div className={`mb-6 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${tone}`}>
      <Icon className={`h-5 w-5 shrink-0 ${iconTone}`} />
      <span className="flex-1 leading-snug">
        {message}{" "}
        <Link
          href="/staff/settings/billing"
          className={`font-semibold underline underline-offset-2 ${linkTone}`}
        >
          Manage billing
        </Link>
      </span>
      {dismissible && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setShow(false)}
          className="shrink-0 rounded p-1 text-amber-300/70 transition-colors hover:text-amber-100"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
