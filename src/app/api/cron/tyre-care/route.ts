import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/safe-equal";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { recordCronRun } from "@/lib/platform/cron-runs";
import { evaluateTyreCare, ROTATION_INTERVAL_MILES, BALANCE_INTERVAL_MILES } from "@/lib/tyre-care";
import { loadTyreCareData } from "@/lib/tyre-care-data";
import {
  planRecommendations,
  type ExistingRecommendation,
  type FreshRecommendation,
} from "@/lib/tyre-care-queue";

// Tyre-care evaluation (#596 PR 4). Dispatched per location by /api/cron/tick
// when the `tyre_care` scheduled task is due. Evaluation ONLY: it raises,
// refreshes and expires rows in the staff review queue and never contacts a
// customer — sending is a staff action (PR 5). Routes on the customer's HOME
// branch, like the reminder crons. Gated behind the `tyre_care` flag.
export const runtime = "nodejs";
export const maxDuration = 60;

/** Leave headroom inside maxDuration for the queue writes and the run log. */
const EVALUATION_BUDGET_MS = 40_000;
const VEHICLE_BATCH = 200;
const PAGE = 1000;
const WRITE_CONCURRENCY = 8;

type LocationRow = {
  id: string;
  organization: { id: string; tyre_rotation_miles: number | null; tyre_balance_miles: number | null } | null;
};

type VehicleRow = {
  id: string;
  fuel_type: string | null;
  customer: { id: string; anonymized_at: string | null } | null;
};

type Admin = ReturnType<typeof createAdminClient>;

async function loadHomeBranchVehicles(admin: Admin, locationId: string): Promise<VehicleRow[]> {
  const out: VehicleRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("vehicles")
      .select("id, fuel_type, customer:customers!inner(id, anonymized_at)")
      .eq("customer.preferred_location_id", locationId)
      .eq("is_demo", false)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`vehicles: ${error.message}`);
    const rows = (data ?? []) as unknown as VehicleRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function loadExisting(admin: Admin, vehicleIds: string[]): Promise<ExistingRecommendation[]> {
  const out: ExistingRecommendation[] = [];
  for (let i = 0; i < vehicleIds.length; i += 100) {
    const chunk = vehicleIds.slice(i, i + 100);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from("tyre_recommendations")
        .select("id, vehicle_id, service_type, status, reviewed_at, sent_at, converted_at")
        .in("vehicle_id", chunk)
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`tyre_recommendations: ${error.message}`);
      const rows = (data ?? []) as ExistingRecommendation[];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

async function inPool<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += WRITE_CONCURRENCY) {
    await Promise.all(items.slice(i, i + WRITE_CONCURRENCY).map(fn));
  }
}

type LocationResult = {
  evaluated: number;
  inserted: number;
  refreshed: number;
  expired: number;
  held: number;
  truncated: boolean;
};

async function evaluateLocation(admin: Admin, location: LocationRow, deadline: number): Promise<LocationResult> {
  const org = location.organization;
  const thresholds = {
    rotationMiles: org?.tyre_rotation_miles ?? ROTATION_INTERVAL_MILES,
    balanceMiles: org?.tyre_balance_miles ?? BALANCE_INTERVAL_MILES,
  };
  const now = new Date();
  const vehicles = await loadHomeBranchVehicles(admin, location.id);

  const evaluated = new Set<string>();
  const fresh: FreshRecommendation[] = [];
  let truncated = false;
  let withHistory = 0;
  let withEstimate = 0;

  for (let i = 0; i < vehicles.length; i += VEHICLE_BATCH) {
    if (Date.now() > deadline) {
      truncated = true; // the rest are picked up tomorrow; their queue items are left alone
      break;
    }
    const batch = vehicles.slice(i, i + VEHICLE_BATCH);
    const data = await loadTyreCareData(
      admin,
      batch.map((v) => v.id),
    );

    for (const v of batch) {
      evaluated.add(v.id);
      const d = data.get(v.id);
      // Looked at, but nothing may be raised: anonymised customers, and cars
      // the garage has never worked on (the spec's no-history non-goal).
      // Counting them as evaluated lets any stale queue item for them expire.
      if (!v.customer || v.customer.anonymized_at || !d?.hasServiceHistory) continue;
      withHistory++;

      const result = evaluateTyreCare({
        now,
        fuelType: v.fuel_type,
        tyreConfig: d.tyreConfig,
        odometerPoints: d.odometerPoints,
        tyreChecks: d.tyreChecks,
        motAdvisories: d.motAdvisories,
        serviceEvents: d.serviceEvents,
        visits: d.visits,
        thresholds,
      });
      if (result.mileage) withEstimate++;
      for (const rec of result.recommendations) {
        // Balancing never reaches the queue: it is a job-card prompt only.
        if (!rec.customerContactable) continue;
        fresh.push({
          vehicle_id: v.id,
          customer_id: v.customer.id,
          service_type: rec.serviceType,
          confidence: rec.confidence,
          evidence: rec.evidence,
        });
      }
    }
  }

  const existing = await loadExisting(admin, [...evaluated]);
  const plan = planRecommendations(existing, fresh, evaluated, now);
  const nowIso = now.toISOString();

  let inserted = 0;
  if (plan.inserts.length > 0) {
    const rows = plan.inserts.map((r) => ({
      location_id: location.id,
      customer_id: r.customer_id,
      vehicle_id: r.vehicle_id,
      service_type: r.service_type,
      confidence: r.confidence,
      evidence: r.evidence,
    }));
    const { error } = await admin.from("tyre_recommendations").insert(rows);
    if (!error) {
      inserted = rows.length;
    } else if (error.code === "23505") {
      // A concurrent run ("Run now" during the hourly tick) queued some of
      // these first. The batch is atomic, so retry row by row and let the
      // one-pending-per-vehicle index turn duplicates away.
      await inPool(rows, async (row) => {
        const { error: rowError } = await admin.from("tyre_recommendations").insert(row);
        if (!rowError) inserted++;
        else if (rowError.code !== "23505") throw new Error(`insert: ${rowError.message}`);
      });
    } else {
      throw new Error(`insert: ${error.message}`);
    }
  }

  // Refresh carries today's numbers, and re-homes the item if the customer
  // changed home branch since it was raised.
  let refreshed = 0;
  await inPool(plan.refreshes, async (r) => {
    const { error } = await admin
      .from("tyre_recommendations")
      .update({ confidence: r.confidence, evidence: r.evidence, location_id: location.id, updated_at: nowIso })
      .eq("id", r.id)
      .eq("status", "pending_review");
    if (error) throw new Error(`refresh: ${error.message}`);
    refreshed++;
  });

  let expired = 0;
  for (let i = 0; i < plan.expires.length; i += 100) {
    const ids = plan.expires.slice(i, i + 100);
    const { error } = await admin
      .from("tyre_recommendations")
      .update({ status: "expired", updated_at: nowIso })
      .in("id", ids)
      .eq("status", "pending_review");
    if (error) throw new Error(`expire: ${error.message}`);
    expired += ids.length;
  }

  // Run log — the coverage metric reads the latest row. A failed log write
  // must not fail the evaluation that just succeeded.
  const { error: runError } = await admin.from("tyre_care_runs").insert({
    location_id: location.id,
    vehicles: evaluated.size,
    with_history: withHistory,
    with_estimate: withEstimate,
    raised: inserted,
    refreshed,
    expired,
    truncated,
  });
  if (runError) console.error("[tyre-care] run log write failed", runError.message);

  return { evaluated: evaluated.size, inserted, refreshed, expired, held: plan.held.length, truncated };
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await isFeatureEnabled("tyre_care"))) {
    return NextResponse.json({ success: true, gated: true });
  }

  const admin = createAdminClient();
  const t0 = Date.now();
  const deadline = t0 + EVALUATION_BUDGET_MS;
  const filterLocationId = new URL(request.url).searchParams.get("location_id");

  let locationsQuery = admin
    .from("locations")
    .select("id, organization:organizations!organization_id(id, tyre_rotation_miles, tyre_balance_miles)");
  if (filterLocationId) locationsQuery = locationsQuery.eq("id", filterLocationId);
  const { data: locations, error: locError } = (await locationsQuery) as unknown as {
    data: LocationRow[] | null;
    error: { message: string } | null;
  };
  if (locError) {
    await recordCronRun(admin, "cron/tyre-care", false, Date.now() - t0, locError.message.slice(0, 200));
    return NextResponse.json({ error: locError.message }, { status: 500 });
  }

  const totals = { locations: 0, evaluated: 0, inserted: 0, refreshed: 0, expired: 0, held: 0, truncated: 0 };
  const errors: string[] = [];

  for (const location of locations ?? []) {
    const { data: task } = await admin
      .from("scheduled_tasks")
      .select("enabled")
      .eq("location_id", location.id)
      .eq("task_type", "tyre_care")
      .maybeSingle();
    // Opt-in per location: no task row, or a disabled one, means no evaluation.
    if (!task || (task as { enabled: boolean }).enabled === false) continue;

    try {
      const r = await evaluateLocation(admin, location, deadline);
      totals.locations++;
      totals.evaluated += r.evaluated;
      totals.inserted += r.inserted;
      totals.refreshed += r.refreshed;
      totals.expired += r.expired;
      totals.held += r.held;
      if (r.truncated) totals.truncated++;
    } catch (err) {
      // One branch's failure must not stop the others; nothing is expired for
      // it because the plan never ran.
      errors.push(`${location.id}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200));
    }
  }

  const detail = `locations ${totals.locations}, evaluated ${totals.evaluated}, +${totals.inserted} queued, ${totals.refreshed} refreshed, ${totals.expired} expired${totals.truncated ? `, ${totals.truncated} truncated` : ""}${errors.length ? `, errors: ${errors[0]}` : ""}`;
  await recordCronRun(admin, "cron/tyre-care", errors.length === 0, Date.now() - t0, detail);

  if (errors.length > 0) {
    return NextResponse.json({ success: false, ...totals, errors }, { status: 500 });
  }
  return NextResponse.json({ success: true, ...totals });
}
