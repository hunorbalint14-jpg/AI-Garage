import { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

// Known platform crons + a human schedule label. Jobs dispatched by the hourly
// orchestrator (reminders/dunning/…) run "via tick" when their scheduled_tasks
// are due. Keeps the panel complete even before a job's first run.
const SCHEDULES: Record<string, string> = {
  "cron/tick": "hourly",
  "cron/uptime": "every 3 min",
  "cron/quote-expiry": "every 30 min",
  "cron/reminders": "via tick",
  "cron/dunning": "via tick",
  "cron/review-requests": "via tick",
  "cron/digest": "via tick",
};
const KNOWN_JOBS = Object.keys(SCHEDULES);

// Record one completed cron run. Fire-and-forget — never throws.
export async function recordCronRun(
  admin: Admin,
  job: string,
  ok: boolean,
  durationMs: number,
  detail?: string,
): Promise<void> {
  try {
    await admin.from("cron_runs").insert({ job, ok, duration_ms: durationMs, detail: detail ?? null });
  } catch (err) {
    console.error("[cron-runs] record failed", { job, err });
  }
}

export type CronJob = {
  job: string;
  schedule: string;
  ok: boolean | null;
  lastRunAt: string | null;
  durationMs: number | null;
  detail: string | null;
};

// Latest run per known job (over the last 7 days), merged with the static list
// so never-run jobs still appear.
export async function fetchCronJobs(): Promise<CronJob[]> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();
  const { data } = await admin
    .from("cron_runs")
    .select("job, ok, duration_ms, detail, ran_at")
    .gte("ran_at", since)
    .order("ran_at", { ascending: false })
    .limit(5000);

  const latest = new Map<string, { ok: boolean; duration_ms: number | null; detail: string | null; ran_at: string }>();
  for (const r of (data ?? []) as { job: string; ok: boolean; duration_ms: number | null; detail: string | null; ran_at: string }[]) {
    if (!latest.has(r.job)) latest.set(r.job, r);
  }

  return KNOWN_JOBS.map((job) => {
    const r = latest.get(job);
    return {
      job,
      schedule: SCHEDULES[job],
      ok: r ? r.ok : null,
      lastRunAt: r ? r.ran_at : null,
      durationMs: r ? r.duration_ms : null,
      detail: r ? r.detail : null,
    };
  });
}
