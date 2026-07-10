"use client";

import { useState } from "react";
import { respondToReauth } from "./actions";

// Customer-facing approve/decline for a re-authorisation request (#503 PR 4).

function formatGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

export function ReauthResponse({
  slug,
  token,
  primaryColor,
  total,
  garagePhone,
}: {
  slug: string;
  token: string;
  primaryColor: string;
  total: number;
  garagePhone: string | null;
}) {
  const [signedName, setSignedName] = useState("");
  const [ticked, setTicked] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"approved" | "declined" | null>(null);

  if (done) {
    return (
      <section className="rounded-lg border bg-white p-6 text-center">
        <div className="mb-2 text-4xl">{done === "approved" ? "✓" : "🙏"}</div>
        <h2 className="text-lg font-semibold">
          {done === "approved" ? "Work authorised — thank you" : "No problem"}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {done === "approved"
            ? "The garage has been notified and will continue with the work."
            : "The garage has been notified and won't carry out the extra work. They may call to talk options through."}
        </p>
      </section>
    );
  }

  async function submit(approve: boolean) {
    if (approve && !signedName.trim()) return setError("Please type your name to authorise the work.");
    if (approve && !ticked) return setError("Please tick the authorisation box to continue.");
    setBusy(true);
    setError(null);
    const res = await respondToReauth(
      slug,
      token,
      approve ? { approve: true, signedName: signedName.trim() } : { approve: false, reason: reason.trim() || null },
    );
    setBusy(false);
    if ("error" in res) return setError(res.error);
    setDone(res.approved ? "approved" : "declined");
  }

  return (
    <section className="rounded-lg border bg-white p-4 flex flex-col gap-3">
      {!declining ? (
        <>
          <input
            value={signedName}
            onChange={(e) => setSignedName(e.target.value)}
            placeholder="Type your full name to authorise"
            autoComplete="name"
            className="w-full rounded-lg border px-3 py-2.5 text-sm"
            disabled={busy}
          />
          <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={ticked}
              onChange={(e) => setTicked(e.target.checked)}
              className="mt-0.5 h-4 w-4"
              disabled={busy}
            />
            <span>
              I authorise the work at the updated total shown. My name, the date and time, and my device
              details are recorded with this authorisation.
            </span>
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={busy || !signedName.trim() || !ticked}
            className="w-full rounded-lg px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: primaryColor }}
          >
            {busy ? "Sending…" : `Approve updated total — ${formatGBP(total)}`}
          </button>
          <button
            type="button"
            onClick={() => setDeclining(true)}
            disabled={busy}
            className="w-full rounded-lg border px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Decline the increase
          </button>
        </>
      ) : (
        <>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Optional — tell the garage why (they'll call to talk it through)"
            className="w-full rounded-lg border px-3 py-2 text-sm"
            disabled={busy}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => submit(false)}
              disabled={busy}
              className="flex-1 rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Sending…" : "Confirm decline"}
            </button>
            <button
              type="button"
              onClick={() => setDeclining(false)}
              disabled={busy}
              className="rounded-lg border px-4 py-2.5 text-sm text-slate-600"
            >
              Back
            </button>
          </div>
        </>
      )}
      <p className="text-center text-xs text-slate-500">
        Questions first? Call the garage
        {garagePhone ? (
          <>
            {" "}on <a href={`tel:${garagePhone}`} className="underline">{garagePhone}</a>
          </>
        ) : null}
        {" "}— nothing extra happens until you decide.
      </p>
    </section>
  );
}
