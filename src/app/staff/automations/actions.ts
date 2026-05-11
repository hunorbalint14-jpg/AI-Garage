"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";

export type TaskType = "mot_reminders" | "service_reminders" | "tax_reminders" | "weekly_digest";

export type TaskSettings =
  | { remind_days_before: number; channels: string[] }
  | { window_days: number };

type ActionResult = { error: string } | { success: true };

const REMINDER_TYPES: TaskType[] = ["mot_reminders", "service_reminders", "tax_reminders"];

export async function ensureDefaultTasks(locationId: string) {
  const admin = createAdminClient();
  const allTypes: TaskType[] = [...REMINDER_TYPES, "weekly_digest"];
  const defaults: Record<TaskType, object> = {
    mot_reminders:     { remind_days_before: 30, channels: ["email", "sms", "whatsapp"] },
    service_reminders: { remind_days_before: 30, channels: ["email", "sms", "whatsapp"] },
    tax_reminders:     { remind_days_before: 30, channels: ["email", "sms"] },
    weekly_digest:     { window_days: 30 },
  };
  await admin.from("scheduled_tasks").upsert(
    allTypes.map((t) => ({ location_id: locationId, task_type: t, settings: defaults[t] })),
    { onConflict: "location_id,task_type", ignoreDuplicates: true },
  );
}

export async function toggleTask(taskId: string, enabled: boolean): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return { error: "Only owners can manage automations." };
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
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return { error: "Only owners can manage automations." };
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
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return { error: "Only owners can trigger automations." };
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) return { error: "CRON_SECRET not configured." };

  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";
  const protocol = root.includes("localhost") ? "http" : "https";
  const baseUrl = `${protocol}://${root}`;

  const pathMap: Record<TaskType, string> = {
    mot_reminders:     "/api/cron/reminders",
    service_reminders: "/api/cron/reminders",
    tax_reminders:     "/api/cron/reminders",
    weekly_digest:     "/api/cron/digest",
  };

  const res = await fetch(
    `${baseUrl}${pathMap[taskType]}?location_id=${ctx.location.id}&task_type=${taskType}`,
    { headers: { authorization: `Bearer ${secret}` }, cache: "no-store" },
  );

  if (!res.ok) return { error: `Trigger failed: HTTP ${res.status}` };

  const admin = createAdminClient();
  await admin
    .from("scheduled_tasks")
    .update({ last_run_at: new Date().toISOString() })
    .eq("location_id", ctx.location.id)
    .eq("task_type", taskType);

  revalidatePath("/staff/automations");
  return { success: true };
}
