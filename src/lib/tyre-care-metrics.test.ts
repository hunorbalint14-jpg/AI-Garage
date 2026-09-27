import { describe, it, expect } from "vitest";
import { computeTyreCareMetrics, rate, type MetricRec } from "./tyre-care-metrics";

const NOW = new Date("2026-09-27T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

function rec(overrides: Partial<MetricRec> = {}): MetricRec {
  return {
    customer_id: "c1",
    service_type: "rotation",
    confidence: "high",
    status: "approved_sent",
    created_at: daysAgo(20),
    reviewed_at: daysAgo(19),
    sent_at: daysAgo(19),
    converted_at: null,
    dismissed_reason: null,
    converted_booking_id: null,
    ...overrides,
  };
}

const base = { unsubscribedCustomerIds: new Set<string>(), bookingValues: new Map(), latestRun: null, now: NOW };

describe("rate", () => {
  it("rounds to one decimal and never divides by zero", () => {
    expect(rate(1, 3).pct).toBe(33.3);
    expect(rate(0, 0).pct).toBeNull();
  });
});

describe("computeTyreCareMetrics", () => {
  it("measures conversion on the messages sent in the window", () => {
    const m = computeTyreCareMetrics({
      ...base,
      recs: [
        rec({ customer_id: "a", status: "converted", converted_at: daysAgo(15), converted_booking_id: "b1" }),
        rec({ customer_id: "b" }),
        rec({ customer_id: "c" }),
        rec({ customer_id: "d", sent_at: daysAgo(200), created_at: daysAgo(201) }), // outside the window
      ],
    });
    expect(m.sent).toBe(3);
    expect(m.booked).toBe(1);
    expect(m.conversion.pct).toBe(33.3);
    expect(m.medianDaysToBook).toBe(4);
  });

  it("counts a booking that lands after the send, as long as the send was in the window", () => {
    const m = computeTyreCareMetrics({
      ...base,
      recs: [rec({ sent_at: daysAgo(80), status: "converted", converted_at: daysAgo(1) })],
    });
    expect(m.booked).toBe(1);
  });

  it("measures dismissals against all staff decisions in the window", () => {
    const m = computeTyreCareMetrics({
      ...base,
      recs: [
        rec(),
        rec({ status: "dismissed", sent_at: null, reviewed_at: daysAgo(5), dismissed_reason: "Evidence looks wrong" }),
        rec({ status: "dismissed", sent_at: null, reviewed_at: daysAgo(6), dismissed_reason: "Evidence looks wrong" }),
        rec({ status: "dismissed", sent_at: null, reviewed_at: daysAgo(7), dismissed_reason: null }),
      ],
    });
    expect(m.dismissal).toEqual({ numerator: 3, denominator: 4, pct: 75 });
    expect(m.dismissalReasons).toEqual([
      { reason: "Evidence looks wrong", count: 2 },
      { reason: "No reason given", count: 1 },
    ]);
  });

  it("measures unsubscribes per customer messaged, not per message", () => {
    const m = computeTyreCareMetrics({
      ...base,
      unsubscribedCustomerIds: new Set(["a", "zz"]), // zz was never messaged here
      recs: [rec({ customer_id: "a" }), rec({ customer_id: "a", service_type: "alignment" }), rec({ customer_id: "b" })],
    });
    expect(m.unsubscribes).toEqual({ numerator: 1, denominator: 2, pct: 50 });
  });

  it("reports paid revenue and not-yet-invoiced bookings separately", () => {
    const m = computeTyreCareMetrics({
      ...base,
      bookingValues: new Map([
        ["b1", { paid: 72, booked: 59 }],
        ["b2", { paid: 0, booked: 59 }],
      ]),
      recs: [
        rec({ status: "converted", converted_at: daysAgo(10), converted_booking_id: "b1" }),
        rec({ status: "converted", converted_at: daysAgo(10), converted_booking_id: "b2" }),
      ],
    });
    expect(m.paidRevenue).toBe(72);
    expect(m.bookedValueUninvoiced).toBe(59);
  });

  it("splits conversion by service and evidence, omitting empty segments", () => {
    const m = computeTyreCareMetrics({
      ...base,
      recs: [
        rec({ confidence: "high", status: "converted", converted_at: daysAgo(10) }),
        rec({ confidence: "high" }),
        rec({ confidence: "low" }),
        rec({ service_type: "alignment", confidence: "high" }),
      ],
    });
    expect(m.segments.map((s) => `${s.serviceType}/${s.confidence}:${s.booked}/${s.sent}`)).toEqual([
      "rotation/high:1/2",
      "rotation/low:0/1",
      "alignment/high:0/1",
    ]);
  });

  it("derives coverage from the latest run", () => {
    const m = computeTyreCareMetrics({
      ...base,
      recs: [],
      latestRun: { ranAt: daysAgo(0), vehicles: 200, withHistory: 150, withEstimate: 90, truncated: false },
    });
    expect(m.coverage?.estimatePct).toBe(45);
    expect(m.coverage?.historyPct).toBe(75);
  });

  it("is honest about an empty window", () => {
    const m = computeTyreCareMetrics({ ...base, recs: [] });
    expect(m.conversion.pct).toBeNull();
    expect(m.dismissal.pct).toBeNull();
    expect(m.medianDaysToBook).toBeNull();
    expect(m.coverage).toBeNull();
  });
});
