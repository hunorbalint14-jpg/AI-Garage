"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

// SERMI accreditation status (location-level compliance). Owner/admin only.
// Lives under Settings → Compliance; per-technician EV qualifications are on
// the Team page (location_users), shown read-only here as a roster.

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

  revalidatePath("/staff/settings");
  return { success: true };
}
