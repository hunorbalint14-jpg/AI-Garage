"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { logAudit } from "@/lib/audit";

export async function setAlertRuleEnabled(
  ruleId: string,
  enabled: boolean,
): Promise<{ error: string } | { success: true }> {
  const actor = await requirePlatformAdmin();
  if (!ruleId) return { error: "Missing rule." };
  const admin = createAdminClient();
  const { error } = await admin.from("alert_rules").update({ enabled }).eq("id", ruleId);
  if (error) return { error: error.message };
  await logAudit({
    action: "alert.toggle",
    actorUserId: actor.id,
    actorEmail: actor.email ?? null,
    entityType: "alert_rule",
    entityId: ruleId,
    metadata: { enabled },
  });
  revalidatePath("/admin/health");
  return { success: true };
}
