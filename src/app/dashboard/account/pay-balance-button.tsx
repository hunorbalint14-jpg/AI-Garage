"use client";

import { useState, useTransition } from "react";
import { payBalanceCheckout } from "./actions";

// "Pay balance" → Stripe checkout (#504 follow-up). The action redirects to
// Stripe on success; errors surface inline.
export function PayBalanceButton({ amountLabel, accent }: { amountLabel: string; accent: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go() {
    setError(null);
    startTransition(async () => {
      const res = await payBalanceCheckout();
      // redirect() throws internally on success — reaching here means error.
      if (res && "error" in res) setError(res.error);
    });
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        style={{ backgroundColor: accent }}
      >
        {pending ? "Opening secure payment…" : `Pay ${amountLabel} by card`}
      </button>
      <span className="text-xs text-gray-500">Secure card payment via Stripe · spreads across your oldest invoices first</span>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
