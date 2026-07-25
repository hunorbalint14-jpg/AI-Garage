"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { clearHeld, fetchHeldSummary } from "@/lib/held-comms";
import { isLocationLive } from "@/lib/prelive";

type ActionResult = { error: string } | { success: true; sending: number };

/**
 * Take the active branch live (#586).
 *
 * Owner-only: this is the moment real customers start being messaged, and it
 * isn't undoable from the UI. Idempotent — a second press on an already-live
 * branch is a no-op rather than a re-stamp, so the recorded go-live date stays
 * the real one.
 */
export async function goLive(): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner") {
    return { error: "Only the account owner can take a branch live." };
  }
  if (isLocationLive(ctx.activeLocation)) {
    return { error: "This branch is already live." };
  }

  const admin = createAdminClient();

  // Count what's waiting BEFORE clearing, so the audit row records the size of
  // the first send — the thing anyone investigating later will want.
  const summary = await fetchHeldSummary(admin, ctx.activeLocation.id);

  const { error } = await admin
    .from("locations")
    .update({ live_at: new Date().toISOString() })
    .eq("id", ctx.activeLocation.id)
    .is("live_at", null);
  if (error) return { error: error.message };

  // The real crons own these sends from now on; a leftover hold would only
  // misreport the branch on any later view.
  await clearHeld(admin, ctx.activeLocation.id);

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "location.go_live",
    entityType: "location",
    entityId: ctx.activeLocation.id,
    metadata: {
      location_name: ctx.activeLocation.name,
      pending_sends: summary.total,
      by_kind: Object.fromEntries(summary.groups.map((g) => [g.kind, g.count])),
    },
  });

  revalidatePath("/staff", "layout");
  return { success: true, sending: summary.total };
}
