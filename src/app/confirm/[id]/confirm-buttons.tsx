"use client";

import { useState, useTransition } from "react";
import { confirmBooking, requestReschedule } from "./actions";

type Props = {
  bookingId: string;
  token: string;
  accent: string;
  initialConfirmed: boolean;
  initialRescheduleRequested: boolean;
};

type State = "idle" | "confirmed" | "reschedule_requested";

export function ConfirmButtons({
  bookingId,
  token,
  accent,
  initialConfirmed,
  initialRescheduleRequested,
}: Props) {
  const [state, setState] = useState<State>(
    initialConfirmed ? "confirmed" : initialRescheduleRequested ? "reschedule_requested" : "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await confirmBooking(bookingId, token);
      if ("error" in result) setError(result.error);
      else setState("confirmed");
    });
  }

  function handleReschedule() {
    setError(null);
    startTransition(async () => {
      const result = await requestReschedule(bookingId, token);
      if ("error" in result) setError(result.error);
      else setState("reschedule_requested");
    });
  }

  if (state === "confirmed") {
    return (
      <div className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4">
        <p className="text-sm font-medium text-green-800">You&apos;re confirmed — see you then!</p>
        <p className="mt-1 text-xs text-green-700">
          Plans changed?{" "}
          <button onClick={handleReschedule} disabled={pending} className="underline">
            Request a different time
          </button>
        </p>
      </div>
    );
  }

  if (state === "reschedule_requested") {
    return (
      <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-medium text-amber-800">Reschedule requested</p>
        <p className="mt-1 text-xs text-amber-700">
          The garage will be in touch to find a better time. If it suits you after all, you can{" "}
          <button onClick={handleConfirm} disabled={pending} className="underline">
            keep the original slot
          </button>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-2">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        onClick={handleConfirm}
        disabled={pending}
        className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        style={{ backgroundColor: accent }}
      >
        {pending ? "One moment…" : "Confirm booking"}
      </button>
      <button
        onClick={handleReschedule}
        disabled={pending}
        className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 disabled:opacity-60"
      >
        I need a different time
      </button>
    </div>
  );
}
