"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

// Deferred-work pipeline row actions (#498 PR 4). Lifecycle only — records
// are created by the decline/report hooks and recovered automatically by the
// book-it link; these are the manual overrides.

type ActionResult = { error: string } | { success: true };

async function ownRecord(admin: ReturnType<typeof createAdminClient>, locationId: string, id: string) {
  const { data } = await admin
    .from("deferred_work")
    .select("id, location_id, organization_id, status, description")
    .eq("id", id)
    .maybeSingle();
  const row = data as { id: string; location_id: string; organization_id: string | null; status: string; description: string } | null;
  return row && row.location_id === locationId ? row : null;
}

export async function dismissDeferred(id: string, reason: string | null): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "quotes_draft")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const row = await ownRecord(admin, ctx.location.id, id);
  if (!row) return { error: "Record not found." };
  if (row.status !== "open") return { error: "Only open records can be dismissed." };

  const cleanReason = reason?.trim().slice(0, 500) || null;
  const { error } = await admin
    .from("deferred_work")
    .update({ status: "dismissed", dismissed_reason: cleanReason, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "open");
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "deferred.dismissed",
    entityType: "deferred_work",
    entityId: id,
    metadata: { reason: cleanReason, description: row.description },
  });
  revalidatePath("/staff/deferred");
  return { success: true };
}

// Manual recovery — the work got booked/done outside the follow-up link
// (phone call, walk-in). No booking to attribute.
export async function recoverDeferred(id: string): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "quotes_draft")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const row = await ownRecord(admin, ctx.location.id, id);
  if (!row) return { error: "Record not found." };
  if (row.status !== "open") return { error: "Only open records can be marked recovered." };

  const { error } = await admin
    .from("deferred_work")
    .update({ status: "recovered", recovered_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "open");
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "deferred.recovered",
    entityType: "deferred_work",
    entityId: id,
    metadata: { manual: true, description: row.description },
  });
  revalidatePath("/staff/deferred");
  return { success: true };
}

// Undo a dismissal or manual recovery. Restarts the follow-up clock from
// now so the sequence doesn't fire instantly on a stale created_at.
export async function reopenDeferred(id: string): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "quotes_draft")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const row = await ownRecord(admin, ctx.location.id, id);
  if (!row) return { error: "Record not found." };
  if (row.status === "open") return { success: true };

  const now = new Date().toISOString();
  const { error } = await admin
    .from("deferred_work")
    .update({
      status: "open",
      dismissed_reason: null,
      recovered_booking_id: null,
      recovered_at: null,
      followup_count: 0,
      last_followup_at: null,
      created_at: now,
      updated_at: now,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "deferred.reopened",
    entityType: "deferred_work",
    entityId: id,
    metadata: { description: row.description },
  });
  revalidatePath("/staff/deferred");
  return { success: true };
}
