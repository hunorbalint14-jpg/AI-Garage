-- Platform cron run log for /admin/health (PR 5c). One row per completed run of
-- a platform cron handler — powers the scheduled-jobs panel. Platform-level,
-- RLS-locked to the service-role client. Pruned to ~7 days by /api/cron/tick.

create table if not exists public.cron_runs (
  id          bigint generated always as identity primary key,
  job         text not null,            -- 'cron/tick', 'cron/reminders', …
  ok          boolean not null,
  duration_ms int,
  detail      text,
  ran_at      timestamptz not null default now()
);

create index if not exists cron_runs_job_time_idx on public.cron_runs (job, ran_at desc);
create index if not exists cron_runs_time_idx on public.cron_runs (ran_at);

alter table public.cron_runs enable row level security;
-- No policies = service-role only (createAdminClient bypasses RLS).
