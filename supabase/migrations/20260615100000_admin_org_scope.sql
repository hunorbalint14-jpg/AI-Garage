-- Org-scope the platform admin dashboard + reliability pipeline.
--
-- After the tenancy refactor the subdomain is organizations.slug, not a location
-- slug — but the synthetic uptime probe, the tenant-health view, and the admin
-- slug tooling still keyed on locations. This migration moves them to the org:
--   * retired-slug history + redirects track the ORG slug now;
--   * the uptime probe targets the org subdomain (one probe per org);
--   * platform_tenant_health returns one row per ORGANISATION (with its branches).

-- ── 1. Retired ORG slugs (mirrors location_slug_history) ─────────────────────
-- When a platform admin renames an org's slug (its subdomain), the old slug is
-- recorded so the proxy 308-redirects old links and the slug is permanently
-- reserved (enforced in app code via findSlugConflict()).
create table if not exists public.org_slug_history (
  id              uuid primary key default uuid_generate_v4(),
  old_slug        text not null unique,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_at      timestamptz not null default now()
);
create index if not exists org_slug_history_org_idx
  on public.org_slug_history (organization_id);

alter table public.org_slug_history enable row level security;
-- Reads go through the service-role client (redirect + uniqueness checks), which
-- bypasses RLS. Platform admins may also read it directly.
create policy "org_slug_history_admin_read"
  on public.org_slug_history for select
  using (public.is_platform_admin());

-- ── 2. uptime_checks: synthetic probe now targets the ORG subdomain ──────────
-- Add organization_id (location_id stays for legacy rows / non-tenant kinds and
-- is no longer written for tenant probes).
alter table public.uptime_checks
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
create index if not exists uptime_checks_org_idx
  on public.uptime_checks (organization_id, checked_at desc);

-- ── 3. platform_tenant_health → one row per ORGANISATION ─────────────────────
-- Tenant samples are keyed by target_key = the subdomain slug, which is now the
-- org slug, so latest/agg join on organizations.slug. Adds location_count + a
-- branches jsonb for the expandable roster row.
create or replace view public.platform_tenant_health
with (security_invoker = true) as
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
  o.id          as organization_id,
  o.slug,
  o.name        as org_name,
  o.slug || '.ai-garage.co.uk' as host,
  case
    when latest.ok is false then 'down'
    when latest.latency_ms > 800 or agg.ok_24h::numeric / nullif(agg.samples_24h,0) < 0.99 then 'degraded'
    else 'operational'
  end           as status,
  latest.latency_ms                                              as p95_now_ms,
  agg.p95_ms,
  round(100.0 * agg.ok_24h / nullif(agg.samples_24h,0), 2)       as uptime_24h,
  latest.checked_at                                              as last_checked_at,
  (select count(*) from public.locations l where l.organization_id = o.id) as location_count,
  coalesce(
    (select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'slug', l.slug) order by l.name)
       from public.locations l where l.organization_id = o.id),
    '[]'::jsonb
  )             as branches
from public.organizations o
left join latest on latest.slug = o.slug
left join agg    on agg.slug    = o.slug;

-- Platform-operator view; anon/authenticated PostgREST roles have no business
-- selecting it (reads are service-role only).
revoke select on public.platform_tenant_health from anon, authenticated;
