import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/safe-equal";
import { computeNextRunAt, type Frequency } from "@/lib/cron/schedule";
import { runUptimeMaintenance } from "@/lib/platform/uptime-maintenance";

export const runtime = "nodejs";
export const maxDuration = 60;

// Runs hourly via Vercel Cron. Finds scheduled_tasks where next_run_at <= now,
// dispatches each to the appropriate cron route with location_id + task_type
// filters, then advances next_run_at to the next occurrence.

type TaskRow = {
  id: string;
  location_id: string;
  task_type: string;
  frequency: Frequency;
  hour: number;
  day_of_week: number | null;
  next_run_at: string | null;
};

const TASK_ROUTE: Record<string, string> = {
  mot_reminders: "/api/cron/reminders",
  service_reminders: "/api/cron/reminders",
  tax_reminders: "/api/cron/reminders",
  weekly_digest: "/api/cron/digest",
  invoice_dunning: "/api/cron/dunning",
  review_requests: "/api/cron/review-requests",
};

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();
  const nowIso = now.toISOString();

  const { data: due } = await admin
    .from("scheduled_tasks")
    .select("id, location_id, task_type, frequency, hour, day_of_week, next_run_at")
    .eq("enabled", true)
    .or(`next_run_at.lte.${nowIso},next_run_at.is.null`);

  const tasks = (due ?? []) as TaskRow[];

  const origin = new URL(request.url).origin;
  const secret = process.env.CRON_SECRET!;

  const results = { ran: 0, failed: 0, errors: [] as string[] };

  for (const task of tasks) {
    const path = TASK_ROUTE[task.task_type];
    if (!path) continue;

    try {
      const params = new URLSearchParams({
        location_id: task.location_id,
        task_type: task.task_type,
      });
      const res = await fetch(`${origin}${path}?${params}`, {
        headers: { authorization: `Bearer ${secret}` },
        cache: "no-store",
      });
      if (res.ok) {
        results.ran++;
      } else {
        results.failed++;
        results.errors.push(`${task.task_type} @ ${task.location_id}: HTTP ${res.status}`);
      }
    } catch (e) {
      results.failed++;
      results.errors.push(`${task.task_type} @ ${task.location_id}: ${(e as Error).message}`);
    }

    const nextRunAt = computeNextRunAt(task.frequency, task.hour, task.day_of_week, now);
    await admin
      .from("scheduled_tasks")
      .update({ last_run_at: nowIso, next_run_at: nextRunAt.toISOString() })
      .eq("id", task.id);
  }

  // Hourly maintenance for the reliability store (rollup + raw-sample retention).
  await runUptimeMaintenance(admin);

  console.log("[cron/tick]", results);
  return NextResponse.json({ success: true, ...results, tasks_checked: tasks.length });
}
