"use client";

import { useMemo, useState, useTransition } from "react";
import { requestBooking } from "./actions";

type Vehicle = { id: string; registration: string; make: string | null; model: string | null };

type Service = {
  id: string;
  name: string;
  category: string;
  duration_minutes: number;
  price: number | null;
};

// Per-service plan coverage computed server-side (display-only). Absent service
// id ⇒ full walk-in price.
export type ServiceCoverage = {
  kind: "covered" | "discount";
  chargePence: number;
  label: string;
};

type Props = {
  vehicles: Vehicle[];
  // Branch picker drives the services list: each branch's active services keyed
  // by location id, plus the landing branch.
  locations: { id: string; name: string }[];
  servicesByLocation: Record<string, Service[]>;
  defaultLocationId: string;
  orgColor: string;
  paymentsEnabled: boolean;
  coverageByServiceId: Record<string, ServiceCoverage>;
};

function defaultDateTime() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function fmtGbp(n: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

export function BookingRequestForm({ vehicles, locations, servicesByLocation, defaultLocationId, orgColor, paymentsEnabled, coverageByServiceId }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [locationId, setLocationId] = useState<string>(defaultLocationId);
  const services = useMemo(
    () => servicesByLocation[locationId] ?? [],
    [servicesByLocation, locationId],
  );
  const [serviceId, setServiceId] = useState<string>(services[0]?.id ?? "");

  // Switching branch re-points the services list and resets the chosen service.
  function onBranchChange(next: string) {
    setLocationId(next);
    const list = servicesByLocation[next] ?? [];
    setServiceId(list[0]?.id ?? "");
  }

  const selectedService = useMemo(
    () => services.find((s) => s.id === serviceId) ?? null,
    [services, serviceId],
  );
  const coverage = serviceId ? coverageByServiceId[serviceId] : undefined;
  const walkInPence = selectedService?.price ? Math.round(selectedService.price * 100) : 0;
  // Coverage (covered → £0, discount → member price) wins over the walk-in price.
  const chargePence = coverage ? coverage.chargePence : walkInPence;
  const willPayNow = paymentsEnabled && chargePence > 0;

  const inputClass =
    "w-full rounded-xl border border-white/15 bg-[#0d1525] px-3 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-white/30 transition-colors [&>option]:bg-[#0d1525] [&>option]:text-white";

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await requestBooking(formData);
      if ("error" in result) {
        setError(result.error);
      } else if ("paymentUrl" in result && result.paymentUrl) {
        window.location.href = result.paymentUrl;
      } else {
        setSuccess(true);
      }
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
          onClick={() => (window.location.href = "/dashboard")}
          className="mt-6 rounded-xl px-4 py-2 text-sm font-medium border border-white/10 bg-white/5 text-white hover:bg-white/10 transition-colors"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {locations.length > 1 ? (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Branch</label>
          <select
            name="locationId"
            disabled={pending}
            value={locationId}
            onChange={(e) => onBranchChange(e.target.value)}
            className={inputClass}
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
      ) : (
        <input type="hidden" name="locationId" value={locationId} />
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Vehicle</label>
        <select name="vehicleId" disabled={pending} className={inputClass}>
          <option value="">— No specific vehicle —</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.registration}
              {v.make || v.model ? ` — ${[v.make, v.model].filter(Boolean).join(" ")}` : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Appointment type</label>
        <select
          name="serviceId"
          required
          disabled={pending}
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
          className={inputClass}
        >
          {services.length > 0 ? (
            [...new Set(services.map((s) => s.category))].map((cat) => (
              <optgroup key={cat} label={cat.charAt(0).toUpperCase() + cat.slice(1)}>
                {services
                  .filter((s) => s.category === cat)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.price ? ` — ${fmtGbp(s.price)}` : ""}
                    </option>
                  ))}
              </optgroup>
            ))
          ) : (
            <option value="">No services available</option>
          )}
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

      {coverage?.kind === "covered" && selectedService && (
        <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-3 py-2.5 text-sm">
          <p className="font-semibold text-green-400">{coverage.label}</p>
          <p className="mt-0.5 text-xs text-gray-400">
            No payment needed — this appointment is covered by your plan.
          </p>
        </div>
      )}

      {willPayNow && selectedService && (
        <div
          className="rounded-xl border px-3 py-2.5 text-sm"
          style={{ borderColor: `${orgColor}55`, backgroundColor: `${orgColor}18` }}
        >
          <p className="font-semibold" style={{ color: orgColor }}>
            Pay {fmtGbp(chargePence / 100)} now to confirm
          </p>
          {coverage?.kind === "discount" && walkInPence > chargePence && (
            <p className="mt-0.5 text-xs text-green-400">
              {coverage.label} — was {fmtGbp(walkInPence / 100)}
            </p>
          )}
          <p className="text-xs text-gray-400 mt-0.5">
            Secure card payment via Stripe. Your booking is held once payment succeeds.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={pending || services.length === 0}
        className="mt-2 rounded-xl py-3 text-sm font-semibold text-white transition-all disabled:opacity-50"
        style={{ backgroundColor: orgColor }}
      >
        {pending
          ? willPayNow
            ? "Redirecting to payment…"
            : "Submitting…"
          : willPayNow
          ? `Pay ${fmtGbp(chargePence / 100)} and book`
          : "Request appointment"}
      </button>
    </form>
  );
}
