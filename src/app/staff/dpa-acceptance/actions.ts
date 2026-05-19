"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { CURRENT_DPA_VERSION } from "@/lib/dpa";
import { logAudit } from "@/lib/audit";

export async function acceptDpa(): Promise<{ error: string } | void> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return { error: "Only owners/admins can accept the DPA on behalf of the garage." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({
      dpa_accepted_at: new Date().toISOString(),
      dpa_accepted_by_user_id: ctx.user.id,
      dpa_version: CURRENT_DPA_VERSION,
    })
    .eq("id", ctx.organization.id);

  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "dpa.accept",
    entityType: "organization",
    entityId: ctx.organization.id,
    metadata: { dpa_version: CURRENT_DPA_VERSION },
  });

  revalidatePath("/staff", "layout");
  redirect("/staff");
}
