"use client";

import { useState, useTransition } from "react";
import { requestBooking } from "./actions";

type Vehicle = { id: string; registration: string; make: string | null; model: string | null };

type Props = {
  vehicles: Vehicle[];
  orgColor: string;
};

function defaultDateTime() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function BookingRequestForm({ vehicles, orgColor }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const inputClass = "w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-white/30 focus:bg-white/10 transition-colors";

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await requestBooking(formData);
      if ("error" in result) setError(result.error);
      else setSuccess(true);
    });
  }

  if (success) {
    return (
      <div className="rounded-2xl border border-green-500/30 bg-green-500/10 p-8 text-center">
        <p className="text-lg font-semibold text-green-400">Booking request sent!</p>
        <p className="mt-2 text-sm text-gray-400">
          We&apos;ve received your request and will confirm your appointment shortly.
          You should receive a confirmation shortly.
        </p>
        <button
          type="button"
          onClick={() => window.location.href = "/dashboard"}
          className="mt-6 rounded-xl px-4 py-2 text-sm font-medium border border-white/10 bg-white/5 text-white hover:bg-white/10 transition-colors"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Vehicle</label>
        <select name="vehicleId" disabled={pending} className={inputClass}>
          <option value="">— No specific vehicle —</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.registration}{v.make || v.model ? ` — ${[v.make, v.model].filter(Boolean).join(" ")}` : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Appointment type</label>
        <select name="type" disabled={pending} className={inputClass}>
          <option value="mot">MOT</option>
          <option value="service">Service</option>
          <option value="repair">Repair</option>
          <option value="diagnostic">Diagnostic</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Preferred date & time</label>
        <input
          name="scheduledAt"
          type="datetime-local"
          required
          defaultValue={defaultDateTime()}
          disabled={pending}
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Notes (optional)</label>
        <textarea
          name="notes"
          rows={3}
          placeholder="Describe what you need or any concerns..."
          disabled={pending}
          className={inputClass + " resize-none"}
        />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-xl py-3 text-sm font-semibold text-white transition-all disabled:opacity-50"
        style={{ backgroundColor: orgColor }}
      >
        {pending ? "Submitting…" : "Request appointment"}
      </button>
    </form>
  );
}
