"use client";

import { useMemo, useState, useTransition } from "react";
import { AigSpinner } from "@/components/ui/aig-spinner";
import { SlotPicker } from "@/components/slot-picker";
import { submitWidgetBooking } from "./actions";
import { lookupRegistration, type RegLookupResult } from "./lookup-actions";
import type { WeeklyHours, SpecialHours } from "@/lib/business-hours";

// Public booking widget as a 3-step flow (UX review §1h): the two decisions
// that matter — what service, when — each get a step, and step 3 only offers
// times that exist (SlotPicker + getAvailableSlots). The free datetime-local
// and its after-the-fact "we're closed then" scolding are gone; the server
// still re-validates as the race-condition guard.

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
  // Kept for prop-compat with the page (the header hours line uses them);
  // the slot grid itself asks the server per branch.
  weeklyByLocation: Record<string, WeeklyHours>;
  specialByLocation: Record<string, SpecialHours[]>;
  defaultLocationId: string;
  privacyPolicyUrl?: string | null;
  prefill: Prefill;
  paymentsEnabled: boolean;
  fromQuoteSlug?: string | null;
  fromQuoteToken?: string | null;
};

const INPUT =
  "w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-0 transition-colors disabled:opacity-50";

function fmtGbp(n: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

function slotLong(v: string): string {
  const d = new Date(v);
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, ${v.slice(11, 16)}`;
}

const STEPS = ["Vehicle", "Service", "Time"] as const;

function Stepper({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2" aria-label={`Step ${current + 1} of 3`}>
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          {i > 0 && <span className="h-px w-5 bg-gray-200 sm:w-8" aria-hidden />}
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] ${
              i < current
                ? "text-green-600"
                : i === current
                  ? "bg-gray-900 text-white"
                  : "text-gray-400"
            }`}
          >
            {i + 1} {label}
            {i < current ? " ✓" : ""}
          </span>
        </div>
      ))}
    </div>
  );
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
  const [step, setStep] = useState(0);
  const [locationId, setLocationId] = useState<string>(defaultLocationId);
  const services = useMemo(
    () => servicesByLocation[locationId] ?? [],
    [servicesByLocation, locationId],
  );
  const [serviceId, setServiceId] = useState<string>("");
  // Naive "YYYY-MM-DDTHH:mm" from the slot grid — same shape the action expects.
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);

  // Switching branch re-points the services list and resets service + slot
  // (availability differs per branch).
  function onBranchChange(next: string) {
    setLocationId(next);
    setServiceId("");
    setScheduledAt(null);
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
    if (!scheduledAt) return;
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
  const vehicleDesc = vehicle
    ? [vehicle.colour, vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") ||
      vehicle.registration
    : null;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {fromQuoteSlug && fromQuoteToken && (
        <>
          <input type="hidden" name="fromQuoteSlug" value={fromQuoteSlug} />
          <input type="hidden" name="fromQuoteToken" value={fromQuoteToken} />
        </>
      )}
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="registration" value={reg} />
      <input type="hidden" name="serviceId" value={serviceId} />
      <input type="hidden" name="scheduledAt" value={scheduledAt ?? ""} />

      <Stepper current={step} />

      {/* Steps stay mounted (hidden) so their state survives navigation and
          the card height stays stable inside embedded iframes. */}
      <div className="min-h-[300px]">
        {/* ── Step 1 · Vehicle ─────────────────────────────────────────── */}
        <div className={step === 0 ? "flex flex-col gap-3" : "hidden"}>
          {prefill ? (
            <div className="rounded-lg border border-black/10 bg-gray-50 px-3 py-2 text-xs text-gray-600">
              Booking as{" "}
              <span className="font-semibold text-gray-900">{prefill.fullName || prefill.email}</span>
              {prefill.email && <span className="text-gray-500"> · {prefill.email}</span>}
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

          {locations.length > 1 && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">Branch *</label>
              <select
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
          )}

          {/* Reg first — least typing, instant "we know your car" trust signal */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">Vehicle registration</label>
            <div className="flex gap-2">
              <input
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
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="whitespace-nowrap rounded-[3px] border border-[#c9a435] bg-[#f4d35e] px-2 py-0.5 font-mono text-xs font-bold tracking-[0.06em] text-[#0e1014]">
                  {vehicle.registration}
                </span>
                <span
                  className="rounded-lg border px-2.5 py-1 text-xs font-semibold text-gray-900"
                  style={{ borderColor: `${orgColor}40`, backgroundColor: `${orgColor}10` }}
                >
                  {vehicleDesc} ✓ DVLA
                </span>
                {vehicle.motExpiry && motDueDays !== null && (
                  <span className="text-xs text-gray-600">
                    MOT due in {motDueDays < 0 ? "the past — book now" : `${motDueDays}d`}
                  </span>
                )}
              </div>
            )}
            {lookupError && <p className="text-xs text-gray-500">{lookupError}</p>}
          </div>

          <button
            type="button"
            onClick={() => setStep(1)}
            className="mt-1 rounded-lg py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: orgColor }}
          >
            Continue →
          </button>
        </div>

        {/* ── Step 2 · Service ─────────────────────────────────────────── */}
        <div className={step === 1 ? "flex flex-col gap-2" : "hidden"}>
          {services.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">
              No services are bookable online right now — please call {garageName}.
            </p>
          ) : (
            [...new Set(services.map((s) => s.category))].map((cat) => (
              <div key={cat} className="flex flex-col gap-1.5">
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </p>
                {services
                  .filter((s) => s.category === cat)
                  .map((s) => {
                    const active = s.id === serviceId;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setServiceId(s.id);
                          setScheduledAt(null);
                          setStep(2);
                        }}
                        aria-pressed={active}
                        className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors hover:bg-gray-50"
                        style={
                          active
                            ? { borderColor: orgColor, backgroundColor: `${orgColor}10` }
                            : { borderColor: "rgba(0,0,0,0.12)" }
                        }
                      >
                        <span className="font-medium text-gray-900">{s.name}</span>
                        <span className="shrink-0 text-gray-600">
                          {s.price ? fmtGbp(s.price) : "Quote on arrival"}
                        </span>
                      </button>
                    );
                  })}
              </div>
            ))
          )}
          <button
            type="button"
            onClick={() => setStep(0)}
            className="mt-1 self-start text-xs text-gray-500 underline hover:text-gray-700"
          >
            ← Back
          </button>
        </div>

        {/* ── Step 3 · Time (+ contact for signed-out visitors) ────────── */}
        <div className={step === 2 ? "flex flex-col gap-4" : "hidden"}>
          {/* Mounting the picker only from step 3 avoids fetching availability
              for visitors who never get this far. */}
          {step === 2 && (
            <SlotPicker
              locationId={locationId}
              durationMinutes={selectedService?.duration_minutes || 60}
              value={scheduledAt}
              onChange={setScheduledAt}
              theme="light"
              primaryColor={orgColor}
            />
          )}

          {!lockContact && (
            <>
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
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">Phone</label>
                <input name="phone" type="tel" placeholder="07700 900000" disabled={pending} className={INPUT} />
              </div>
            </>
          )}
          {lockContact && (
            <>
              <input type="hidden" name="fullName" value={prefill!.fullName} />
              <input type="hidden" name="email" value={prefill!.email} />
              <input type="hidden" name="phone" value={prefill!.phone} />
            </>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">Notes</label>
            <textarea
              name="notes"
              rows={2}
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
                Send me offers and news from {garageName}. You can opt out anytime — booking
                updates always arrive.
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

          {/* Server rejections (e.g. a slot taken in a race) land here, right
              by the grid, instead of a paragraph-long scolding. */}
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}

          {/* The CTA always repeats the choice — never a generic "Request
              appointment"; disabled until a slot is picked. */}
          <button
            type="submit"
            disabled={pending || !scheduledAt || !serviceId}
            className="inline-flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: orgColor }}
          >
            {pending && <AigSpinner />}
            {pending
              ? willPayNow
                ? "Redirecting to payment…"
                : "Booking…"
              : !scheduledAt
                ? "Pick a time above"
                : willPayNow
                  ? `Pay ${fmtGbp(selectedService?.price ?? 0)} — ${slotLong(scheduledAt)}`
                  : `Confirm — ${slotLong(scheduledAt)}`}
          </button>

          <button
            type="button"
            onClick={() => setStep(1)}
            className="self-start text-xs text-gray-500 underline hover:text-gray-700"
          >
            ← Back
          </button>
        </div>
      </div>

      <p className="text-center text-xs text-gray-400">
        Powered by <span className="font-medium text-gray-500">AI Garage</span>
      </p>
    </form>
  );
}
