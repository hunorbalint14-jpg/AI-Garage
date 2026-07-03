"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import {
  normaliseReminderDays,
  REMINDER_DAYS_MAX_ENTRIES,
  REMINDER_MAX_LIMIT,
} from "@/lib/quote-reminders";

export type SaveRemindersResult =
  | { error: string }
  | { success: true; enabled: boolean; days: number[]; maxCount: number };

export async function saveQuoteReminderSettings(args: {
  enabled: boolean;
  days: number[];
  maxCount: number;
}): Promise<SaveRemindersResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "org_settings")) {
    return { error: "Permission denied." };
  }

  if (!Array.isArray(args.days) || args.days.length === 0) {
    return { error: "Add at least one reminder day." };
  }
  if (args.days.length > REMINDER_DAYS_MAX_ENTRIES) {
    return { error: `At most ${REMINDER_DAYS_MAX_ENTRIES} reminder days.` };
  }
  if (args.days.some((d) => !Number.isInteger(d) || d < 1 || d > 365)) {
    return { error: "Reminder days must be whole numbers between 1 and 365." };
  }
  const days = normaliseReminderDays(args.days);

  const maxCount = Number(args.maxCount);
  if (!Number.isInteger(maxCount) || maxCount < 1 || maxCount > REMINDER_MAX_LIMIT) {
    return { error: `Maximum reminders must be between 1 and ${REMINDER_MAX_LIMIT}.` };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({
      quote_reminders_enabled: !!args.enabled,
      quote_reminder_days: days,
      quote_reminder_max: maxCount,
    })
    .eq("id", ctx.organization.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "settings.update",
    entityType: "organization",
    entityId: ctx.organization.id,
    metadata: { field: "quote_reminders", enabled: !!args.enabled, days, max: maxCount },
  });

  revalidatePath("/staff/settings");
  return { success: true, enabled: !!args.enabled, days, maxCount };
}
