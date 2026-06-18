"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext, invalidateStaffLocationCacheForOrg } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { CURRENT_DPA_VERSION } from "@/lib/dpa";
import { logAudit } from "@/lib/audit";

export async function acceptDpa(): Promise<{ error: string } | { success: true }> {
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

  // The staff context caches the org row (incl. dpa_version) in Redis for 60s.
  // Without evicting it, the /staff layout's DPA gate keeps reading the stale
  // pre-acceptance version and bounces the owner back to /staff/dpa-acceptance
  // (whose page sees fresh data and bounces to /staff) — a redirect loop that
  // renders blank until the TTL expires.
  await invalidateStaffLocationCacheForOrg(ctx.organization.id);

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
  // Return success rather than redirect("/staff"): the next stop is often the
  // shell-bypassed AI-setup gate, and reaching a bypassed route via the client
  // RSC navigation a server redirect triggers renders blank. The form does a
  // hard navigation instead.
  return { success: true };
}
