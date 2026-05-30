"use server";

import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { getCurrentTenant } from "@/lib/tenant-data";

/**
 * Server action that logs an audit entry and signs the user out.
 * Replaces the direct client-side `supabase.auth.signOut()` calls in
 * the staff and customer sign-out buttons so that logouts are recorded.
 */
export async function signOutWithAudit(
  portal: "staff" | "customer",
): Promise<void> {
  const supabase = await createClient();
  const [{ data: { user } }, tenant] = await Promise.all([
    supabase.auth.getUser(),
    getCurrentTenant(),
  ]);

  if (user) {
    await logAudit({
      action: "auth.logout",
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      organizationId: tenant?.organization.id ?? null,
      metadata: { portal, method: "manual" },
    });
  }

  await supabase.auth.signOut();
}
