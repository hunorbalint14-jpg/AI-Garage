"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { entitledTo, UPGRADE_MESSAGE } from "@/lib/tenant-plans";
import { logAudit } from "@/lib/audit";

// Owner-gated receptionist config. The Twilio number itself is provisioned
// by the platform (bought in the Twilio console, webhooks pointed at
// /api/webhooks/twilio/{voice,messages}) — owners just toggle and set where
// voice calls forward to.

export type SaveReceptionistConfigInput = {
  enabled: boolean;
  forwardToPhone: string;
  forwardTimeoutSeconds: number;
};

type ActionResult = { error: string } | { success: true };

export async function saveReceptionistConfig(
  input: SaveReceptionistConfigInput,
): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return { error: "Only the organisation owner can manage the receptionist." };
  }
  if (!entitledTo(ctx.tenantBilling, "receptionist")) {
    return { error: UPGRADE_MESSAGE.receptionist };
  }
  const timeout = Math.round(input.forwardTimeoutSeconds);
  if (timeout < 5 || timeout > 60) {
    return { error: "Forward timeout must be between 5 and 60 seconds." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("receptionist_configs").upsert(
    {
      location_id: ctx.location.id,
      enabled: input.enabled,
      forward_to_phone: input.forwardToPhone.trim() || null,
      forward_timeout_seconds: timeout,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "location_id" },
  );
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    action: "receptionist.config_update",
    entityType: "receptionist_config",
    entityId: ctx.location.id,
    metadata: { enabled: input.enabled, forward_timeout_seconds: timeout, has_forward: !!input.forwardToPhone.trim() },
  });

  revalidatePath("/staff/receptionist");
  return { success: true };
}
