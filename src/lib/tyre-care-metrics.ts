import type { Confidence, ServiceType } from "@/lib/tyre-care";

// Tyre-care results (#596 PR 6). Pure, so the definitions are unit-tested —
// these are the numbers the thresholds get tuned against, and a metric that
// quietly flatters itself would tune them wrong.
//
// Definitions (rolling window, default 90 days):
// - conversion: of the messages SENT in the window, how many led to a booking
//   (the booking itself may land after the window closes);
// - dismissal rate: of the staff decisions made in the window, how many were
//   dismissals — the false-positive proxy;
// - unsubscribe rate: of the customers messaged in the window, how many have
//   since opted out — the trust canary;
// - revenue: paid invoices on bookings that came through a tyre-care link;
//   bookings not yet invoiced are reported separately as booked value.

const DAY_MS = 24 * 60 * 60 * 1000;

export const METRICS_WINDOW_DAYS = 90;
/** Below this, a percentage is shown with a small-sample caveat. */
export const SMALL_SAMPLE = 10;

export type MetricRec = {
  customer_id: string;
  service_type: ServiceType;
  confidence: Confidence;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  sent_at: string | null;
  converted_at: string | null;
  dismissed_reason: string | null;
  converted_booking_id: string | null;
};

export type BookingValue = { paid: number; booked: number };

export type RunCoverage = {
  ranAt: string;
  vehicles: number;
  withHistory: number;
  withEstimate: number;
  truncated: boolean;
} | null;

export type Rate = { numerator: number; denominator: number; pct: number | null };

export type SegmentResult = {
  serviceType: ServiceType;
  confidence: Confidence;
  sent: number;
  booked: number;
  conversion: Rate;
};

export type TyreCareMetrics = {
  windowDays: number;
  raised: number;
  sent: number;
  dismissed: number;
  booked: number;
  conversion: Rate;
  dismissal: Rate;
  unsubscribes: Rate;
  medianDaysToBook: number | null;
  paidRevenue: number;
  bookedValueUninvoiced: number;
  segments: SegmentResult[];
  dismissalReasons: { reason: string; count: number }[];
  coverage: (NonNullable<RunCoverage> & { estimatePct: number | null; historyPct: number | null }) | null;
};

export function rate(numerator: number, denominator: number): Rate {
  return {
    numerator,
    denominator,
    pct: denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const SEGMENT_ORDER: { serviceType: ServiceType; confidence: Confidence }[] = [
  { serviceType: "rotation", confidence: "high" },
  { serviceType: "rotation", confidence: "low" },
  { serviceType: "alignment", confidence: "high" },
  { serviceType: "alignment", confidence: "low" },
];

export function computeTyreCareMetrics(args: {
  recs: MetricRec[];
  unsubscribedCustomerIds: Set<string>;
  bookingValues: Map<string, BookingValue>;
  latestRun: RunCoverage;
  now?: Date;
  windowDays?: number;
}): TyreCareMetrics {
  const now = args.now ?? new Date();
  const windowDays = args.windowDays ?? METRICS_WINDOW_DAYS;
  const start = now.getTime() - windowDays * DAY_MS;
  const inWindow = (iso: string | null) => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= start && t <= now.getTime();
  };

  const raised = args.recs.filter((r) => inWindow(r.created_at)).length;
  // A rolled-back send clears sent_at, so every row here reached a customer.
  const sentCohort = args.recs.filter((r) => inWindow(r.sent_at));
  const booked = sentCohort.filter((r) => r.status === "converted");
  const dismissed = args.recs.filter((r) => r.status === "dismissed" && inWindow(r.reviewed_at));

  const messaged = new Set(sentCohort.map((r) => r.customer_id));
  const unsubscribed = [...messaged].filter((id) => args.unsubscribedCustomerIds.has(id)).length;

  let paidRevenue = 0;
  let bookedValueUninvoiced = 0;
  for (const r of booked) {
    const value = r.converted_booking_id ? args.bookingValues.get(r.converted_booking_id) : undefined;
    if (!value) continue;
    if (value.paid > 0) paidRevenue += value.paid;
    else bookedValueUninvoiced += value.booked;
  }

  const daysToBook = booked
    .filter((r) => r.sent_at && r.converted_at)
    .map((r) => Math.max(0, (Date.parse(r.converted_at!) - Date.parse(r.sent_at!)) / DAY_MS));

  const segments = SEGMENT_ORDER.map((seg) => {
    const rows = sentCohort.filter((r) => r.service_type === seg.serviceType && r.confidence === seg.confidence);
    const segBooked = rows.filter((r) => r.status === "converted").length;
    return { ...seg, sent: rows.length, booked: segBooked, conversion: rate(segBooked, rows.length) };
  }).filter((s) => s.sent > 0);

  const reasons = new Map<string, number>();
  for (const r of dismissed) {
    const reason = r.dismissed_reason?.trim() || "No reason given";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }

  const run = args.latestRun;
  return {
    windowDays,
    raised,
    sent: sentCohort.length,
    dismissed: dismissed.length,
    booked: booked.length,
    conversion: rate(booked.length, sentCohort.length),
    dismissal: rate(dismissed.length, sentCohort.length + dismissed.length),
    unsubscribes: rate(unsubscribed, messaged.size),
    medianDaysToBook: (() => {
      const m = median(daysToBook);
      return m === null ? null : Math.round(m * 10) / 10;
    })(),
    paidRevenue: Math.round(paidRevenue * 100) / 100,
    bookedValueUninvoiced: Math.round(bookedValueUninvoiced * 100) / 100,
    segments,
    dismissalReasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    coverage: run
      ? {
          ...run,
          estimatePct: rate(run.withEstimate, run.vehicles).pct,
          historyPct: rate(run.withHistory, run.vehicles).pct,
        }
      : null,
  };
}
