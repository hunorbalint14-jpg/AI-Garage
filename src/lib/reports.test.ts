import { describe, it, expect } from "vitest";
import {
  agedBucket,
  summariseAgedDebtors,
  rollupProductivity,
  vatSummary,
  periodRange,
  workingDaysBetween,
  utilisationSummary,
} from "./reports";

describe("agedBucket", () => {
  it("buckets by overdue days at the boundaries", () => {
    expect(agedBucket(0)).toBe("current");
    expect(agedBucket(-5)).toBe("current");
    expect(agedBucket(1)).toBe("1-30");
    expect(agedBucket(30)).toBe("1-30");
    expect(agedBucket(31)).toBe("31-60");
    expect(agedBucket(60)).toBe("31-60");
    expect(agedBucket(61)).toBe("60+");
  });
});

describe("summariseAgedDebtors", () => {
  it("totals invoices into their buckets", () => {
    const now = new Date("2026-06-04T00:00:00Z");
    const out = summariseAgedDebtors(
      [
        { total: 100, due_at: "2026-07-01" }, // not due → current
        { total: 50, due_at: "2026-05-20" }, // ~15d overdue → 1-30
        { total: 25, due_at: "2026-03-01" }, // >60d → 60+
        { total: 10, due_at: null }, // no due date → current
      ],
      now,
    );
    expect(out.current).toEqual({ count: 2, total: 110 });
    expect(out["1-30"]).toEqual({ count: 1, total: 50 });
    expect(out["60+"]).toEqual({ count: 1, total: 25 });
    expect(out["31-60"]).toEqual({ count: 0, total: 0 });
  });
});

describe("rollupProductivity", () => {
  it("sums actual per user and counts each job's estimate once", () => {
    const est = new Map([["j1", 60], ["j2", 30]]);
    const out = rollupProductivity(
      [
        { userId: "u1", jobId: "j1", minutes: 20 },
        { userId: "u1", jobId: "j1", minutes: 25 }, // 2nd session same job
        { userId: "u1", jobId: "j2", minutes: 40 },
        { userId: "u2", jobId: "j1", minutes: 10 },
      ],
      est,
    );
    expect(out.get("u1")).toEqual({ actualMinutes: 85, estimateMinutes: 90, jobCount: 2 });
    expect(out.get("u2")).toEqual({ actualMinutes: 10, estimateMinutes: 60, jobCount: 1 });
  });
});

describe("vatSummary", () => {
  it("sums net/vat/gross over paid invoices", () => {
    expect(
      vatSummary([
        { subtotal: 100, vat_amount: 20, total: 120 },
        { subtotal: 50, vat_amount: 10, total: 60 },
      ]),
    ).toEqual({ net: 150, vat: 30, gross: 180, count: 2 });
  });
});

describe("workingDaysBetween", () => {
  it("counts Mon–Sat, excludes Sundays", () => {
    // Mon 2026-06-01 .. Mon 2026-06-08 (exclusive) = Mon–Sat + Sun excluded = 6
    expect(workingDaysBetween(new Date(2026, 5, 1), new Date(2026, 5, 8))).toBe(6);
  });
  it("returns 0 for an empty range", () => {
    expect(workingDaysBetween(new Date(2026, 5, 1), new Date(2026, 5, 1))).toBe(0);
  });
  it("counts a single Sunday as 0", () => {
    // 2026-06-07 is a Sunday
    expect(workingDaysBetween(new Date(2026, 5, 7), new Date(2026, 5, 8))).toBe(0);
  });
});

describe("utilisationSummary", () => {
  it("computes sold/worked/capacity and the derived rates", () => {
    const out = utilisationSummary({
      workedMinutes: 600, // 10h
      labourLines: [
        { quantity: 4, unit_price: 60 }, // 4h × £60
        { quantity: 4, unit_price: 75 }, // 4h × £75
      ],
      techCount: 2,
      hoursPerDay: 10,
      workingDays: 1,
    });
    expect(out.soldMinutes).toBe(480); // 8h sold
    expect(out.capacityMinutes).toBe(1200); // 2 × 10h
    expect(out.labourRevenue).toBe(540);
    expect(out.utilisationPct).toBe(50); // 600/1200
    expect(out.efficiencyPct).toBe(80); // 480/600
    expect(out.revenuePerWorkedHour).toBe(54); // 540 / 10h
  });

  it("returns nulls instead of dividing by zero", () => {
    const out = utilisationSummary({
      workedMinutes: 0,
      labourLines: [],
      techCount: 0,
      hoursPerDay: 10,
      workingDays: 5,
    });
    expect(out.utilisationPct).toBeNull();
    expect(out.efficiencyPct).toBeNull();
    expect(out.revenuePerWorkedHour).toBeNull();
  });

  it("ignores junk quantities and prices", () => {
    const out = utilisationSummary({
      workedMinutes: 60,
      labourLines: [{ quantity: NaN, unit_price: 60 }, { quantity: 2, unit_price: NaN }],
      techCount: 1,
      hoursPerDay: 8,
      workingDays: 1,
    });
    expect(out.soldMinutes).toBe(120);
    expect(out.labourRevenue).toBe(0);
  });
});

describe("periodRange", () => {
  it("resolves this_quarter for a June date (Apr–Jun → Apr..Jul)", () => {
    const { from, to, key } = periodRange("this_quarter", new Date("2026-06-04T12:00:00"));
    expect(key).toBe("this_quarter");
    expect(from.getMonth()).toBe(3); // April
    expect(to.getMonth()).toBe(6); // July (exclusive)
  });
  it("falls back to this_quarter for unknown keys", () => {
    expect(periodRange("nonsense", new Date("2026-06-04T12:00:00")).key).toBe("this_quarter");
  });
  it("resolves last_month across a year boundary is not needed but mid-year works", () => {
    const { from, to } = periodRange("last_month", new Date("2026-06-04T12:00:00"));
    expect(from.getMonth()).toBe(4); // May
    expect(to.getMonth()).toBe(5); // June (exclusive)
  });
});
