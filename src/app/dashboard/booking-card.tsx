"use client";

import { useState, useTransition } from "react";
import { AigSpinner } from "@/components/ui/aig-spinner";
import { SlotPicker } from "@/components/slot-picker";
import { cancelCustomerBooking, rescheduleCustomerBooking } from "./booking-actions";
import { useConfirm } from "@/components/confirm-provider";

type Booking = {
  id: string;
  scheduled_at: string;
  type: string;
  status: string;
  duration_minutes: number;
  vehicle: { registration: string } | null;
  location: { id: string; name: string; address: string | null } | null;
};

type Props = {
  booking: Booking;
  orgColor: string;
  garagePhone: string | null;
};

function typeLabel(t: string) {
  return t === "mot" ? "MOT" : t.charAt(0).toUpperCase() + t.slice(1);
}

export function BookingCard({ booking, orgColor, garagePhone }: Props) {
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"idle" | "reschedule">("idle");
  // SlotPicker value — naive "YYYY-MM-DDTHH:mm", same shape the action expects.
  const [newDateTime, setNewDateTime] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  // Self-serve changes only make sense before work starts — once the booking is
  // in progress (or beyond), cancelling would orphan the job on the workshop
  // side, so the actions give way to a "call us" hint.
  const actionable = booking.status === "scheduled";
  const unpaid = booking.status === "payment_pending";

  async function handleCancel() {
    const ok = await confirm({
      title: "Cancel this appointment?",
      description: "The garage is notified and the slot is released. You can book again any time.",
      confirmLabel: "Cancel appointment",
      cancelLabel: "Keep appointment",
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const result = await cancelCustomerBooking(booking.id);
      if ("error" in result) setError(result.error);
      else setCancelled(true);
    });
  }

  function handleReschedule() {
    if (!newDateTime) return;
    setError(null);
    startTransition(async () => {
      const result = await rescheduleCustomerBooking(booking.id, newDateTime);
      if ("error" in result) setError(result.error);
      else setMode("idle");
    });
  }

  if (cancelled) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-sm opacity-50">
        <p className="text-sm text-gray-400 line-through">
          {typeLabel(booking.type)} — {new Date(booking.scheduled_at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
        </p>
        <p className="text-xs text-gray-500 mt-1">Cancelled</p>
      </div>
    );
  }

  const branchLine = [booking.location?.name, booking.location?.address].filter(Boolean).join(", ");

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold">
            {typeLabel(booking.type)} ·{" "}
            {new Date(booking.scheduled_at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          </p>
          <p className="text-sm text-gray-400 mt-0.5">
            {booking.vehicle ? (
              booking.vehicle.registration
            ) : (
              <span className="text-gray-500">No vehicle on file</span>
            )}
            {branchLine && ` · ${branchLine}`}
          </p>
        </div>
        {unpaid ? (
          <span className="shrink-0 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-semibold text-amber-400">
            Unpaid
          </span>
        ) : (
          <span
            className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{ backgroundColor: `${orgColor}25`, color: orgColor }}
          >
            {booking.status === "in_progress" ? "In progress" : "Confirmed"}
          </span>
        )}
      </div>

      {/* Abandoned Stripe checkout: the appointment is reserved but unpaid —
          the pay route reuses or regenerates the checkout session. Self-serve
          changes stay hidden until it's paid. */}
      {unpaid && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <a
            href={`/book/${booking.id}/pay`}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: orgColor }}
          >
            Complete payment →
          </a>
          <span className="text-xs text-gray-500">
            Your slot is held until the payment completes.
          </span>
        </div>
      )}

      {mode === "reschedule" && booking.location && (
        <div className="mt-4 flex flex-col gap-3">
          <SlotPicker
            locationId={booking.location.id}
            durationMinutes={booking.duration_minutes || 60}
            value={newDateTime}
            onChange={setNewDateTime}
            theme="dark"
            primaryColor={orgColor}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleReschedule}
              disabled={pending || !newDateTime}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: orgColor }}
            >
              {pending && <AigSpinner />}
              {newDateTime
                ? `Confirm — ${new Date(newDateTime).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                : "Pick a time"}
            </button>
            <button
              type="button"
              onClick={() => { setMode("idle"); setError(null); setNewDateTime(null); }}
              disabled={pending}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!actionable && !unpaid && (
        <p className="mt-3 text-xs text-gray-500">
          Work on this booking has started — {garagePhone ? `call us on ${garagePhone}` : "contact the garage"} if
          you need to make changes.
        </p>
      )}

      {mode === "idle" && !unpaid && (
        <div className="mt-3 flex flex-wrap gap-2">
          {actionable && (
            <button
              type="button"
              onClick={() => setMode("reschedule")}
              disabled={pending}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              Change time
            </button>
          )}
          <a
            href={`/dashboard/ics/${booking.id}`}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/10 transition-colors"
          >
            Add to calendar
          </a>
          {actionable && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={pending}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
            >
              {pending && <AigSpinner />}
              Cancel booking
            </button>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
