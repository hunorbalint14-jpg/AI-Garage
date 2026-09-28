import { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

// Known platform crons + a human schedule label. Keeps the panel complete even
// before a job's first run.
//
// ONLY jobs listed here appear on /admin/health at all: fetchCronJobs() maps
// over this list, so an unlisted job's runs are recorded and then never shown
// or stale-checked. Seven jobs once ran that way (mot-delta and golden-path
// among them). cron-runs.test.ts now fails if any recordCronRun() name or any
// vercel.json cron is missing from here.
const SCHEDULES: Record<string, string> = {
  // Vercel-scheduled (vercel.json).
  "cron/tick": "hourly",
  "cron/uptime": "every 3 min",
  "cron/golden-path": "every 10 min",
  "cron/quote-expiry": "every 30 min",
  "cron/mot-delta": "daily 03:45 UTC",
  "cron/mot-reconcile": "daily 04:15 UTC",
  // Platform-wide passes the tick fires once a day, on its 09:00 UTC run.
  "cron/activation": "daily via tick (09:00 UTC)",
  "cron/overage-reconcile": "daily via tick (09:00 UTC)",
  "cron/traffic-rollup": "daily via tick (09:00 UTC)",
  "cron/accounting-backfill": "daily via tick (09:00 UTC)",
  // Per-branch: the tick dispatches these when a location's scheduled_tasks
  // row falls due.
  "cron/reminders": "via tick",
  "cron/dunning": "via tick",
  "cron/review-requests": "via tick",
  "cron/digest": "via tick",
  "cron/tyre-care": "via tick",
  "cron/booking-confirmations": "via tick",
  "cron/deferred-followups": "via tick",
};
export const KNOWN_JOBS = Object.keys(SCHEDULES);

// How long a job may go without a run before it counts as dead (#450).
//
// Watched: the Vercel-scheduled jobs, and the daily platform passes the tick
// fires — both run every day whatever the tenants are doing, so a gap means
// something broke. The per-branch "via tick" jobs are NOT watched: they run
// when some location's scheduled_tasks fall due, so a quiet day is normal for
// them and watching them would alert constantly.
//
// A watched job must record a run on EVERY path, skips included (see
// activation's flag-off and overage-reconcile's no-price early returns) —
// otherwise a deliberate no-op reads as a dead job.
//
// Caveat worth knowing: this check runs inside cron/uptime, so it cannot detect
// its own death. If the platform's cron scheduler stops entirely, nothing here
// fires — that needs an EXTERNAL dead-man's switch (see docs/ops-escalation.md).
// What it does catch is one job dying while the scheduler keeps running, which
// is the far more common failure.
const DAILY_VIA_TICK_MAX_MINS = 50 * 60;
const MAX_AGE_MINS: Record<string, number> = {
  "cron/tick": 90, // hourly
  "cron/uptime": 20, // every 3 min
  "cron/golden-path": 30, // every 10 min — three missed runs
  "cron/quote-expiry": 90, // every 30 min
  "cron/mot-delta": 26 * 60, // daily, plus slack for Vercel's cron jitter
  "cron/mot-reconcile": 26 * 60, // daily
  // Fired only by the 09:00 UTC tick, and by design "a missed hour runs next
  // day" — so tolerate one missed day and alert on the second.
  "cron/activation": DAILY_VIA_TICK_MAX_MINS,
  "cron/overage-reconcile": DAILY_VIA_TICK_MAX_MINS,
  "cron/traffic-rollup": DAILY_VIA_TICK_MAX_MINS,
  "cron/accounting-backfill": DAILY_VIA_TICK_MAX_MINS,
};

// When a job STARTED being watched, for jobs added to the watch list with no
// run history. A watched job with no run in the window is normally dead — but a
// newly watched one simply hasn't reached its first slot yet: cron/mot-reconcile
// deployed at 08:51 UTC with its first run due at 04:15 the next morning, and
// alerted "not running" for the whole gap. Listed jobs get one full allowance
// from this moment to make that first run; after that, never-ran = dead again,
// so a cron that never registered with the scheduler is still caught.
//
// Use the production deploy time, erring LATER (a date in the future just means
// "not yet due"). Entries stop mattering once the job has run; delete at will.
const WATCHED_SINCE: Record<string, string> = {
  "cron/mot-reconcile": "2026-09-28T08:51:00Z", // #626 deploy
  // Newly watched in #627, and they only began recording their skip runs there.
  "cron/activation": "2026-09-29T00:00:00Z",
  "cron/overage-reconcile": "2026-09-29T00:00:00Z",
};

/** The age reported for a job with no run at all in the retention window. */
const NEVER_RAN_MINS = 7 * 24 * 60;

export type StaleCron = { job: string; ageMins: number; maxMins: number; overdueMins: number };

/**
 * Watched jobs that haven't run inside their allowance, worst first.
 *
 * A job with no run at all in the retention window is reported as stale with
 * its age measured from the window start — a job that has never run is exactly
 * as broken as one that stopped — unless it is newly watched (WATCHED_SINCE)
 * and still inside the allowance for its first run.
 *
 * Pure, so the rules are unit-tested without a database.
 */
export function staleCronJobs(jobs: CronJob[], now: Date = new Date()): StaleCron[] {
  const stale: StaleCron[] = [];
  for (const job of jobs) {
    const maxMins = MAX_AGE_MINS[job.job];
    if (!maxMins) continue;
    const since = WATCHED_SINCE[job.job];
    const ageMins = job.lastRunAt
      ? Math.floor((now.getTime() - new Date(job.lastRunAt).getTime()) / 60_000)
      : since
        ? Math.min(NEVER_RAN_MINS, Math.floor((now.getTime() - Date.parse(since)) / 60_000))
        : NEVER_RAN_MINS;
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
