"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlatformAdminUser } from "@/lib/platform-admin";
import { logAudit } from "@/lib/audit";

async function requirePlatformAdmin(): Promise<{ id: string; email?: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!(await isPlatformAdminUser(user))) redirect("/admin/login");
  return user!;
}

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
