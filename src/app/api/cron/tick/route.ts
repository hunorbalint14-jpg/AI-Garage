import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/safe-equal";
import { computeNextRunAt, type Frequency } from "@/lib/cron/schedule";
import { runUptimeMaintenance } from "@/lib/platform/uptime-maintenance";
import { reconcileFinanceApplications } from "@/lib/finance/reconcile";
import { recordCronRun } from "@/lib/platform/cron-runs";
import { cronBaseUrl, dispatchCron } from "@/lib/cron/dispatch";

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
  booking_confirmations: "/api/cron/booking-confirmations",
  deferred_followups: "/api/cron/deferred-followups",
  tyre_care: "/api/cron/tyre-care",
};

// Tasks dispatched in parallel. Serial dispatch meant every due task's child
// route ran inside tick's own 60s budget back-to-back — a handful of slow
// locations blew the budget and the remaining tasks never advanced
// next_run_at. Kept modest: each child route does its own AI drafting and
// provider sends.
const DISPATCH_CONCURRENCY = 4;

// Minimal worker pool: run fn over items with at most `limit` in flight.
// fn must not throw — the per-task body catches and records its own failures.
async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i]);
      }
    }),
  );
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const __t0 = Date.now();
  const now = new Date();
  const nowIso = now.toISOString();

  const { data: due } = await admin
    .from("scheduled_tasks")
    .select("id, location_id, task_type, frequency, hour, day_of_week, next_run_at")
    .eq("enabled", true)
    .or(`next_run_at.lte.${nowIso},next_run_at.is.null`);

  const tasks = (due ?? []) as TaskRow[];

  // NOT request.url's origin: Vercel Cron invokes the tick on the *.vercel.app
  // deployment URL, which Deployment Protection guards — see lib/cron/dispatch.
  const origin = cronBaseUrl(new URL(request.url).origin);
  const secret = process.env.CRON_SECRET!;

  const results = { ran: 0, failed: 0, passes: 0, errors: [] as string[] };

  await mapPool(tasks, DISPATCH_CONCURRENCY, async (task) => {
    const path = TASK_ROUTE[task.task_type];
    if (!path) return;

    const params = new URLSearchParams({
      location_id: task.location_id,
      task_type: task.task_type,
    });
    const r = await dispatchCron(`${origin}${path}?${params}`, secret);
    if (r.ok) {
      results.ran++;
    } else {
      results.failed++;
      results.errors.push(`${task.task_type} @ ${task.location_id}: ${r.error}`);
    }

    const nextRunAt = computeNextRunAt(task.frequency, task.hour, task.day_of_week, now);
    await admin
      .from("scheduled_tasks")
      .update({ last_run_at: nowIso, next_run_at: nextRunAt.toISOString() })
      .eq("id", task.id);
  });

  // Hourly maintenance for the reliability store (rollup + raw-sample retention).
  await runUptimeMaintenance(admin);

  // Finance status safety net — Bumper has no webhook, so poll open
  // applications whose customers never returned from the hosted checkout.
  try {
    await reconcileFinanceApplications(admin);
  } catch (e) {
    console.error("[cron/tick] finance reconcile failed", e);
  }

  // Daily platform-level passes on the 09:00 tick — both routes are
  // idempotent, so a double fire is safe and a missed hour runs next day.
  // A failed pass counts as a failed dispatch — it used to be logged only, so
  // the tick's own run history said "failed 0" while every pass was dead.
  if (now.getUTCHours() === 9) {
    for (const path of ["/api/cron/activation", "/api/cron/overage-reconcile", "/api/cron/traffic-rollup", "/api/cron/accounting-backfill"]) {
      const r = await dispatchCron(`${origin}${path}`, secret);
      if (r.ok) {
        results.passes++;
      } else {
        results.failed++;
        results.errors.push(`${path}: ${r.error}`);
      }
    }
  }

  const detail =
    `ran ${results.ran}, failed ${results.failed}` +
    (results.passes ? `, passes ${results.passes}` : "") +
    (results.errors.length ? ` — ${results.errors[0]}`.slice(0, 200) : "");
  await recordCronRun(admin, "cron/tick", results.failed === 0, Date.now() - __t0, detail);

  console.log("[cron/tick]", results);
  return NextResponse.json({ success: true, ...results, tasks_checked: tasks.length });
}
