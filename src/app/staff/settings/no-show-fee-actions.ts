"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

export type SaveNoShowFeeResult = { error: string } | { success: true; feePence: number };

// Org-level no-show fee. 0 disables the card-save step on the booking
// widget. Capped at £100 — a "fee", not a fine.
export async function saveNoShowFee(formData: FormData): Promise<SaveNoShowFeeResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return { error: "Only owners and admins can change this." };
  }

  const raw = Number(formData.get("fee"));
  if (!Number.isFinite(raw) || raw < 0 || raw > 100) {
    return { error: "Fee must be between £0 and £100." };
  }
  const feePence = Math.round(raw * 100);

  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ no_show_fee_pence: feePence })
    .eq("id", ctx.organization.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    action: "settings.update",
    entityType: "organization",
    entityId: ctx.organization.id,
    metadata: { no_show_fee_pence: feePence },
  });

  revalidatePath("/staff/settings");
  return { success: true, feePence };
}
