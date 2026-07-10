// Shared booking display helpers — imported by both the server table
// (page.tsx) and the client calendar so status colours + labels stay in sync.

import type { WorkshopTone } from "@/components/staff/workshop";

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
  is_demo?: boolean;
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

export const CONFIRMATION_TONE: Record<Exclude<ConfirmationState, null>, WorkshopTone> = {
  confirmed: "green",
  reschedule_requested: "amber",
  awaiting: "neutral",
};

export function confirmationLabel(s: Exclude<ConfirmationState, null>): string {
  if (s === "confirmed") return "Confirmed";
  if (s === "reschedule_requested") return "Wants new time";
  return "Awaiting reply";
}

// WorkshopBadge tone per status — aligned with the dashboard's
// BOOKING_STATUS colours (scheduled neutral · in-progress amber · complete
// green · cancelled red · no-show purple); payment_pending gets blue.
export const STATUS_TONE: Record<string, WorkshopTone> = {
  scheduled: "neutral",
  in_progress: "amber",
  complete: "green",
  cancelled: "red",
  no_show: "purple",
  payment_pending: "blue",
};

// Solid dot colour per status, for the month-grid day indicators — same
// hues as the badge tones.
export const STATUS_DOT: Record<string, string> = {
  scheduled: "bg-ws-text-2",
  in_progress: "bg-ws-amber",
  complete: "bg-ws-green",
  cancelled: "bg-ws-red",
  no_show: "bg-ws-purple",
  payment_pending: "bg-ws-blue",
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
