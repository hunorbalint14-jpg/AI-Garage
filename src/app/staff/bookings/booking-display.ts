// Shared booking display helpers — imported by both the server table
// (page.tsx) and the client calendar so status colours + labels stay in sync.

export type BookingRow = {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  type: string;
  status: string;
  notes: string | null;
  assigned_to: string | null;
  confirmation_sent_at: string | null;
  confirmed_at: string | null;
  reschedule_requested_at: string | null;
  customer: { id: string; full_name: string | null } | null;
  vehicle: { registration: string } | null;
};

// T-24h confirmation state, shown only for upcoming scheduled bookings.
export type ConfirmationState = "confirmed" | "reschedule_requested" | "awaiting" | null;

export function confirmationState(b: BookingRow): ConfirmationState {
  if (b.status !== "scheduled") return null;
  if (b.reschedule_requested_at) return "reschedule_requested";
  if (b.confirmed_at) return "confirmed";
  if (b.confirmation_sent_at) return "awaiting";
  return null;
}

export const CONFIRMATION_STYLE: Record<Exclude<ConfirmationState, null>, string> = {
  confirmed: "bg-green-100 text-green-700",
  reschedule_requested: "bg-amber-100 text-amber-700",
  awaiting: "bg-gray-100 text-gray-600",
};

export function confirmationLabel(s: Exclude<ConfirmationState, null>): string {
  if (s === "confirmed") return "Confirmed";
  if (s === "reschedule_requested") return "Wants new time";
  return "Awaiting reply";
}

export const STATUS_STYLE: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700",
  in_progress: "bg-amber-100 text-amber-700",
  complete: "bg-green-100 text-green-700",
  cancelled: "bg-gray-100 text-gray-600",
  no_show: "bg-red-100 text-red-700",
  payment_pending: "bg-purple-100 text-purple-700",
};

// Solid dot colour per status, for the month-grid day indicators.
export const STATUS_DOT: Record<string, string> = {
  scheduled: "bg-blue-500",
  in_progress: "bg-amber-500",
  complete: "bg-green-500",
  cancelled: "bg-gray-400",
  no_show: "bg-red-500",
  payment_pending: "bg-purple-500",
};

export function statusLabel(s: string): string {
  if (s === "in_progress") return "In progress";
  if (s === "no_show") return "No show";
  if (s === "payment_pending") return "Payment pending";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function typeLabel(t: string): string {
  if (t === "mot") return "MOT";
  return t.charAt(0).toUpperCase() + t.slice(1);
}
