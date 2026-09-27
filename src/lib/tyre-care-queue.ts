import type { Confidence, Evidence, ServiceType } from "@/lib/tyre-care";

// Review-queue planner (#596, PR 4). The engine says what is due today; this
// reconciles that against what is already in `tyre_recommendations`, so the
// daily run neither duplicates a queued item nor overrides a staff decision.
// Pure, so the rules are unit-tested rather than discovered in production.

const DAY_MS = 24 * 60 * 60 * 1000;

/** A dismissal is respected this long before the same trigger can resurface. */
export const DISMISS_SNOOZE_DAYS = 90;
/** After a customer has been asked (or booked), leave them alone this long. */
export const CONTACTED_QUIET_DAYS = 90;

export type RecommendationStatus =
  | "pending_review"
  | "approved_sent"
  | "dismissed"
  | "converted"
  | "expired";

export type ExistingRecommendation = {
  id: string;
  vehicle_id: string;
  service_type: ServiceType;
  status: RecommendationStatus;
  reviewed_at: string | null;
  sent_at: string | null;
  converted_at: string | null;
};

export type FreshRecommendation = {
  vehicle_id: string;
  customer_id: string;
  service_type: ServiceType;
  confidence: Confidence;
  evidence: Evidence;
};

export type QueuePlan = {
  inserts: FreshRecommendation[];
  refreshes: { id: string; confidence: Confidence; evidence: Evidence }[];
  /** Queued items whose trigger no longer holds — never let staff approve stale evidence. */
  expires: string[];
  /** Due, but held back by a recent staff dismissal or customer contact. */
  held: { vehicle_id: string; service_type: ServiceType; reason: "dismissed" | "contacted" }[];
};

function within(iso: string | null, days: number, now: Date): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && now.getTime() - t < days * DAY_MS;
}

const key = (vehicleId: string, serviceType: ServiceType) => `${vehicleId}|${serviceType}`;

/**
 * @param evaluatedVehicleIds every vehicle the engine looked at this run. A
 *   queued item is only expired when its vehicle was actually evaluated — a
 *   run cut short by its time budget must not wipe the queue for the rest.
 */
export function planRecommendations(
  existing: ExistingRecommendation[],
  fresh: FreshRecommendation[],
  evaluatedVehicleIds: Set<string>,
  now: Date = new Date(),
): QueuePlan {
  const byKey = new Map<string, ExistingRecommendation[]>();
  for (const row of existing) {
    const k = key(row.vehicle_id, row.service_type);
    byKey.set(k, [...(byKey.get(k) ?? []), row]);
  }

  const plan: QueuePlan = { inserts: [], refreshes: [], expires: [], held: [] };
  const freshKeys = new Set<string>();

  for (const rec of fresh) {
    const k = key(rec.vehicle_id, rec.service_type);
    if (freshKeys.has(k)) continue; // the engine emits one per service; stay safe anyway
    freshKeys.add(k);
    const rows = byKey.get(k) ?? [];

    const pending = rows.find((r) => r.status === "pending_review");
    if (pending) {
      // Same item, newer numbers — staff see today's evidence, not last week's.
      plan.refreshes.push({ id: pending.id, confidence: rec.confidence, evidence: rec.evidence });
      continue;
    }
    if (rows.some((r) => r.status === "dismissed" && within(r.reviewed_at, DISMISS_SNOOZE_DAYS, now))) {
      plan.held.push({ vehicle_id: rec.vehicle_id, service_type: rec.service_type, reason: "dismissed" });
      continue;
    }
    if (
      rows.some(
        (r) =>
          (r.status === "approved_sent" && within(r.sent_at, CONTACTED_QUIET_DAYS, now)) ||
          (r.status === "converted" && within(r.converted_at, CONTACTED_QUIET_DAYS, now)),
      )
    ) {
      plan.held.push({ vehicle_id: rec.vehicle_id, service_type: rec.service_type, reason: "contacted" });
      continue;
    }
    plan.inserts.push(rec);
  }

  for (const row of existing) {
    if (row.status !== "pending_review") continue;
    if (!evaluatedVehicleIds.has(row.vehicle_id)) continue;
    if (freshKeys.has(key(row.vehicle_id, row.service_type))) continue;
    plan.expires.push(row.id);
  }

  return plan;
}
