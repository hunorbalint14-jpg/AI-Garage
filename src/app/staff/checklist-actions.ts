"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

// Dismiss the setup checklist for the whole org (#506 PR 2). Owner/admin only
// — the checklist is about the org, not the viewer, so dismissal is shared.
export async function dismissSetupChecklist(): Promise<{ error: string } | { success: true }> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") return { error: "Permission denied." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ setup_checklist_dismissed_at: new Date().toISOString() })
    .eq("id", ctx.organization.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "setup_checklist.dismissed",
    entityType: "organization",
    entityId: ctx.organization.id,
  });

  revalidatePath("/staff");
  return { success: true };
}
