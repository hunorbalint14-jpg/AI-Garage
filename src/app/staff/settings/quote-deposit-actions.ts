"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

export type SaveDepositResult = { error: string } | { success: true; pct: number };

export async function saveQuoteDepositPct(formData: FormData): Promise<SaveDepositResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return { error: "Only owners and admins can change the deposit policy." };
  }

  const raw = (formData.get("pct") as string | null)?.trim() ?? "0";
  const pct = Number(raw);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    return { error: "Deposit must be between 0 and 100." };
  }
  const rounded = Math.round(pct * 100) / 100;

  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ quote_deposit_pct: rounded })
    .eq("id", ctx.organization.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "settings.update",
    entityType: "organization",
    entityId: ctx.organization.id,
    metadata: { field: "quote_deposit_pct", new_value: rounded },
  });

  revalidatePath("/staff/settings");
  return { success: true, pct: rounded };
}
