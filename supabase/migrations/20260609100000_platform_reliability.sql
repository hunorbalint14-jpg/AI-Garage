-- Platform reliability store for /admin/health (PR 1 of the reliability series).
-- Platform-level tables (NOT tenant-scoped) read only by platform admins via the
-- service-role client. RLS-locked so no tenant/anon can read them.
-- Adapted from the design handoff; uses uuid_generate_v4() per repo convention.

-- ── synthetic uptime / latency samples (written by /api/cron/uptime) ─────────
create table if not exists public.uptime_checks (
  id            bigint generated always as identity primary key,
  target_kind   text not null check (target_kind in ('tenant','service','endpoint')),
  target_key    text not null,            -- location.slug, or service id e.g. 'stripe'
  location_id   uuid references public.locations (id) on delete cascade, -- null for platform services
  ok            boolean not null,
  status_code   int,
  latency_ms    int,
  region        text not null default 'lhr',
  error         text,
  checked_at    timestamptz not null default now()
);
create index if not exists uptime_checks_target_time_idx
  on public.uptime_checks (target_kind, target_key, checked_at desc);
create index if not exists uptime_checks_location_time_idx
  on public.uptime_checks (location_id, checked_at desc);
create index if not exists uptime_checks_checked_at_idx
  on public.uptime_checks (checked_at);

-- ── hourly rollup (keep raw rows short-lived; query the rollup for trends) ───
create table if not exists public.uptime_rollup (
  target_kind   text not null,
  target_key    text not null,
  bucket_hour   timestamptz not null,
  samples       int not null,
  ok_samples    int not null,
  p50_ms        int,
  p95_ms        int,
  p99_ms        int,
  primary key (target_kind, target_key, bucket_hour)
);
create index if not exists uptime_rollup_bucket_idx on public.uptime_rollup (bucket_hour desc);

-- ── incidents (managed in /admin/health, optionally published to /status) ────
create table if not exists public.incidents (
  id            uuid primary key default uuid_generate_v4(),
  ref           text unique not null,                       -- e.g. 'INC-2051'
  title         text not null,
  severity      text not null check (severity in ('SEV-1','SEV-2','SEV-3','SEV-4')),
  status        text not null default 'Investigating'
                  check (status in ('Investigating','Identified','Monitoring','Resolved')),
  components    text[] not null default '{}',
  lead_user_id  uuid references auth.users (id),
  published     boolean not null default false,             -- visible on public status page
  acked_at      timestamptz,
  auto_declared boolean not null default false,
  alert_rule_id text,                                       -- which rule opened it, if any
  started_at    timestamptz not null default now(),
  resolved_at   timestamptz
);
create index if not exists incidents_open_idx on public.incidents (resolved_at) where resolved_at is null;
create index if not exists incidents_published_idx on public.incidents (published) where published is true;

create table if not exists public.incident_updates (
  id           bigint generated always as identity primary key,
  incident_id  uuid not null references public.incidents (id) on delete cascade,
  status       text not null,
  body         text not null,
  actor_email  text,                                         -- mirrors audit_log convention
  public       boolean not null default false,               -- show this update on /status
  created_at   timestamptz not null default now()
);
create index if not exists incident_updates_inc_idx on public.incident_updates (incident_id, created_at desc);

-- ── alert rules (thresholds that page on-call / auto-declare) ────────────────
create table if not exists public.alert_rules (
  id            text primary key,                            -- 'ar-webhook'
  name          text not null,
  metric        text not null,                               -- 'webhook_5xx_rate'
  operator      text not null check (operator in ('>','<','>=','<=')),
  threshold     numeric not null,
  window_secs   int not null default 300,
  source        text not null,                               -- 'Stripe','Sentry','Synthetic'…
  severity      text not null check (severity in ('SEV-1','SEV-2','SEV-3','SEV-4')),
  auto_declare  boolean not null default false,
  channels      text[] not null default '{}',                -- 'PagerDuty','Slack #ops','SMS on-call'
  enabled       boolean not null default true,
  last_fired_at timestamptz
);

-- ── per-tenant health view the page paginates over ──────────────────────────
create or replace view public.platform_tenant_health as
with latest as (
  select distinct on (target_key)
    target_key as slug, ok, latency_ms, status_code, checked_at
  from public.uptime_checks
  where target_kind = 'tenant'
  order by target_key, checked_at desc
),
agg as (
  select target_key as slug,
         count(*)                                   as samples_24h,
         count(*) filter (where ok)                 as ok_24h,
         percentile_disc(0.95) within group (order by latency_ms) as p95_ms
  from public.uptime_checks
  where target_kind = 'tenant' and checked_at > now() - interval '24 hours'
  group by target_key
)
select
  l.id          as location_id,
  l.slug,
  o.name        as org_name,
  l.slug || '.ai-garage.co.uk' as host,
  case
    when latest.ok is false then 'down'
    when latest.latency_ms > 800 or agg.ok_24h::numeric / nullif(agg.samples_24h,0) < 0.99 then 'degraded'
    else 'operational'
  end           as status,
  latest.latency_ms                                              as p95_now_ms,
  agg.p95_ms,
  round(100.0 * agg.ok_24h / nullif(agg.samples_24h,0), 2)       as uptime_24h,
  latest.checked_at                                              as last_checked_at
from public.locations l
join public.organizations o on o.id = l.organization_id
left join latest on latest.slug = l.slug
left join agg    on agg.slug    = l.slug;

-- ── hourly rollup function (called by /api/cron/tick) ────────────────────────
-- Idempotent upsert of all (target,bucket) aggregates for the given hour.
create or replace function public.rollup_uptime_hour(p_bucket timestamptz)
returns void
language sql
security definer
set search_path = public
as $body$
  insert into public.uptime_rollup (target_kind, target_key, bucket_hour, samples, ok_samples, p50_ms, p95_ms, p99_ms)
  select target_kind, target_key, date_trunc('hour', checked_at) as bucket_hour,
         count(*),
         count(*) filter (where ok),
         percentile_disc(0.5)  within group (order by latency_ms),
         percentile_disc(0.95) within group (order by latency_ms),
         percentile_disc(0.99) within group (order by latency_ms)
  from public.uptime_checks
  where checked_at >= p_bucket and checked_at < p_bucket + interval '1 hour'
  group by target_kind, target_key, date_trunc('hour', checked_at)
  on conflict (target_kind, target_key, bucket_hour) do update set
    samples    = excluded.samples,
    ok_samples = excluded.ok_samples,
    p50_ms     = excluded.p50_ms,
    p95_ms     = excluded.p95_ms,
    p99_ms     = excluded.p99_ms;
$body$;

-- ── lock everything to service-role only ────────────────────────────────────
alter table public.uptime_checks    enable row level security;
alter table public.uptime_rollup    enable row level security;
alter table public.incidents        enable row level security;
alter table public.incident_updates enable row level security;
alter table public.alert_rules      enable row level security;
-- No policies = no access for anon/authenticated. createAdminClient() (service
-- role) bypasses RLS. The public /status page reads ONLY published rows via the
-- SECURITY DEFINER function below.

create or replace function public.public_status_incidents()
returns table (title text, severity text, status text, started_at timestamptz, updates jsonb)
language sql
security definer
set search_path = public
as $body$
  select i.title, i.severity, i.status, i.started_at,
         coalesce(jsonb_agg(jsonb_build_object('status', u.status, 'body', u.body, 'at', u.created_at)
                            order by u.created_at desc) filter (where u.public), '[]'::jsonb)
  from public.incidents i
  left join public.incident_updates u on u.incident_id = i.id
  where i.published = true and i.resolved_at is null
  group by i.id;
$body$;
grant execute on function public.public_status_incidents() to anon, authenticated;
