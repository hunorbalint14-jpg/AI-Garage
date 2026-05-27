"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

export async function disconnectXero(): Promise<{ error: string } | { success: true }> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "xero_integration")) {
    return { error: "Permission denied." };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({
      xero_tenant_id: null,
      xero_tenant_name: null,
      xero_access_token: null,
      xero_refresh_token: null,
      xero_token_expires_at: null,
      xero_connected_at: null,
    })
    .eq("id", ctx.organization.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "xero.disconnect",
  });

  revalidatePath("/staff/settings");
  return { success: true };
}
