-- Platform traffic analytics (#admin/traffic PR 1): first-party, privacy-first
-- page-view collection. No cookies; visitors are a daily-rotating salted hash
-- (raw IPs never stored). Raw rows live 90 days; page_view_daily rollups are
-- kept indefinitely. Both tables are platform-operator data: RLS enabled with
-- NO policies = deny-all for anon/authenticated; only the service-role client
-- (collect route, rollup cron, /admin pages) touches them.

create table if not exists public.page_views (
  id              bigint generated always as identity primary key,
  occurred_at     timestamptz not null default now(),
  -- null = root-domain traffic (marketing site, no tenant)
  organization_id uuid references public.organizations(id) on delete cascade,
  surface         text not null,            -- marketing|booking|portal|docs|staff|other
  path            text not null,            -- normalised: tokens/ids stripped
  visitor_hash    text not null,            -- sha256(daily salt + ip + ua + host), rotates daily
  referrer_host   text,                     -- host only, same-host dropped
  device          text not null default 'unknown',   -- mobile|tablet|desktop|unknown
  browser         text not null default 'unknown',
  os              text not null default 'unknown',
  country         text,                     -- ISO 3166-1 alpha-2 from edge geo headers
  region          text,                     -- ISO 3166-2 subdivision
  city            text
);

-- Purge + rollup scan by time; dashboard drill-down by org.
create index if not exists page_views_occurred_idx
  on public.page_views (occurred_at);
create index if not exists page_views_org_occurred_idx
  on public.page_views (organization_id, occurred_at desc);

alter table public.page_views enable row level security;
grant all on public.page_views to service_role;

-- One row per (day, org, surface). organization_id is null for root-domain
-- traffic, so no natural PK — the rollup function deletes the day then
-- re-inserts, making reruns idempotent without conflict targets.
create table if not exists public.page_view_daily (
  id              bigint generated always as identity primary key,
  day             date not null,
  organization_id uuid references public.organizations(id) on delete cascade,
  surface         text not null,
  pageviews       integer not null default 0,
  visitors        integer not null default 0,   -- count(distinct visitor_hash) within the slice
  device_counts   jsonb not null default '{}'::jsonb,
  browser_counts  jsonb not null default '{}'::jsonb,
  country_counts  jsonb not null default '{}'::jsonb,
  city_counts     jsonb not null default '{}'::jsonb,
  referrer_counts jsonb not null default '{}'::jsonb,
  path_counts     jsonb not null default '{}'::jsonb
);

create index if not exists page_view_daily_day_idx
  on public.page_view_daily (day desc, organization_id);

alter table public.page_view_daily enable row level security;
grant all on public.page_view_daily to service_role;

-- Recompute one day's rollup from raw. Delete-then-insert = idempotent; the
-- cron re-runs recent days to absorb late-arriving events.
create or replace function public.rollup_page_views(p_day date)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.page_view_daily where day = p_day;

  insert into public.page_view_daily
    (day, organization_id, surface, pageviews, visitors,
     device_counts, browser_counts, country_counts, city_counts,
     referrer_counts, path_counts)
  select
    p_day,
    pv.organization_id,
    pv.surface,
    count(*)::int,
    count(distinct pv.visitor_hash)::int,
    (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
       select device as k, count(*) as n from public.page_views i
       where i.occurred_at >= p_day and i.occurred_at < p_day + 1
         and i.organization_id is not distinct from pv.organization_id and i.surface = pv.surface
       group by 1 order by 2 desc limit 20) d),
    (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
       select browser as k, count(*) as n from public.page_views i
       where i.occurred_at >= p_day and i.occurred_at < p_day + 1
         and i.organization_id is not distinct from pv.organization_id and i.surface = pv.surface
       group by 1 order by 2 desc limit 20) b),
    (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
       select country as k, count(*) as n from public.page_views i
       where i.occurred_at >= p_day and i.occurred_at < p_day + 1
         and i.organization_id is not distinct from pv.organization_id and i.surface = pv.surface
         and country is not null
       group by 1 order by 2 desc limit 30) c),
    (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
       select city as k, count(*) as n from public.page_views i
       where i.occurred_at >= p_day and i.occurred_at < p_day + 1
         and i.organization_id is not distinct from pv.organization_id and i.surface = pv.surface
         and city is not null
       group by 1 order by 2 desc limit 30) ci),
    (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
       select referrer_host as k, count(*) as n from public.page_views i
       where i.occurred_at >= p_day and i.occurred_at < p_day + 1
         and i.organization_id is not distinct from pv.organization_id and i.surface = pv.surface
         and referrer_host is not null
       group by 1 order by 2 desc limit 30) r),
    (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
       select path as k, count(*) as n from public.page_views i
       where i.occurred_at >= p_day and i.occurred_at < p_day + 1
         and i.organization_id is not distinct from pv.organization_id and i.surface = pv.surface
       group by 1 order by 2 desc limit 30) p)
  from public.page_views pv
  where pv.occurred_at >= p_day and pv.occurred_at < p_day + 1
  group by pv.organization_id, pv.surface;
$$;

revoke all on function public.rollup_page_views(date) from public;
grant execute on function public.rollup_page_views(date) to service_role;
