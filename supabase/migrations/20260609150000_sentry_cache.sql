-- Sentry telemetry cache for /admin/health (PR 5d). The uptime cron pulls error
-- rate + top issues from Sentry and writes them here; the dashboard + the
-- error_rate_pct alert read this cache instead of calling Sentry per request
-- (rate limits, latency). Platform-level, RLS-locked to the service-role client.

-- Singleton latest-snapshot row (id is always true).
create table if not exists public.sentry_snapshot (
  id              boolean primary key default true,
  ok              boolean not null default false,   -- Sentry reachable on last refresh
  error_rate_pct  numeric,                          -- failure_rate() ×100, null if no transactions
  events_24h      bigint,                           -- total error events in the last 24h
  detail          text,
  fetched_at      timestamptz not null default now(),
  constraint sentry_snapshot_singleton check (id)
);

-- Top unresolved issues, replaced wholesale each refresh.
create table if not exists public.sentry_issues (
  id          bigint generated always as identity primary key,
  rank        int not null,
  title       text not null,
  culprit     text,
  level       text,                                  -- 'error' | 'warning' | …
  events      bigint,
  users       int,
  last_seen   timestamptz,
  permalink   text,
  captured_at timestamptz not null default now()
);

create index if not exists sentry_issues_rank_idx on public.sentry_issues (rank);

alter table public.sentry_snapshot enable row level security;
alter table public.sentry_issues enable row level security;
-- No policies = service-role only (createAdminClient bypasses RLS).
