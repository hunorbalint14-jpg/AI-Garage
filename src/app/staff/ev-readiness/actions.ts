"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

// SERMI status + technician EV qualifications. Owner/admin writes only —
// this is compliance record-keeping, not day-to-day ops.

type ActionResult = { error: string } | { success: true };

const SERMI_STATUSES = ["not_applied", "applied", "accredited", "lapsed"] as const;

export async function saveSermiStatus(formData: FormData): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return { error: "Only owners and admins can change this." };
  }

  const status = String(formData.get("status") ?? "");
  const reference = String(formData.get("reference") ?? "").trim() || null;
  const expiresAt = String(formData.get("expiresAt") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!(SERMI_STATUSES as readonly string[]).includes(status)) {
    return { error: "Unknown SERMI status." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("location_ev_readiness").upsert(
    {
      location_id: ctx.location.id,
      sermi_status: status,
      sermi_reference: reference,
      sermi_expires_at: expiresAt,
      notes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "location_id" },
  );
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    action: "ev.sermi_update",
    entityType: "location",
    entityId: ctx.location.id,
    metadata: { sermi_status: status, has_reference: !!reference, expires_at: expiresAt },
  });

  revalidatePath("/staff/ev-readiness");
  return { success: true };
}

export async function saveStaffQual(formData: FormData): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return { error: "Only owners and admins can change this." };
  }

  const userId = String(formData.get("userId") ?? "").trim();
  const level = Number(formData.get("level"));
  const certifiedAt = String(formData.get("certifiedAt") ?? "").trim() || null;
  const expiresAt = String(formData.get("expiresAt") ?? "").trim() || null;
  if (!userId) return { error: "Staff member missing." };
  if (!Number.isInteger(level) || level < 0 || level > 4) {
    return { error: "Level must be 0 (none) to 4." };
  }

  const admin = createAdminClient();

  if (level === 0) {
    // 0 = no qualification: remove the row.
    const { error } = await admin
      .from("staff_ev_quals")
      .delete()
      .eq("location_id", ctx.location.id)
      .eq("user_id", userId);
    if (error) return { error: error.message };
  } else {
    const { error } = await admin.from("staff_ev_quals").upsert(
      {
        location_id: ctx.location.id,
        user_id: userId,
        level,
        certified_at: certifiedAt,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "location_id,user_id" },
    );
    if (error) return { error: error.message };
  }

  await logAudit({
    organizationId: ctx.organization.id,
    action: "ev.qual_update",
    entityType: "staff_ev_qual",
    entityId: userId,
    metadata: { level, expires_at: expiresAt },
  });

  revalidatePath("/staff/ev-readiness");
  return { success: true };
}
