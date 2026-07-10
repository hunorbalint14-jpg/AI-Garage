"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

// Costing settings (#502): the org's labour cost rate (£/hour) — what an
// hour on the clock costs the business. Powers labour cost + gross profit;
// unset = those figures render as unknown.

export type SaveCostingResult = { error: string } | { success: true };

export async function saveLabourCostRate(formData: FormData): Promise<SaveCostingResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "org_settings")) return { error: "Permission denied." };

  const raw = ((formData.get("rate") as string | null) ?? "").trim();
  let rate: number | null = null;
  if (raw !== "") {
    rate = Number(raw);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1000) {
      return { error: "Labour cost rate must be between 0 and 1000 £/hour (leave empty to unset)." };
    }
    rate = Math.round(rate * 100) / 100;
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ labour_cost_rate: rate })
    .eq("id", ctx.organization.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "settings.update",
    entityType: "organization",
    entityId: ctx.organization.id,
    metadata: { field: "labour_cost_rate", new_value: rate },
  });

  revalidatePath("/staff/settings");
  return { success: true };
}
