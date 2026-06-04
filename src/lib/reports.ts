import { daysOverdue } from "@/lib/dunning";

// Pure aggregation helpers for the staff reports page. No DB/server imports so
// they're unit-tested in isolation; the page does the queries and feeds rows in.

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// --- Aged debtors ---------------------------------------------------------

export type AgedBucketKey = "current" | "1-30" | "31-60" | "60+";
export const AGED_BUCKETS: AgedBucketKey[] = ["current", "1-30", "31-60", "60+"];

export function agedBucket(overdueDays: number): AgedBucketKey {
  if (overdueDays <= 0) return "current";
  if (overdueDays <= 30) return "1-30";
  if (overdueDays <= 60) return "31-60";
  return "60+";
}

export type AgedInvoice = { total: number; due_at: string | null };

export function summariseAgedDebtors(
  invoices: AgedInvoice[],
  now: Date = new Date(),
): Record<AgedBucketKey, { count: number; total: number }> {
  const out: Record<AgedBucketKey, { count: number; total: number }> = {
    current: { count: 0, total: 0 },
    "1-30": { count: 0, total: 0 },
    "31-60": { count: 0, total: 0 },
    "60+": { count: 0, total: 0 },
  };
  for (const inv of invoices) {
    const od = inv.due_at ? daysOverdue(inv.due_at, now) : 0;
    const bucket = out[agedBucket(od)];
    bucket.count += 1;
    bucket.total += Number(inv.total) || 0;
  }
  for (const k of AGED_BUCKETS) out[k].total = round2(out[k].total);
  return out;
}

// --- Technician productivity ---------------------------------------------

export type TimeEntryLite = { userId: string; jobId: string; minutes: number };
export type ProductivityRow = { actualMinutes: number; estimateMinutes: number; jobCount: number };

// Roll completed time entries up per technician. Estimate is counted once per
// distinct job the technician worked (so two clock sessions on one job don't
// double-count its estimate).
export function rollupProductivity(
  entries: TimeEntryLite[],
  estimateMinutesByJob: Map<string, number>,
): Map<string, ProductivityRow> {
  const out = new Map<string, ProductivityRow & { jobIds: Set<string> }>();
  for (const e of entries) {
    let row = out.get(e.userId);
    if (!row) {
      row = { actualMinutes: 0, estimateMinutes: 0, jobCount: 0, jobIds: new Set<string>() };
      out.set(e.userId, row);
    }
    row.actualMinutes += e.minutes;
    if (!row.jobIds.has(e.jobId)) {
      row.jobIds.add(e.jobId);
      row.estimateMinutes += estimateMinutesByJob.get(e.jobId) ?? 0;
      row.jobCount += 1;
    }
  }
  const result = new Map<string, ProductivityRow>();
  for (const [userId, row] of out) {
    result.set(userId, { actualMinutes: row.actualMinutes, estimateMinutes: row.estimateMinutes, jobCount: row.jobCount });
  }
  return result;
}

// --- VAT summary ----------------------------------------------------------

export type PaidInvoiceLite = { subtotal: number; vat_amount: number; total: number };

export function vatSummary(invoices: PaidInvoiceLite[]): { net: number; vat: number; gross: number; count: number } {
  let net = 0, vat = 0, gross = 0;
  for (const inv of invoices) {
    net += Number(inv.subtotal) || 0;
    vat += Number(inv.vat_amount) || 0;
    gross += Number(inv.total) || 0;
  }
  return { net: round2(net), vat: round2(vat), gross: round2(gross), count: invoices.length };
}

// --- Reporting period -----------------------------------------------------

export type PeriodKey = "this_month" | "last_month" | "this_quarter" | "ytd";
export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_quarter", label: "This quarter" },
  { key: "ytd", label: "Year to date" },
];

// Resolve a preset to an inclusive-start / exclusive-end range. Unknown keys
// fall back to this_quarter.
export function periodRange(period: string, now: Date = new Date()): { from: Date; to: Date; key: PeriodKey } {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (period) {
    case "this_month":
      return { from: new Date(y, m, 1), to: new Date(y, m + 1, 1), key: "this_month" };
    case "last_month":
      return { from: new Date(y, m - 1, 1), to: new Date(y, m, 1), key: "last_month" };
    case "ytd":
      return { from: new Date(y, 0, 1), to: new Date(y + 1, 0, 1), key: "ytd" };
    case "this_quarter":
    default: {
      const qStart = Math.floor(m / 3) * 3;
      return { from: new Date(y, qStart, 1), to: new Date(y, qStart + 3, 1), key: "this_quarter" };
    }
  }
}
