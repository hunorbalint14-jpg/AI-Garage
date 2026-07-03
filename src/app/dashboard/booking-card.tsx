"use client";

import { useState, useTransition } from "react";
import { AigSpinner } from "@/components/ui/aig-spinner";
import { cancelCustomerBooking, rescheduleCustomerBooking } from "./booking-actions";
import { useConfirm } from "@/components/confirm-provider";

type Booking = {
  id: string;
  scheduled_at: string;
  type: string;
  status: string;
  duration_minutes: number;
  vehicle: { registration: string } | null;
};

type Props = {
  booking: Booking;
  orgColor: string;
  garagePhone: string | null;
};

function typeLabel(t: string) {
  return t === "mot" ? "MOT" : t.charAt(0).toUpperCase() + t.slice(1);
}

function toLocalInput(isoDate: string): string {
  const d = new Date(isoDate);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function BookingCard({ booking, orgColor, garagePhone }: Props) {
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"idle" | "reschedule">("idle");
  const [newDateTime, setNewDateTime] = useState(toLocalInput(booking.scheduled_at));
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  // Self-serve changes only make sense before work starts — once the booking is
  // in progress (or beyond), cancelling would orphan the job on the workshop
  // side, so the actions give way to a "call us" hint.
  const actionable = booking.status === "scheduled";

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

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold">{typeLabel(booking.type)}</p>
          <p className="text-sm text-gray-400 mt-0.5">
            {new Date(booking.scheduled_at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            {booking.vehicle ? (
              ` · ${booking.vehicle.registration}`
            ) : (
              <span className="text-gray-500"> · No vehicle on file</span>
            )}
          </p>
        </div>
        <span
          className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium"
          style={{ backgroundColor: `${orgColor}25`, color: orgColor }}
        >
          {booking.status === "in_progress" ? "In progress" : "Confirmed"}
        </span>
      </div>

      {mode === "reschedule" && (
        <div className="mt-3 flex flex-col gap-2">
          <input
            type="datetime-local"
            value={newDateTime}
            onChange={(e) => setNewDateTime(e.target.value)}
            disabled={pending}
            className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30 disabled:opacity-50"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleReschedule}
              disabled={pending}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: orgColor }}
            >
              {pending && <AigSpinner />}
              Confirm reschedule
            </button>
            <button
              type="button"
              onClick={() => { setMode("idle"); setError(null); }}
              disabled={pending}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!actionable && (
        <p className="mt-3 text-xs text-gray-500">
          Work on this booking has started — {garagePhone ? `call us on ${garagePhone}` : "contact the garage"} if
          you need to make changes.
        </p>
      )}

      {mode === "idle" && actionable && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setMode("reschedule")}
            disabled={pending}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            Reschedule
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={pending}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
          >
            {pending && <AigSpinner />}
            Cancel booking
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
