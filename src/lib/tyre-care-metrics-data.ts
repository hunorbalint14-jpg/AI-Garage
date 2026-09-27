import type { createAdminClient } from "@/lib/supabase/admin";
import {
  computeTyreCareMetrics,
  METRICS_WINDOW_DAYS,
  type BookingValue,
  type MetricRec,
  type RunCoverage,
  type TyreCareMetrics,
} from "@/lib/tyre-care-metrics";

// Loads what computeTyreCareMetrics needs for one branch (#596 PR 6).

type Admin = ReturnType<typeof createAdminClient>;

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = 1000;

function check<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`tyre-care metrics: ${what}: ${res.error.message}`);
  return (res.data ?? ([] as unknown)) as T;
}

/**
 * Paid invoice totals and booked service value per converted booking. An
 * invoice can point at the booking directly or through the job raised from
 * it; counting each invoice once whichever way it's linked.
 */
async function bookingValues(admin: Admin, bookingIds: string[]): Promise<Map<string, BookingValue>> {
  const out = new Map<string, BookingValue>(bookingIds.map((id) => [id, { paid: 0, booked: 0 }]));
  if (bookingIds.length === 0) return out;

  const [bookings, jobs, directInvoices] = await Promise.all([
    admin.from("bookings").select("id, service:services(price)").in("id", bookingIds),
    admin.from("jobs").select("id, booking_id").in("booking_id", bookingIds),
    admin
      .from("invoices")
      .select("id, booking_id, job_id, total")
      .in("booking_id", bookingIds)
      .not("paid_at", "is", null),
  ]);
  const bookingRows = check(bookings, "bookings") as unknown as { id: string; service: { price: number | null } | null }[];
  const jobRows = check(jobs, "jobs") as { id: string; booking_id: string }[];
  const invoiceRows = check(directInvoices, "invoices") as { id: string; booking_id: string | null; job_id: string | null; total: number | null }[];

  for (const b of bookingRows) {
    const v = out.get(b.id);
    if (v) v.booked = Number(b.service?.price ?? 0);
  }

  const bookingByJob = new Map(jobRows.map((j) => [j.id, j.booking_id]));
  const viaJob = jobRows.length
    ? (check(
        await admin
          .from("invoices")
          .select("id, booking_id, job_id, total")
          .in("job_id", jobRows.map((j) => j.id))
          .not("paid_at", "is", null),
        "invoices via job",
      ) as typeof invoiceRows)
    : [];

  const seen = new Set<string>();
  for (const inv of [...invoiceRows, ...viaJob]) {
    if (seen.has(inv.id)) continue;
    seen.add(inv.id);
    const bookingId = inv.booking_id && out.has(inv.booking_id) ? inv.booking_id : inv.job_id ? bookingByJob.get(inv.job_id) : undefined;
    const v = bookingId ? out.get(bookingId) : undefined;
    if (v) v.paid += Number(inv.total ?? 0);
  }
  return out;
}

export async function loadTyreCareMetrics(
  admin: Admin,
  locationId: string,
  now: Date = new Date(),
  windowDays: number = METRICS_WINDOW_DAYS,
): Promise<TyreCareMetrics> {
  const startIso = new Date(now.getTime() - windowDays * DAY_MS).toISOString();

  // Anything that happened in the window: raised, decided or sent.
  const recs: (MetricRec & { id: string })[] = [];
  for (let from = 0; ; from += PAGE) {
    const res = await admin
      .from("tyre_recommendations")
      .select(
        "id, customer_id, service_type, confidence, status, created_at, reviewed_at, sent_at, converted_at, dismissed_reason, converted_booking_id",
      )
      .eq("location_id", locationId)
      .or(`created_at.gte.${startIso},sent_at.gte.${startIso},reviewed_at.gte.${startIso}`)
      .order("id")
      .range(from, from + PAGE - 1);
    const rows = check(res, "recommendations") as (MetricRec & { id: string })[];
    recs.push(...rows);
    if (rows.length < PAGE) break;
  }

  const messagedCustomerIds = [...new Set(recs.filter((r) => r.sent_at).map((r) => r.customer_id))];
  const convertedBookingIds = [
    ...new Set(recs.filter((r) => r.status === "converted" && r.converted_booking_id).map((r) => r.converted_booking_id!)),
  ];

  const [values, unsubscribes, run] = await Promise.all([
    bookingValues(admin, convertedBookingIds),
    messagedCustomerIds.length
      ? admin
          .from("unsubscribe_tokens")
          .select("customer_id")
          .eq("source", "tyre_care")
          .in("customer_id", messagedCustomerIds)
          .gte("used_at", startIso)
      : Promise.resolve({ data: [], error: null }),
    admin
      .from("tyre_care_runs")
      .select("ran_at, vehicles, with_history, with_estimate, truncated")
      .eq("location_id", locationId)
      .order("ran_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const runRow = check(run, "runs") as unknown as {
    ran_at: string;
    vehicles: number;
    with_history: number;
    with_estimate: number;
    truncated: boolean;
  } | null;
  const latestRun: RunCoverage =
    runRow && !Array.isArray(runRow)
      ? {
          ranAt: runRow.ran_at,
          vehicles: runRow.vehicles,
          withHistory: runRow.with_history,
          withEstimate: runRow.with_estimate,
          truncated: runRow.truncated,
        }
      : null;

  return computeTyreCareMetrics({
    recs,
    unsubscribedCustomerIds: new Set(
      (check(unsubscribes, "unsubscribes") as { customer_id: string }[]).map((u) => u.customer_id),
    ),
    bookingValues: values,
    latestRun,
    now,
    windowDays,
  });
}
