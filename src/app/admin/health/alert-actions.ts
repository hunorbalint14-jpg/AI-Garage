"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { logAudit } from "@/lib/audit";
import { deliverAlert, opsRecipients } from "@/lib/platform/alerts";

export type TestAlertResult =
  | { error: string }
  | { success: true; slack: boolean; email: boolean; recipients: string[] };

/**
 * Fire a real alert down the real delivery path (#450).
 *
 * The acceptance question — "does an alert actually reach a human?" — was
 * previously only answerable by causing an outage. This answers it in ten
 * seconds, using the same deliverAlert() the evaluator uses, so a pass here
 * means a genuine alert would land too.
 */
export async function sendTestAlert(): Promise<TestAlertResult> {
  const actor = await requirePlatformAdmin();
  const recipients = opsRecipients();

  const delivery = await deliverAlert({
    subject: "[TEST] AI Garage ops alert",
    text:
      `This is a test alert sent from /admin/health by ${actor.email ?? "a platform admin"}.\n\n` +
      "Nothing is wrong. If you're reading this, ops alerting reaches a human — which is the whole point of the test.\n\n" +
      "Escalation: docs/ops-escalation.md",
    // Ask for both explicitly; a test that only exercised the fallback would
    // not prove the Slack route works.
    channels: ["Slack #ops", "Email ops"],
  });

  await logAudit({
    action: "alert.test",
    actorUserId: actor.id,
    actorEmail: actor.email ?? null,
    entityType: "alert_rule",
    entityId: null,
    metadata: { slack: delivery.slack, email: delivery.email, recipients: recipients.length },
  });

  if (!delivery.delivered) {
    return {
      error:
        "Nothing was delivered. Set SLACK_OPS_WEBHOOK_URL for Slack, or PLATFORM_SUPPORT_EMAIL / PLATFORM_ADMIN_EMAILS for email — until one is set, alerts reach nobody.",
    };
  }
  return { success: true, slack: delivery.slack, email: delivery.email, recipients };
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
