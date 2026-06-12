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

// --- Workshop utilisation ---------------------------------------------------

// Working days (Mon–Sat) in [from, to). UK garages typically run a 6-day
// week; capacity built on this is a labelled estimate, not gospel.
export function workingDaysBetween(from: Date, to: Date): number {
  let days = 0;
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  while (d < to) {
    if (d.getDay() !== 0) days++;
    d.setDate(d.getDate() + 1);
  }
  return days;
}

export type LabourLineLite = { quantity: number; unit_price: number };

export type UtilisationInput = {
  /** Clocked technician minutes in the period (job_time_entries). */
  workedMinutes: number;
  /** Labour-line hours on invoices paid in the period ("hours sold"). */
  labourLines: LabourLineLite[];
  /** Distinct technicians who clocked time in the period. */
  techCount: number;
  /** Business hours per day (locations.business_hours_end − start). */
  hoursPerDay: number;
  /** Working days elapsed in the period (clamped to today for live periods). */
  workingDays: number;
};

export type UtilisationSummary = {
  soldMinutes: number;
  workedMinutes: number;
  capacityMinutes: number;
  labourRevenue: number;
  /** worked ÷ capacity — how much of the open doors got clocked. */
  utilisationPct: number | null;
  /** sold ÷ worked — how much clocked time turned into invoiced labour. */
  efficiencyPct: number | null;
  /** labour £ ÷ worked hours. */
  revenuePerWorkedHour: number | null;
};

export function utilisationSummary(input: UtilisationInput): UtilisationSummary {
  let soldHours = 0;
  let labourRevenue = 0;
  for (const line of input.labourLines) {
    const qty = Number(line.quantity) || 0;
    soldHours += qty;
    labourRevenue += qty * (Number(line.unit_price) || 0);
  }
  const soldMinutes = Math.round(soldHours * 60);
  const capacityMinutes = Math.round(input.techCount * input.hoursPerDay * input.workingDays * 60);
  const workedHours = input.workedMinutes / 60;

  const pct = (num: number, denom: number): number | null =>
    denom > 0 ? Math.round((num / denom) * 100) : null;

  return {
    soldMinutes,
    workedMinutes: input.workedMinutes,
    capacityMinutes,
    labourRevenue: round2(labourRevenue),
    utilisationPct: pct(input.workedMinutes, capacityMinutes),
    efficiencyPct: pct(soldMinutes, input.workedMinutes),
    revenuePerWorkedHour: workedHours > 0 ? round2(labourRevenue / workedHours) : null,
  };
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
