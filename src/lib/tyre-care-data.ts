import type { createAdminClient } from "@/lib/supabase/admin";
import {
  estimateMileage,
  type MileageEstimate,
  type MotAdvisory,
  type OdometerPoint,
  type ServiceType,
  type TyreCheck,
  type TyreConfig,
  type VisitRecord,
  type WheelServiceEvent,
} from "@/lib/tyre-care";

// Data gathering for the tyre-care engine (#596). The rules in tyre-care.ts
// stay pure; this is the only piece that touches the DB, so the cron, the
// vehicle page and the job card share one definition of "everything we know
// about this vehicle's tyres and mileage".

type Admin = ReturnType<typeof createAdminClient>;

/** Vehicles per `.in()` list — keeps the request URL comfortably short. */
const ID_CHUNK = 100;
/** PostgREST's max_rows. Anything beyond it is silently dropped, so page. */
const PAGE = 1000;

/**
 * Every row of `table` whose `column` is in `ids`, paging past the row cap.
 * Throws on any error: a caller that mistook a failed read for "no data"
 * would conclude nothing is due and expire the branch's whole review queue.
 */
async function fetchAllIn<T>(
  admin: Admin,
  table: string,
  select: string,
  column: string,
  ids: string[],
  orderColumn: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from(table)
        .select(select)
        .in(column, chunk)
        .order(orderColumn)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`tyre-care: reading ${table} failed: ${error.message}`);
      const rows = (data ?? []) as T[];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

export type VehicleTyreData = {
  odometerPoints: OdometerPoint[];
  tyreChecks: TyreCheck[];
  motAdvisories: MotAdvisory[];
  serviceEvents: WheelServiceEvent[];
  visits: VisitRecord[];
  tyreConfig: TyreConfig | null;
  /**
   * Whether the garage has ever worked on this car. The spec rules out
   * recommending anything for a vehicle with no service history — MOT data
   * alone would mean contacting someone we have never actually served.
   */
  hasServiceHistory: boolean;
};

function emptyData(): VehicleTyreData {
  return {
    odometerPoints: [],
    tyreChecks: [],
    motAdvisories: [],
    serviceEvents: [],
    visits: [],
    tyreConfig: null,
    hasServiceHistory: false,
  };
}

type MotRow = {
  vehicle_id: string;
  test_date: string;
  odometer_miles: number | null;
  defects: { text?: string; type?: string }[] | null;
};
type JobRow = {
  id: string;
  vehicle_id: string;
  created_at: string;
  completed_at: string | null;
  odometer_miles: number | null;
  description: string | null;
};
type JobItemRow = { job_id: string; description: string | null };
type TyreCheckRow = TyreCheck & { vehicle_id: string };
type HistoryRow = { vehicle_id: string; happened_on: string; mileage: number | null };
type EventRow = WheelServiceEvent & { vehicle_id: string };
type ProfileRow = { vehicle_id: string; tyre_config: TyreConfig };

/** Everything the engine needs for each vehicle, in a handful of paged reads. */
export async function loadTyreCareData(
  admin: Admin,
  vehicleIds: string[],
): Promise<Map<string, VehicleTyreData>> {
  const ids = [...new Set(vehicleIds)];
  const byVehicle = new Map<string, VehicleTyreData>(ids.map((id) => [id, emptyData()]));
  if (ids.length === 0) return byVehicle;

  const [mot, jobs, checks, history, events, profiles] = await Promise.all([
    fetchAllIn<MotRow>(admin, "mot_tests", "vehicle_id, test_date, odometer_miles, defects", "vehicle_id", ids, "id"),
    fetchAllIn<JobRow>(
      admin,
      "jobs",
      "id, vehicle_id, created_at, completed_at, odometer_miles, description",
      "vehicle_id",
      ids,
      "id",
    ),
    fetchAllIn<TyreCheckRow>(
      admin,
      "tyre_checks",
      "vehicle_id, checked_at, nsf_depth, osf_depth, nsr_depth, osr_depth, nsf_replaced, osf_replaced, nsr_replaced, osr_replaced, odometer_miles",
      "vehicle_id",
      ids,
      "id",
    ),
    fetchAllIn<HistoryRow>(
      admin,
      "vehicle_history_entries",
      "vehicle_id, happened_on, mileage",
      "vehicle_id",
      ids,
      "id",
    ),
    fetchAllIn<EventRow>(
      admin,
      "wheel_service_events",
      "vehicle_id, service_type, performed_at, odometer_miles",
      "vehicle_id",
      ids,
      "id",
    ),
    fetchAllIn<ProfileRow>(admin, "vehicle_wheel_profile", "vehicle_id, tyre_config", "vehicle_id", ids, "vehicle_id"),
  ]);

  // Job lines carry the actual work ("Replace track rod end") far more often
  // than the job's own description does, so read them for completed jobs.
  const completedJobIds = jobs.filter((j) => j.completed_at).map((j) => j.id);
  const items = await fetchAllIn<JobItemRow>(
    admin,
    "job_items",
    "job_id, description",
    "job_id",
    completedJobIds,
    "id",
  );
  const itemsByJob = new Map<string, string[]>();
  for (const it of items) {
    if (!it.description) continue;
    itemsByJob.set(it.job_id, [...(itemsByJob.get(it.job_id) ?? []), it.description]);
  }

  for (const r of mot) {
    const d = byVehicle.get(r.vehicle_id);
    if (!d) continue;
    if (r.odometer_miles != null) d.odometerPoints.push({ on: r.test_date, miles: r.odometer_miles, source: "mot" });
    for (const defect of r.defects ?? []) {
      if (typeof defect.text === "string") {
        d.motAdvisories.push({ test_date: r.test_date, text: defect.text, type: defect.type ?? "ADVISORY" });
      }
    }
  }
  for (const r of jobs) {
    const d = byVehicle.get(r.vehicle_id);
    if (!d) continue;
    d.hasServiceHistory = true;
    if (r.odometer_miles != null) d.odometerPoints.push({ on: r.created_at, miles: r.odometer_miles, source: "job" });
    if (r.completed_at) {
      const parts = [r.description, ...(itemsByJob.get(r.id) ?? [])].filter(Boolean);
      d.visits.push({ on: r.completed_at, description: parts.join("; ") || null });
    }
  }
  for (const r of checks) {
    const d = byVehicle.get(r.vehicle_id);
    if (!d) continue;
    const { vehicle_id: _vehicleId, ...check } = r;
    void _vehicleId;
    d.tyreChecks.push(check);
    if (r.odometer_miles != null) {
      d.odometerPoints.push({ on: r.checked_at, miles: r.odometer_miles, source: "tyre_check" });
    }
  }
  for (const r of history) {
    const d = byVehicle.get(r.vehicle_id);
    if (!d) continue;
    d.hasServiceHistory = true;
    if (r.mileage != null) d.odometerPoints.push({ on: r.happened_on, miles: r.mileage, source: "history" });
  }
  for (const r of events) {
    const d = byVehicle.get(r.vehicle_id);
    if (!d) continue;
    d.serviceEvents.push({
      service_type: r.service_type as ServiceType,
      performed_at: r.performed_at,
      odometer_miles: r.odometer_miles,
    });
  }
  for (const r of profiles) {
    const d = byVehicle.get(r.vehicle_id);
    if (d) d.tyreConfig = r.tyre_config;
  }

  return byVehicle;
}

/** Every dated odometer reading for one vehicle. */
export async function loadOdometerPoints(admin: Admin, vehicleId: string): Promise<OdometerPoint[]> {
  const data = await loadTyreCareData(admin, [vehicleId]);
  return data.get(vehicleId)?.odometerPoints ?? [];
}

/**
 * For surfaces that only want the number. Never throws — a failed read shows
 * "not enough readings" on the vehicle page rather than breaking it.
 */
export async function vehicleMileageEstimate(
  admin: Admin,
  vehicleId: string,
  now: Date = new Date(),
): Promise<MileageEstimate | null> {
  try {
    return estimateMileage(await loadOdometerPoints(admin, vehicleId), now);
  } catch (err) {
    console.error("[tyre-care] mileage estimate failed", { vehicleId, err });
    return null;
  }
}
