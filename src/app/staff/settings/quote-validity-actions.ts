"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

export type SaveValidityResult = { error: string } | { success: true; days: number };

export async function saveQuoteValidityDays(formData: FormData): Promise<SaveValidityResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return { error: "Only owners and admins can change quote validity." };
  }

  const raw = (formData.get("days") as string | null)?.trim() ?? "30";
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return { error: "Validity must be an integer between 1 and 365." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ quote_validity_days: days })
    .eq("id", ctx.organization.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "settings.update",
    entityType: "organization",
    entityId: ctx.organization.id,
    metadata: { field: "quote_validity_days", new_value: days },
  });

  revalidatePath("/staff/settings");
  return { success: true, days };
}
