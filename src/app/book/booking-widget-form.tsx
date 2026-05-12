"use client";

import { useState, useTransition } from "react";
import { submitWidgetBooking } from "./actions";

type Service = { id: string; name: string; category: string; duration_minutes: number; price: number | null };

type Props = {
  orgColor: string;
  garageName: string;
  services: Service[];
  privacyPolicyUrl?: string | null;
};

function defaultDateTime() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

const INPUT = "w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-0 transition-colors disabled:opacity-50";

export function BookingWidgetForm({ orgColor, garageName, services, privacyPolicyUrl }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await submitWidgetBooking(formData);
      if ("error" in result) setError(result.error);
      else setSuccess(true);
    });
  }

  if (success) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-full text-white text-2xl"
          style={{ backgroundColor: orgColor }}
        >
          ✓
        </div>
        <h2 className="text-xl font-bold text-gray-900">Booking confirmed!</h2>
        <p className="text-sm text-gray-500 max-w-xs">
          Your appointment is confirmed. Check your email for details. We look forward to seeing you!
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600">Full name *</label>
          <input name="fullName" required placeholder="John Smith" disabled={pending} className={INPUT} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600">Email *</label>
          <input name="email" type="email" required placeholder="john@example.com" disabled={pending} className={INPUT} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600">Phone</label>
          <input name="phone" type="tel" placeholder="07700 900000" disabled={pending} className={INPUT} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600">Vehicle reg</label>
          <input name="registration" placeholder="AB12 CDE" disabled={pending} className={INPUT + " font-mono uppercase"} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600">Appointment type *</label>
          <select name="type" required disabled={pending} className={INPUT}>
            {services.length > 0 ? (
              [...new Set(services.map((s) => s.category))].map((cat) => (
                <optgroup key={cat} label={cat.charAt(0).toUpperCase() + cat.slice(1)}>
                  {services.filter((s) => s.category === cat).map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}{s.price ? ` — £${s.price.toFixed(2)}` : ""}
                    </option>
                  ))}
                </optgroup>
              ))
            ) : (
              <>
                <option value="mot">MOT</option>
                <option value="service">Service</option>
                <option value="repair">Repair</option>
                <option value="diagnostic">Diagnostic</option>
                <option value="other">Other</option>
              </>
            )}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600">Preferred date & time *</label>
          <input
            name="scheduledAt"
            type="datetime-local"
            required
            defaultValue={defaultDateTime()}
            disabled={pending}
            className={INPUT}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-gray-600">Notes</label>
        <textarea
          name="notes"
          rows={3}
          placeholder="Anything we should know? e.g. 'grinding noise from front brakes'"
          disabled={pending}
          className={INPUT + " resize-none"}
        />
      </div>

      <label className="flex items-start gap-2 text-xs text-gray-600">
        <input
          type="checkbox"
          name="marketingConsent"
          className="mt-0.5 h-4 w-4 rounded border-gray-300"
        />
        <span>
          I agree to receive marketing communications from {garageName} (offers, news). You can opt out anytime.
          We&apos;ll always send transactional updates about your booking.
        </span>
      </label>

      {privacyPolicyUrl && (
        <p className="text-xs text-gray-500">
          By submitting, you agree to our{" "}
          <a href={privacyPolicyUrl} target="_blank" rel="noopener noreferrer" className="underline">
            privacy policy
          </a>.
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-lg py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        style={{ backgroundColor: orgColor }}
      >
        {pending ? "Sending request…" : "Request appointment"}
      </button>

      <p className="text-center text-xs text-gray-400">
        Powered by{" "}
        <span className="font-medium text-gray-500">AI Garage</span>
      </p>
    </form>
  );
}
