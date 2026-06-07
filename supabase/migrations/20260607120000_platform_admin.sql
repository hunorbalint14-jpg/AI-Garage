-- Platform operator dashboard (all-tenant oversight).
--
-- Two pieces:
--   1. ai_usage_events — records every Claude call (model, tokens, derived £
--      cost, the location/org it was for, the feature). Nothing tracked AI spend
--      before this; the dashboard's per-org AI KPI reads from here.
--   2. platform_org_overview — a per-org rollup view (counts, revenue, AI spend,
--      integration + billing status) the operator dashboard reads via the
--      service-role client. SECURITY INVOKER so a normal tenant user querying it
--      only ever sees their own org (RLS of the underlying tables applies);
--      the service-role client bypasses RLS and sees every org.

-- ── 1. AI usage events ──────────────────────────────────────────────────────
create table if not exists public.ai_usage_events (
  id              uuid primary key default uuid_generate_v4(),
  location_id     uuid not null references public.locations(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id         uuid,
  feature         text not null,
  model           text not null,
  input_tokens    integer not null default 0,
  output_tokens   integer not null default 0,
  cost_pence      numeric not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists ai_usage_events_location_created_idx
  on public.ai_usage_events (location_id, created_at desc);
create index if not exists ai_usage_events_created_idx
  on public.ai_usage_events (created_at desc);

alter table public.ai_usage_events enable row level security;

-- Writes come from the server via the service-role client (recordAiUsage),
-- which bypasses RLS. A tenant may read its own location's usage; cross-tenant
-- reads are only possible through the service-role client (platform admin).
create policy "ai_usage_events_member_read"
  on public.ai_usage_events for select
  using (public.is_location_member(location_id));

-- ── 2. Per-org overview rollup ──────────────────────────────────────────────
create or replace view public.platform_org_overview
with (security_invoker = true) as
with staff as (
  select organization_id, count(distinct user_id) as staff_count
  from (
    select organization_id, user_id from public.org_users
    union
    select l.organization_id, lu.user_id
      from public.location_users lu
      join public.locations l on l.id = lu.location_id
  ) s
  group by organization_id
),
loc as (
  select organization_id, count(*) as location_count
  from public.locations group by organization_id
),
cust as (
  select l.organization_id,
         count(*) filter (where c.anonymized_at is null) as customer_count
  from public.customers c
  join public.locations l on l.id = c.location_id
  group by l.organization_id
),
veh as (
  select l.organization_id, count(*) as vehicle_count
  from public.vehicles v
  join public.locations l on l.id = v.location_id
  group by l.organization_id
),
book as (
  select l.organization_id,
         count(*) as booking_count,
         max(b.created_at) as last_booking_at
  from public.bookings b
  join public.locations l on l.id = b.location_id
  group by l.organization_id
),
job as (
  select l.organization_id,
         count(*) as job_count,
         max(j.created_at) as last_job_at
  from public.jobs j
  join public.locations l on l.id = j.location_id
  group by l.organization_id
),
inv as (
  select l.organization_id,
         count(*) as invoice_count,
         count(*) filter (where i.status = 'paid') as invoice_paid_count,
         coalesce(round(sum(i.total) filter (where i.status = 'paid') * 100), 0)::bigint as revenue_paid_pence,
         max(i.created_at) as last_invoice_at
  from public.invoices i
  join public.locations l on l.id = i.location_id
  group by l.organization_id
),
rem as (
  select l.organization_id, count(*) as reminder_sent_count
  from public.reminders r
  join public.locations l on l.id = r.location_id
  where r.status = 'sent'
  group by l.organization_id
),
quo as (
  select organization_id, sum(n) as quote_count from (
    select l.organization_id, count(*) as n
      from public.job_quotes q join public.locations l on l.id = q.location_id
      group by l.organization_id
    union all
    select organization_id, count(*) as n
      from public.standalone_quotes group by organization_id
  ) z group by organization_id
),
ai as (
  select l.organization_id,
         coalesce(sum(a.input_tokens), 0)::bigint  as ai_input_tokens_30d,
         coalesce(sum(a.output_tokens), 0)::bigint as ai_output_tokens_30d,
         coalesce(sum(a.cost_pence), 0)            as ai_cost_pence_30d,
         count(*)                                  as ai_events_30d
  from public.ai_usage_events a
  join public.locations l on l.id = a.location_id
  where a.created_at > now() - interval '30 days'
  group by l.organization_id
)
select
  o.id   as organization_id,
  o.name,
  o.slug,
  o.created_at,
  o.tenant_plan,
  o.tenant_subscription_status,
  o.tenant_trial_end,
  o.tenant_current_period_end,
  o.stripe_charges_enabled,
  o.stripe_payouts_enabled,
  (o.xero_tenant_id is not null) as xero_connected,
  coalesce(loc.location_count, 0)        as location_count,
  coalesce(staff.staff_count, 0)         as staff_count,
  coalesce(cust.customer_count, 0)       as customer_count,
  coalesce(veh.vehicle_count, 0)         as vehicle_count,
  coalesce(book.booking_count, 0)        as booking_count,
  coalesce(job.job_count, 0)             as job_count,
  coalesce(inv.invoice_count, 0)         as invoice_count,
  coalesce(inv.invoice_paid_count, 0)    as invoice_paid_count,
  coalesce(inv.revenue_paid_pence, 0)    as revenue_paid_pence,
  coalesce(rem.reminder_sent_count, 0)   as reminder_sent_count,
  coalesce(quo.quote_count, 0)           as quote_count,
  coalesce(ai.ai_input_tokens_30d, 0)    as ai_input_tokens_30d,
  coalesce(ai.ai_output_tokens_30d, 0)   as ai_output_tokens_30d,
  coalesce(ai.ai_cost_pence_30d, 0)      as ai_cost_pence_30d,
  coalesce(ai.ai_events_30d, 0)          as ai_events_30d,
  greatest(book.last_booking_at, job.last_job_at, inv.last_invoice_at) as last_activity_at
from public.organizations o
left join staff on staff.organization_id = o.id
left join loc   on loc.organization_id = o.id
left join cust  on cust.organization_id = o.id
left join veh   on veh.organization_id = o.id
left join book  on book.organization_id = o.id
left join job   on job.organization_id = o.id
left join inv   on inv.organization_id = o.id
left join rem   on rem.organization_id = o.id
left join quo   on quo.organization_id = o.id
left join ai    on ai.organization_id = o.id;
