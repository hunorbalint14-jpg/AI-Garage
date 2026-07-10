import { createAdminClient } from "@/lib/supabase/admin";

// eVHC deferred-work bank (#497 Phase 6, feeds #498). Declined or
// never-quoted amber/red findings from completed/sent health checks,
// queryable per vehicle — the "previously advised" work that walks back in
// the door. #498's follow-up campaigns build on this shape; this module and
// the panel are the only consumers for now.
//
// Not included: findings whose quote simply expired (they stay
// outcome='quoted') — #498 can widen the net when campaigns land.

export type DeferredFinding = {
  id: string;
  vehicleId: string;
  section: string;
  label: string;
  rag: "amber" | "red";
  /** 'none' = advised but never quoted; 'declined' = customer said no. */
  outcome: "none" | "declined";
  customerSummary: string | null;
  note: string | null;
  suggestedRepair: string | null;
  suggestedPrice: number | null;
  inspectionId: string;
  jobId: string;
  /** When the finding was recorded. */
  foundAt: string;
};

type Admin = ReturnType<typeof createAdminClient>;

// Latest outstanding findings for a set of vehicles, newest first, deduped on
// (vehicle, item label) — the same worn part re-graded at the next check
// shouldn't stack up as separate advisories.
export async function deferredFindingsForVehicles(
  admin: Admin,
  vehicleIds: string[],
  opts?: { excludeJobId?: string; limitPerVehicle?: number },
): Promise<Map<string, DeferredFinding[]>> {
  const result = new Map<string, DeferredFinding[]>();
  if (vehicleIds.length === 0) return result;

  const { data } = await admin
    .from("inspection_items")
    .select(
      "id, section, label, rag, note, customer_summary, suggested_repair, suggested_price, outcome, created_at, inspection:inspections!inner(id, vehicle_id, job_id, status)",
    )
    .in("inspection.vehicle_id", vehicleIds)
    .in("inspection.status", ["complete", "sent"])
    .in("rag", ["amber", "red"])
    .in("outcome", ["none", "declined"])
    .order("created_at", { ascending: false })
    .limit(400);

  return groupDeferredRows((data ?? []) as unknown as RawDeferredRow[], opts);
}

export type RawDeferredRow = {
  id: string;
  section: string;
  label: string;
  rag: "amber" | "red";
  note: string | null;
  customer_summary: string | null;
  suggested_repair: string | null;
  suggested_price: number | null;
  outcome: "none" | "declined";
  created_at: string;
  inspection: { id: string; vehicle_id: string; job_id: string; status: string };
};

// Pure half (unit-tested): rows arrive newest-first; dedupe on
// (vehicle, label) so a re-graded item doesn't stack, cap per vehicle,
// optionally drop the current job's own check.
export function groupDeferredRows(
  rows: RawDeferredRow[],
  opts?: { excludeJobId?: string; limitPerVehicle?: number },
): Map<string, DeferredFinding[]> {
  const result = new Map<string, DeferredFinding[]>();
  const limit = opts?.limitPerVehicle ?? 12;
  const seen = new Set<string>();
  for (const r of rows) {
    if (opts?.excludeJobId && r.inspection.job_id === opts.excludeJobId) continue;
    const dedupeKey = `${r.inspection.vehicle_id}|${r.label.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const list = result.get(r.inspection.vehicle_id) ?? [];
    if (list.length >= limit) continue;
    list.push({
      id: r.id,
      vehicleId: r.inspection.vehicle_id,
      section: r.section,
      label: r.label,
      rag: r.rag,
      outcome: r.outcome,
      customerSummary: r.customer_summary,
      note: r.note,
      suggestedRepair: r.suggested_repair,
      suggestedPrice: r.suggested_price,
      inspectionId: r.inspection.id,
      jobId: r.inspection.job_id,
      foundAt: r.created_at,
    });
    result.set(r.inspection.vehicle_id, list);
  }
  return result;
}
