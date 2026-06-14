"use client";

import { useMemo, useState, useTransition } from "react";
import { AigSpinner } from "@/components/ui/aig-spinner";
import { submitWidgetBooking } from "./actions";
import { lookupRegistration, type RegLookupResult } from "./lookup-actions";

type Service = {
  id: string;
  name: string;
  category: string;
  duration_minutes: number;
  price: number | null;
};

type Prefill = {
  customerId: string | null;
  fullName: string;
  email: string;
  phone: string;
} | null;

type Props = {
  orgColor: string;
  garageName: string;
  // Branch picker drives the services list: each branch's active services keyed
  // by location id, plus the landing branch.
  locations: { id: string; name: string }[];
  servicesByLocation: Record<string, Service[]>;
  defaultLocationId: string;
  privacyPolicyUrl?: string | null;
  prefill: Prefill;
  paymentsEnabled: boolean;
  fromQuoteSlug?: string | null;
  fromQuoteToken?: string | null;
};

function defaultDateTime() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

const INPUT =
  "w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-0 transition-colors disabled:opacity-50";

function fmtGbp(n: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

export function BookingWidgetForm({
  orgColor,
  garageName,
  locations,
  servicesByLocation,
  defaultLocationId,
  privacyPolicyUrl,
  prefill,
  paymentsEnabled,
  fromQuoteSlug,
  fromQuoteToken,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ paid: boolean } | null>(null);
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

  // Reg-first lookup: type the plate → DVSA fills in the car + MOT due date.
  const [reg, setReg] = useState("");
  const [looking, startLookup] = useTransition();
  const [vehicle, setVehicle] = useState<Extract<RegLookupResult, { found: true }> | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  function runLookup() {
    const candidate = reg.trim();
    if (candidate.replace(/\s+/g, "").length < 2 || looking) return;
    setLookupError(null);
    setVehicle(null);
    startLookup(async () => {
      const result = await lookupRegistration(candidate);
      if (result.found) {
        setVehicle(result);
      } else {
        setLookupError(result.error ?? null);
      }
    });
  }

  const motDueDays = useMemo(() => {
    if (!vehicle?.motExpiry) return null;
    const due = new Date(`${vehicle.motExpiry}T00:00:00`);
    return Math.ceil((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  }, [vehicle]);

  const selectedService = useMemo(
    () => services.find((s) => s.id === serviceId) ?? null,
    [services, serviceId],
  );
  const willPayNow =
    paymentsEnabled && !!selectedService?.price && selectedService.price > 0;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await submitWidgetBooking(formData);
      if ("error" in result) {
        setError(result.error);
      } else if ("paymentUrl" in result && result.paymentUrl) {
        // Redirect to Stripe Checkout for prepayment.
        window.location.href = result.paymentUrl;
      } else {
        setSuccess({ paid: false });
      }
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
        {!prefill && (
          <a
            href="/register"
            className="text-sm font-semibold underline"
            style={{ color: orgColor }}
          >
            Create an account to track this booking →
          </a>
        )}
      </div>
    );
  }

  const lockContact = !!prefill;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {fromQuoteSlug && fromQuoteToken && (
        <>
          <input type="hidden" name="fromQuoteSlug" value={fromQuoteSlug} />
          <input type="hidden" name="fromQuoteToken" value={fromQuoteToken} />
        </>
      )}
      {prefill ? (
        <div
          className="rounded-lg border border-black/10 bg-gray-50 px-3 py-2 text-xs text-gray-600"
        >
          Booking as{" "}
          <span className="font-semibold text-gray-900">{prefill.fullName || prefill.email}</span>
          {prefill.email && (
            <span className="text-gray-500"> · {prefill.email}</span>
          )}
        </div>
      ) : (
        <p className="rounded-lg border border-black/10 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          Already a customer?{" "}
          <a href="/login?next=/book" className="font-semibold underline">
            Sign in
          </a>{" "}
          to skip filling these in.
        </p>
      )}

      {locations.length > 1 ? (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600">Branch *</label>
          <select
            name="locationId"
            required
            disabled={pending}
            value={locationId}
            onChange={(e) => onBranchChange(e.target.value)}
            className={INPUT}
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <input type="hidden" name="locationId" value={locationId} />
      )}

      {/* Reg first — least typing, instant "we know your car" trust signal */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-gray-600">Vehicle registration</label>
        <div className="flex gap-2">
          <input
            name="registration"
            placeholder="AB12 CDE"
            value={reg}
            onChange={(e) => {
              setReg(e.target.value.toUpperCase());
              if (vehicle) setVehicle(null);
              if (lookupError) setLookupError(null);
            }}
            onBlur={runLookup}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runLookup();
              }
            }}
            disabled={pending}
            className={INPUT + " font-mono uppercase"}
          />
          <button
            type="button"
            onClick={runLookup}
            disabled={pending || looking || reg.replace(/\s+/g, "").length < 2}
            className="shrink-0 rounded-lg border border-black/15 px-3 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            {looking ? <AigSpinner /> : "Find my car"}
          </button>
        </div>
        {vehicle && (
          <div
            className="mt-1 rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: `${orgColor}40`, backgroundColor: `${orgColor}10` }}
          >
            <p className="font-semibold text-gray-900">
              {[vehicle.colour, vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") ||
                vehicle.registration}
            </p>
            {vehicle.motExpiry && motDueDays !== null && (
              <p className="text-xs text-gray-600 mt-0.5">
                MOT due{" "}
                {new Date(`${vehicle.motExpiry}T00:00:00`).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
                {motDueDays < 0
                  ? " — it has expired. Book an MOT as soon as possible."
                  : motDueDays <= 60
                    ? ` — only ${motDueDays} day${motDueDays !== 1 ? "s" : ""} away. Good timing!`
                    : "."}
              </p>
            )}
          </div>
        )}
        {lookupError && <p className="text-xs text-gray-500">{lookupError}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600">Full name *</label>
          <input
            name="fullName"
            required
            placeholder="John Smith"
            disabled={pending || lockContact}
            defaultValue={prefill?.fullName ?? ""}
            className={INPUT}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600">Email *</label>
          <input
            name="email"
            type="email"
            required
            placeholder="john@example.com"
            disabled={pending || lockContact}
            defaultValue={prefill?.email ?? ""}
            className={INPUT}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-gray-600">Phone</label>
        <input
          name="phone"
          type="tel"
          placeholder="07700 900000"
          disabled={pending}
          defaultValue={prefill?.phone ?? ""}
          className={INPUT}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600">Appointment type *</label>
          <select
            name="serviceId"
            required
            disabled={pending}
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            className={INPUT}
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

      {willPayNow && selectedService && (
        <div
          className="rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: `${orgColor}40`, backgroundColor: `${orgColor}10` }}
        >
          <p className="font-semibold" style={{ color: orgColor }}>
            Pay {fmtGbp(selectedService.price ?? 0)} now to confirm
          </p>
          <p className="text-xs text-gray-600 mt-0.5">
            Secure card payment via Stripe. Your booking is held once payment succeeds.
          </p>
        </div>
      )}

      {!prefill && (
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
      )}

      <p className="text-xs text-gray-500">
        By submitting, you agree to our{" "}
        <a
          href={privacyPolicyUrl || "/privacy"}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          privacy policy
        </a>
        .
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={pending || services.length === 0}
        className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        style={{ backgroundColor: orgColor }}
      >
        {pending && <AigSpinner />}
        {pending
          ? willPayNow
            ? "Redirecting to payment…"
            : "Sending request…"
          : willPayNow
          ? `Pay ${fmtGbp(selectedService?.price ?? 0)} and book`
          : "Request appointment"}
      </button>

      <p className="text-center text-xs text-gray-400">
        Powered by <span className="font-medium text-gray-500">AI Garage</span>
      </p>
    </form>
  );
}
