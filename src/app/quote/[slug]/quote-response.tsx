"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { approveQuote, declineQuote } from "./actions";

type Stage = "idle" | "decline-form" | "submitting" | "approved" | "declined" | "error";

export function QuoteResponse({
  slug,
  token,
  primaryColor,
}: {
  slug: string;
  token: string;
  primaryColor: string;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleApprove() {
    if (!confirm("Approve this quote? The work will be added to your job and invoiced when complete.")) return;
    setError(null);
    setStage("submitting");
    startTransition(async () => {
      const result = await approveQuote(slug, token);
      if ("error" in result) {
        setError(result.error);
        setStage("error");
        return;
      }
      setStage("approved");
    });
  }

  function handleDeclineSubmit() {
    setError(null);
    setStage("submitting");
    startTransition(async () => {
      const result = await declineQuote(slug, token, reason.trim() || null);
      if ("error" in result) {
        setError(result.error);
        setStage("error");
        return;
      }
      setStage("declined");
    });
  }

  if (stage === "approved") {
    return (
      <section className="rounded-lg border bg-green-50 p-6 text-center">
        <Check className="h-10 w-10 mx-auto text-green-600 mb-2" />
        <h2 className="text-lg font-semibold">Quote approved</h2>
        <p className="text-sm text-slate-600 mt-1">
          We&rsquo;ll continue with the work and let you know when it&rsquo;s ready. Payment will be requested when the job is complete.
        </p>
      </section>
    );
  }

  if (stage === "declined") {
    return (
      <section className="rounded-lg border bg-slate-100 p-6 text-center">
        <X className="h-10 w-10 mx-auto text-slate-600 mb-2" />
        <h2 className="text-lg font-semibold">Quote declined</h2>
        <p className="text-sm text-slate-600 mt-1">
          Thanks for letting us know. We won&rsquo;t do the extra work — your job will be completed as originally booked.
        </p>
      </section>
    );
  }

  if (stage === "decline-form") {
    return (
      <section className="rounded-lg border bg-white p-4 flex flex-col gap-3">
        <h2 className="text-sm font-medium">Why are you declining? (optional)</h2>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Too expensive right now, or I want a second opinion."
          rows={3}
          disabled={pending}
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleDeclineSubmit}
            disabled={pending}
            className="flex-1 rounded-md bg-slate-800 text-white px-4 py-3 text-sm font-medium disabled:opacity-50"
          >
            {pending ? "Sending…" : "Confirm decline"}
          </button>
          <button
            type="button"
            onClick={() => setStage("idle")}
            disabled={pending}
            className="rounded-md border px-4 py-3 text-sm font-medium disabled:opacity-50"
          >
            Back
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        onClick={handleApprove}
        disabled={pending}
        className="w-full rounded-md text-white px-4 py-4 text-base font-semibold disabled:opacity-50"
        style={{ background: primaryColor }}
      >
        {pending && stage === "submitting" ? "Sending…" : "✓ Approve & continue work"}
      </button>
      <button
        type="button"
        onClick={() => setStage("decline-form")}
        disabled={pending}
        className="w-full rounded-md border bg-white px-4 py-3 text-sm font-medium text-slate-700 disabled:opacity-50"
      >
        Decline — don&rsquo;t do the extra work
      </button>
      {error && <p className="text-sm text-red-600 text-center">{error}</p>}
    </section>
  );
}
