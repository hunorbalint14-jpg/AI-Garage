"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveQuoteAsOwner, declineQuoteAsOwner } from "../actions";

// Owner-authenticated approve / decline for a pending quote in the portal.
// Calls the isolated owner actions (no token). On a deposit-required approval
// the action returns a Stripe Checkout URL and we redirect to it.
export function QuoteResponseOwner({ quoteId, orgColor }: { quoteId: string; orgColor: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function approve() {
    setError(null);
    startTransition(async () => {
      const res = await approveQuoteAsOwner(quoteId);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      if (res.depositUrl) {
        window.location.href = res.depositUrl;
        return;
      }
      router.refresh();
    });
  }

  function decline() {
    setError(null);
    startTransition(async () => {
      const res = await declineQuoteAsOwner(quoteId, reason.trim() || null);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</p>}

      {!declining ? (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={approve}
            disabled={pending}
            className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
            style={{ backgroundColor: orgColor }}
          >
            {pending ? "Working…" : "Approve quote"}
          </button>
          <button
            type="button"
            onClick={() => setDeclining(true)}
            disabled={pending}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-gray-300 transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            Decline
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <label className="text-sm font-medium text-gray-300" htmlFor="decline-reason">
            Let the garage know why (optional)
          </label>
          <textarea
            id="decline-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={1000}
            className="w-full rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
            placeholder="e.g. I'd like to think about it"
          />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={decline}
              disabled={pending}
              className="flex-1 rounded-xl bg-red-500/80 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-50"
            >
              {pending ? "Working…" : "Confirm decline"}
            </button>
            <button
              type="button"
              onClick={() => setDeclining(false)}
              disabled={pending}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-gray-300 transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
