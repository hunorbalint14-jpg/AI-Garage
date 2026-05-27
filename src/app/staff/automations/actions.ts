"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeNextRunAt, type Frequency } from "@/lib/cron/schedule";

export type TaskType = "mot_reminders" | "service_reminders" | "tax_reminders" | "weekly_digest";

export type TaskSettings =
  | { remind_days_before: number; channels: string[] }
  | { window_days: number };

type ActionResult = { error: string } | { success: true };

const REMINDER_TYPES: TaskType[] = ["mot_reminders", "service_reminders", "tax_reminders"];

export async function ensureDefaultTasks(locationId: string) {
  const admin = createAdminClient();
  const allTypes: TaskType[] = [...REMINDER_TYPES, "weekly_digest"];
  const defaults: Record<TaskType, { settings: object; frequency: Frequency; hour: number; day_of_week: number | null }> = {
    mot_reminders:     { settings: { remind_days_before: 30, channels: ["email", "sms", "whatsapp"] }, frequency: "daily",  hour: 9, day_of_week: null },
    service_reminders: { settings: { remind_days_before: 30, channels: ["email", "sms", "whatsapp"] }, frequency: "daily",  hour: 9, day_of_week: null },
    tax_reminders:     { settings: { remind_days_before: 30, channels: ["email", "sms"] },             frequency: "daily",  hour: 9, day_of_week: null },
    weekly_digest:     { settings: { window_days: 30 },                                                 frequency: "weekly", hour: 8, day_of_week: 1 },
  };
  await admin.from("scheduled_tasks").upsert(
    allTypes.map((t) => {
      const d = defaults[t];
      return {
        location_id: locationId,
        task_type: t,
        settings: d.settings,
        frequency: d.frequency,
        hour: d.hour,
        day_of_week: d.day_of_week,
        next_run_at: computeNextRunAt(d.frequency, d.hour, d.day_of_week).toISOString(),
      };
    }),
    { onConflict: "location_id,task_type", ignoreDuplicates: true },
  );
}

export async function updateSchedule(
  taskId: string,
  frequency: Frequency,
  hour: number,
  dayOfWeek: number | null,
): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "automations")) {
    return { error: "Permission denied." };
  }
  if (hour < 0 || hour > 23) return { error: "Hour must be 0–23." };
  if (frequency === "weekly" && (dayOfWeek === null || dayOfWeek < 0 || dayOfWeek > 6)) {
    return { error: "Day of week required for weekly tasks." };
  }

  const nextRunAt = computeNextRunAt(frequency, hour, dayOfWeek).toISOString();
  const admin = createAdminClient();
  const { error } = await admin
    .from("scheduled_tasks")
    .update({ frequency, hour, day_of_week: frequency === "weekly" ? dayOfWeek : null, next_run_at: nextRunAt })
    .eq("id", taskId)
    .eq("location_id", ctx.location.id);
  if (error) return { error: error.message };
  revalidatePath("/staff/automations");
  return { success: true };
}

export async function toggleTask(taskId: string, enabled: boolean): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "automations")) {
    return { error: "Permission denied." };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("scheduled_tasks")
    .update({ enabled })
    .eq("id", taskId)
    .eq("location_id", ctx.location.id);
  if (error) return { error: error.message };
  revalidatePath("/staff/automations");
  return { success: true };
}

export async function updateTaskSettings(taskId: string, settings: TaskSettings): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "automations")) {
    return { error: "Permission denied." };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("scheduled_tasks")
    .update({ settings })
    .eq("id", taskId)
    .eq("location_id", ctx.location.id);
  if (error) return { error: error.message };
  revalidatePath("/staff/automations");
  return { success: true };
}

export async function runTaskNow(taskType: TaskType): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "automations")) {
    return { error: "Permission denied." };
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) return { error: "CRON_SECRET not configured." };

  const { headers } = await import("next/headers");
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") || host.includes("localtest.me") ? "http" : "https");
  const baseUrl = `${proto}://${host}`;

  const pathMap: Record<TaskType, string> = {
    mot_reminders:     "/api/cron/reminders",
    service_reminders: "/api/cron/reminders",
    tax_reminders:     "/api/cron/reminders",
    weekly_digest:     "/api/cron/digest",
  };

  try {
    const res = await fetch(
      `${baseUrl}${pathMap[taskType]}?location_id=${ctx.location.id}&task_type=${taskType}`,
      { headers: { authorization: `Bearer ${secret}` }, cache: "no-store" },
    );
    if (!res.ok) return { error: `Trigger failed: HTTP ${res.status}` };
  } catch (e) {
    return { error: `Trigger failed: ${(e as Error).message}` };
  }

  const admin = createAdminClient();
  await admin
    .from("scheduled_tasks")
    .update({ last_run_at: new Date().toISOString() })
    .eq("location_id", ctx.location.id)
    .eq("task_type", taskType);

  revalidatePath("/staff/automations");
  return { success: true };
}
