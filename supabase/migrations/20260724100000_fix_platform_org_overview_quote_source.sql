-- Blocker fix for Phase 10 (#252): platform_org_overview's `quo` CTE was
-- never re-pointed at the unified `quotes` table during the Phase 2 cutover
-- (#242, 2026-06-30). It has been reading the legacy `job_quotes` /
-- `standalone_quotes` archive tables ever since — recreated as-is by both
-- 20260614180000_org_tenancy_contract.sql and 20260715090000_accounting_providers.sql,
-- so every re-point of this view carried the bug forward. Since the app
-- stopped writing to the archive tables at the Phase 2 cutover, the platform
-- admin dashboard's per-org `quote_count` (src/lib/platform-stats.ts,
-- src/app/admin/orgs/[id]/page.tsx) has been frozen at its 2026-06-30 value
-- for every org since — not wrong per se, just stale.
--
-- More urgently: this is a live dependency Phase 10 (#252) must clear first.
-- `job_quotes`/`standalone_quotes` don't appear in the issue's `grep -r ... src/`
-- pre-flight check (it's a DB view, not app code), so dropping the archive
-- tables today would leave this view referencing tables that no longer exist
-- and start 500ing platform admin org-detail pages the next time the view
-- is queried.
--
-- Re-point `quo` at the unified `quotes` table, which already carries
-- organization_id directly — no join through locations or job/standalone
-- union needed. Body is otherwise identical to the view created in
-- 20260715090000_accounting_providers.sql.
--
-- DROP + CREATE (not CREATE OR REPLACE): the `quo` CTE changes from
-- `sum(count(*))` (numeric) to a plain `count(*)` (bigint), so the
-- quote_count output column's type changes — which CREATE OR REPLACE VIEW
-- refuses ("cannot change data type of view column"). Dropping first is the
-- same approach 20260715090000_accounting_providers.sql used when it changed
-- xero_connected→accounting_provider, and is safe: no DB object depends on
-- this view (only the service-role admin client reads it), and bigint is
-- consistent with every sibling count column in the view. The lone consumer,
-- src/app/admin/orgs/[id]/page.tsx, wraps it in Number() either way.
drop view if exists public.platform_org_overview;
create view public.platform_org_overview
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
  select organization_id,
         count(*) filter (where anonymized_at is null) as customer_count
  from public.customers
  group by organization_id
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
  select organization_id, count(*) as quote_count
  from public.quotes
  group by organization_id
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
  ac.provider as accounting_provider,
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
left join public.accounting_connections ac on ac.organization_id = o.id
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

-- Re-apply the exposure posture from 20260612110000: platform views are
-- service-role only (recreating the view restores default grants).
revoke select on public.platform_org_overview from anon, authenticated;
grant select on public.platform_org_overview to service_role;
