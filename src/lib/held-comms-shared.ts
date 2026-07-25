// Kinds + labels for held customer comms (#586), split out of held-comms.ts so
// client components can import them without dragging in the server-only half
// (the admin client). Same split as the other -shared modules in this repo.

export const HELD_KINDS = [
  "mot_reminder",
  "service_reminder",
  "tax_reminder",
  "invoice_dunning",
  "review_request",
  "booking_confirmation",
  "deferred_followup",
  "quote_reminder",
] as const;

export type HeldKind = (typeof HELD_KINDS)[number];

// Owner-facing wording: what the customer would receive, not the internal name.
export const HELD_KIND_LABELS: Record<HeldKind, string> = {
  mot_reminder: "MOT reminders",
  service_reminder: "Service reminders",
  tax_reminder: "Tax reminders",
  invoice_dunning: "Overdue invoice chasers",
  review_request: "Feedback requests",
  booking_confirmation: "Booking confirmations",
  deferred_followup: "Deferred work follow-ups",
  quote_reminder: "Quote reminders",
};
