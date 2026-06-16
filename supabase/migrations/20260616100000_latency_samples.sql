-- Real responsiveness telemetry for /admin/health.
--
-- uptime_checks probes a DB-free liveness endpoint (/api/health), so its
-- latency_ms reflects reachability / TLS / cold-start, not real work. This table
-- captures the actual stack cost:
--   * infra rows  — function→Postgres and function→Redis round-trips, measured
--     directly by the in-region uptime cron (one row per run).
--   * tenant rows — per-organisation backend latency from a DB-touching probe
--     (/api/health/deep): db_ms is the server-side query time, total_ms is the
--     end-to-end probe time (incl. network/TLS).
--
-- Platform-level table: RLS enabled with NO policies, so anon/authenticated get
-- nothing; the service-role client (createAdminClient) bypasses RLS for the cron
-- writes + admin reads. Mirrors uptime_checks.

create table if not exists public.latency_samples (
  id              bigint generated always as identity primary key,
  kind            text not null check (kind in ('infra', 'tenant')),
  organization_id uuid references public.organizations (id) on delete cascade, -- null for infra
  target_key      text,            -- org slug for tenant rows; null for infra
  db_ms           int,             -- function→Postgres round-trip
  redis_ms        int,             -- function→Redis round-trip (infra only)
  total_ms        int,             -- end-to-end probe time (tenant: incl network/TLS)
  checked_at      timestamptz not null default now()
);

create index if not exists latency_samples_kind_time_idx
  on public.latency_samples (kind, checked_at desc);
create index if not exists latency_samples_org_time_idx
  on public.latency_samples (organization_id, checked_at desc);

alter table public.latency_samples enable row level security;
-- No policies = no access for anon/authenticated; service-role bypasses RLS.
