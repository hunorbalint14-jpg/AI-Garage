import type { createAdminClient } from "@/lib/supabase/admin";
import { estimateMileage, type MileageEstimate, type OdometerPoint } from "@/lib/tyre-care";

// Odometer gathering for the tyre-care engine (#596, PR 3). The rules live in
// tyre-care.ts and stay pure; this is the only piece that touches the DB, so
// the cron (PR 4) and the vehicle page share one definition of "every dated
// mileage reading we hold for this vehicle".

/**
 * Every dated odometer reading for a vehicle, from all four sources:
 * MOT tests, job visits, tyre checks, and migrated pre-platform history.
 * Order is not guaranteed — estimateMileage sorts and de-duplicates.
 */
export async function loadOdometerPoints(
  admin: ReturnType<typeof createAdminClient>,
  vehicleId: string,
): Promise<OdometerPoint[]> {
  const [mot, jobs, checks, history] = await Promise.all([
    admin
      .from("mot_tests")
      .select("test_date, odometer_miles")
      .eq("vehicle_id", vehicleId)
      .not("odometer_miles", "is", null),
    admin
      .from("jobs")
      .select("created_at, odometer_miles")
      .eq("vehicle_id", vehicleId)
      .not("odometer_miles", "is", null),
    admin
      .from("tyre_checks")
      .select("checked_at, odometer_miles")
      .eq("vehicle_id", vehicleId)
      .not("odometer_miles", "is", null),
    admin
      .from("vehicle_history_entries")
      .select("happened_on, mileage")
      .eq("vehicle_id", vehicleId)
      .not("mileage", "is", null),
  ]);

  const points: OdometerPoint[] = [];
  for (const r of (mot.data ?? []) as { test_date: string; odometer_miles: number }[]) {
    points.push({ on: r.test_date, miles: r.odometer_miles, source: "mot" });
  }
  for (const r of (jobs.data ?? []) as { created_at: string; odometer_miles: number }[]) {
    points.push({ on: r.created_at, miles: r.odometer_miles, source: "job" });
  }
  for (const r of (checks.data ?? []) as { checked_at: string; odometer_miles: number }[]) {
    points.push({ on: r.checked_at, miles: r.odometer_miles, source: "tyre_check" });
  }
  for (const r of (history.data ?? []) as { happened_on: string; mileage: number }[]) {
    points.push({ on: r.happened_on, miles: r.mileage, source: "history" });
  }
  return points;
}

/** Convenience for surfaces that only want the number. */
export async function vehicleMileageEstimate(
  admin: ReturnType<typeof createAdminClient>,
  vehicleId: string,
  now: Date = new Date(),
): Promise<MileageEstimate | null> {
  return estimateMileage(await loadOdometerPoints(admin, vehicleId), now);
}
