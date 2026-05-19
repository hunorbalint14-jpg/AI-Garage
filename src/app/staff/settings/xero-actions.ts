"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";

export async function disconnectXero(): Promise<{ error: string } | { success: true }> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return { error: "Only owners and admins can disconnect Xero." };
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

  revalidatePath("/staff/settings");
  return { success: true };
}
