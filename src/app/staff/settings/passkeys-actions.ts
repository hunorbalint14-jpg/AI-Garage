"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

export async function deletePasskey(credentialId: string): Promise<{ error: string } | { success: true }> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  const { error } = await admin
    .from("webauthn_credentials")
    .delete()
    .eq("credential_id", credentialId)
    .eq("user_id", ctx.user.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "passkey.revoke",
    entityType: "webauthn_credential",
    entityId: credentialId,
  });

  revalidatePath("/staff/settings");
  return { success: true };
}
