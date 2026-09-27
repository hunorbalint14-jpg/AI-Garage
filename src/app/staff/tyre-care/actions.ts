"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

// Tyre-care review queue actions (#596 PR 4). Staff judgement is the point of
// the queue — a dismissal is recorded with its reason, and the rejection rate
// is the false-positive signal the thresholds get tuned against.

type ActionResult = { error: string } | { success: true };

async function ownRecommendation(admin: ReturnType<typeof createAdminClient>, locationId: string, id: string) {
  const { data } = await admin
    .from("tyre_recommendations")
    .select("id, location_id, status, service_type, vehicle_id")
    .eq("id", id)
    .maybeSingle();
  const row = data as {
    id: string;
    location_id: string;
    status: string;
    service_type: string;
    vehicle_id: string;
  } | null;
  return row && row.location_id === locationId ? row : null;
}

export async function dismissTyreRecommendation(id: string, reason: string | null): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "reminders")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const row = await ownRecommendation(admin, ctx.location.id, id);
  if (!row) return { error: "Recommendation not found." };
  if (row.status !== "pending_review") return { error: "Only recommendations awaiting review can be dismissed." };

  const cleanReason = reason?.trim().slice(0, 500) || null;
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("tyre_recommendations")
    .update({
      status: "dismissed",
      dismissed_reason: cleanReason,
      reviewed_by: ctx.user.id,
      reviewed_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", id)
    .eq("status", "pending_review")
    .select("id");
  if (error) return { error: error.message };
  // The nightly run can expire an item between page load and click.
  if (!data || data.length === 0) return { error: "This recommendation has just changed — refresh the page." };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "tyre_care.dismissed",
    entityType: "tyre_recommendation",
    entityId: id,
    metadata: { reason: cleanReason, service_type: row.service_type, vehicle_id: row.vehicle_id },
  });
  revalidatePath("/staff/tyre-care");
  return { success: true };
}

/**
 * Put a dismissed item back in the queue. The next nightly run then either
 * refreshes it (still due) or expires it (no longer due) — so reopening can't
 * resurrect a recommendation whose evidence has gone.
 */
export async function reopenTyreRecommendation(id: string): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "reminders")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const row = await ownRecommendation(admin, ctx.location.id, id);
  if (!row) return { error: "Recommendation not found." };
  if (row.status !== "dismissed") return { error: "Only dismissed recommendations can be reopened." };

  const { data, error } = await admin
    .from("tyre_recommendations")
    .update({
      status: "pending_review",
      dismissed_reason: null,
      reviewed_by: null,
      reviewed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "dismissed")
    .select("id");
  if (error) {
    // One open item per vehicle and service — the nightly run may have
    // raised a fresh one since this was dismissed.
    if (error.code === "23505") return { error: "There's already an open recommendation for this vehicle and service." };
    return { error: error.message };
  }
  if (!data || data.length === 0) return { error: "This recommendation has just changed — refresh the page." };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "tyre_care.reopened",
    entityType: "tyre_recommendation",
    entityId: id,
    metadata: { service_type: row.service_type, vehicle_id: row.vehicle_id },
  });
  revalidatePath("/staff/tyre-care");
  return { success: true };
}
