import type { createAdminClient } from "@/lib/supabase/admin";
import type { DeltaVehicleUpdate } from "@/lib/dvsa-bulk";
import type { MotTestRow } from "@/lib/mot-history";

type Admin = ReturnType<typeof createAdminClient>;

// Applying DVSA MOT data to our vehicles. Shared by the two jobs that do it:
//   - cron/mot-delta     — DVSA's daily delta files: every vehicle whose MOT
//                          data changed in the last 24h;
//   - cron/mot-reconcile — per-registration lookups for vehicles whose stored
//                          expiry has passed or is about to. The delta can
//                          never correct those when the test predates our sync
//                          (imports, cars added after their MOT, missed days),
//                          because DVSA won't emit that vehicle again until its
//                          next test.
// One diff rule, one "MOT'd elsewhere" rule, one write path.

export const MOT_VEHICLE_COLUMNS =
  "id, location_id, organization_id, registration, mot_expiry, last_mot_test_date, created_at";

export type MotVehicleRow = {
  id: string;
  location_id: string;
  organization_id: string;
  registration: string;
  mot_expiry: string | null;
  last_mot_test_date: string | null;
  created_at: string;
};

export type PendingMotUpdate = {
  vehicle: MotVehicleRow;
  motExpiry: string | null;
  lastTestDate: string | null;
  /** true when DVSA shows a test newer than what we had stored. */
  newTest: boolean;
};

export const ELSEWHERE_WINDOW_DAYS = 7;

/** What DVSA's record changes for one of our vehicles, or null for nothing. */
export function diffMotUpdate(update: DeltaVehicleUpdate, vehicle: MotVehicleRow): PendingMotUpdate | null {
  const expiryChanged = update.motExpiry !== null && update.motExpiry !== vehicle.mot_expiry;
  const newTest =
    update.lastTestDate !== null &&
    (vehicle.last_mot_test_date === null || update.lastTestDate > vehicle.last_mot_test_date);
  if (!expiryChanged && !newTest) return null;
  return { vehicle, motExpiry: update.motExpiry, lastTestDate: update.lastTestDate, newTest };
}

/** The record's full test series as mot_tests rows for one vehicle (#596). */
export function motTestRowsFor(
  update: DeltaVehicleUpdate,
  vehicle: MotVehicleRow,
  source: MotTestRow["source"],
): MotTestRow[] {
  return update.tests.map((t) => ({
    vehicle_id: vehicle.id,
    organization_id: vehicle.organization_id,
    test_date: t.testDate,
    result: t.result,
    odometer_miles: t.odometerMiles,
    defects: t.defects,
    source,
  }));
}

// A vehicle was "MOT'd elsewhere" when DVSA shows a new test but the garage
// has no booking or job for it within ±ELSEWHERE_WINDOW_DAYS of the test date.
//
// Only a test taken after the vehicle entered our system can be judged: before
// that the garage had nowhere to record the visit, so a missing booking or job
// proves nothing. Without this guard every imported vehicle would be flagged
// the first time we read its history — and an imported car's last MOT was
// usually done by this very garage, recorded in the DMS it migrated from.
//
// Both lookups are batched across all candidates.
export async function findMotedElsewhere(admin: Admin, candidates: PendingMotUpdate[]): Promise<Set<string>> {
  const withTest = candidates.filter(
    (c) => c.newTest && c.lastTestDate && c.lastTestDate >= c.vehicle.created_at.slice(0, 10),
  );
  if (withTest.length === 0) return new Set();

  const ids = [...new Set(withTest.map((c) => c.vehicle.id))];
  const earliest = withTest.reduce(
    (min, c) => (c.lastTestDate! < min ? c.lastTestDate! : min),
    withTest[0].lastTestDate!,
  );
  const windowStart = new Date(`${earliest}T00:00:00Z`);
  windowStart.setUTCDate(windowStart.getUTCDate() - ELSEWHERE_WINDOW_DAYS);

  const [{ data: bookings, error: bErr }, { data: jobs, error: jErr }] = await Promise.all([
    admin
      .from("bookings")
      .select("vehicle_id, scheduled_at")
      .in("vehicle_id", ids)
      .gte("scheduled_at", windowStart.toISOString()),
    admin
      .from("jobs")
      .select("vehicle_id, created_at")
      .in("vehicle_id", ids)
      .gte("created_at", windowStart.toISOString()),
  ]);
  if (bErr) throw new Error(`bookings lookup failed: ${bErr.message}`);
  if (jErr) throw new Error(`jobs lookup failed: ${jErr.message}`);

  const activityByVehicle = new Map<string, string[]>();
  for (const row of [...(bookings ?? []), ...(jobs ?? [])] as {
    vehicle_id: string | null;
    scheduled_at?: string;
    created_at?: string;
  }[]) {
    if (!row.vehicle_id) continue;
    const at = (row.scheduled_at ?? row.created_at ?? "").slice(0, 10);
    if (!at) continue;
    const list = activityByVehicle.get(row.vehicle_id);
    if (list) list.push(at);
    else activityByVehicle.set(row.vehicle_id, [at]);
  }

  const windowMs = ELSEWHERE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const elsewhere = new Set<string>();
  for (const c of withTest) {
    const testMs = new Date(`${c.lastTestDate}T00:00:00Z`).getTime();
    const activity = activityByVehicle.get(c.vehicle.id) ?? [];
    const seenHere = activity.some(
      (d) => Math.abs(new Date(`${d}T00:00:00Z`).getTime() - testMs) <= windowMs,
    );
    if (!seenHere) elsewhere.add(c.vehicle.id);
  }
  return elsewhere;
}

/**
 * Write each pending update (stamping mot_synced_at, and moted_elsewhere_at
 * where flagged). Mutates the in-memory rows so a caller applying several
 * batches in one run diffs later ones against what it just wrote.
 */
export async function applyMotUpdates(
  admin: Admin,
  pending: PendingMotUpdate[],
  elsewhere: Set<string>,
  nowIso: string,
): Promise<number> {
  let updated = 0;
  for (const p of pending) {
    const patch: Record<string, string | null> = { mot_synced_at: nowIso };
    if (p.motExpiry !== null) patch.mot_expiry = p.motExpiry;
    if (p.lastTestDate !== null) patch.last_mot_test_date = p.lastTestDate;
    if (elsewhere.has(p.vehicle.id)) patch.moted_elsewhere_at = nowIso;
    const { error } = await admin.from("vehicles").update(patch).eq("id", p.vehicle.id);
    if (error) throw new Error(`vehicle update failed: ${error.message}`);
    updated++;
    if (p.motExpiry !== null) p.vehicle.mot_expiry = p.motExpiry;
    if (p.lastTestDate !== null) p.vehicle.last_mot_test_date = p.lastTestDate;
  }
  return updated;
}
