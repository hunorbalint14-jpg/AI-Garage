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

// How long a job may go without a run before it counts as dead (#450).
//
// Only the Vercel-scheduled jobs are watched: the "via tick" jobs run when some
// location's scheduled_tasks fall due, so a quiet day is normal for them and
// watching them would alert constantly.
//
// Caveat worth knowing: this check runs inside cron/uptime, so it cannot detect
// its own death. If the platform's cron scheduler stops entirely, nothing here
// fires — that needs an EXTERNAL dead-man's switch (see docs/ops-escalation.md).
// What it does catch is one job dying while the scheduler keeps running, which
// is the far more common failure.
const MAX_AGE_MINS: Record<string, number> = {
  "cron/tick": 90, // hourly
  "cron/uptime": 20, // every 3 min
  "cron/quote-expiry": 90, // every 30 min
};

export type StaleCron = { job: string; ageMins: number; maxMins: number; overdueMins: number };

/**
 * Watched jobs that haven't run inside their allowance, worst first.
 *
 * A job with no run at all in the retention window is reported as stale with
 * its age measured from the window start — a job that has never run is exactly
 * as broken as one that stopped.
 *
 * Pure, so the rules are unit-tested without a database.
 */
export function staleCronJobs(jobs: CronJob[], now: Date = new Date()): StaleCron[] {
  const stale: StaleCron[] = [];
  for (const job of jobs) {
    const maxMins = MAX_AGE_MINS[job.job];
    if (!maxMins) continue;
    const ageMins = job.lastRunAt
      ? Math.floor((now.getTime() - new Date(job.lastRunAt).getTime()) / 60_000)
      : 7 * 24 * 60;
    if (ageMins > maxMins) {
      stale.push({ job: job.job, ageMins, maxMins, overdueMins: ageMins - maxMins });
    }
  }
  return stale.sort((a, b) => b.overdueMins - a.overdueMins);
}

/** staleCronJobs over the live run history. */
export async function fetchStaleCronJobs(now: Date = new Date()): Promise<StaleCron[]> {
  return staleCronJobs(await fetchCronJobs(), now);
}

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
