-- PHASE 2 (contract) of the org-scoped tenancy move; pairs with the expand
-- migration 20260614170000_org_scoped_tenancy.sql. Run AFTER it.
--
-- Customers are now fully ORGANISATION-scoped: a customer registers once per org
-- and their home branch is customers.preferred_location_id. The legacy
-- customers.location_id column (and its org-backfill trigger) are removed now
-- that no application code reads or writes it.
--
-- Vehicles deliberately KEEP location_id — it is the *servicing branch* the
-- reminder + MOT-delta cron route on. Only customers lose location_id here.
--
-- Two dependency-tracked database objects still reference customers.location_id
-- and so MUST be re-pointed before the column can be dropped (PostgreSQL would
-- otherwise refuse the DROP):
--   * view  public.platform_org_overview  (cust CTE)
--   * func  public.dashboard_stats         (total_customers, customers_added_per_week)
-- Both move to organization_id / preferred_location_id. For single-location
-- orgs the figures are identical to before.
--
-- Finally, the accountant org role (added in the expand) gains org-wide read of
-- finance_applications + standalone_quotes, matching the invoices / credit_notes
-- policies, so the finance pages' RLS path is org-wide for owner|admin|accountant.

-- ── 1. Re-point the platform overview view off customers.location_id ─────────
-- Customers carry organization_id directly now, so the `cust` CTE no longer
-- joins through locations. Every other CTE/column is unchanged (vehicles,
-- bookings, jobs, … keep location_id and still join through locations).
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

-- ── 2. Re-point dashboard_stats off customers.location_id ────────────────────
-- Customers are org-scoped, so per-branch customer figures move to the home
-- branch (preferred_location_id). Identical for single-location orgs. The body
-- is otherwise unchanged from 20260611120000_dashboard_stats.sql.
create or replace function public.dashboard_stats(
  p_location_id uuid,
  p_now timestamptz,
  p_today_start timestamptz,
  p_today_end timestamptz,
  p_week_start timestamptz,
  p_week_end timestamptz,
  p_due_cutoff date,
  p_quote_cutoff timestamptz,
  p_month_start timestamptz,
  p_eight_weeks_ago timestamptz
)
returns jsonb
language sql
stable
set search_path = public
as $body$
select jsonb_build_object(
  'total_customers',
    (select count(*) from customers where preferred_location_id = p_location_id),
  'total_vehicles',
    (select count(*) from vehicles where location_id = p_location_id),
  'reminders_month',
    (select count(*) from reminders
      where location_id = p_location_id and sent_at >= p_month_start),
  'active_jobs',
    (select count(*) from jobs
      where location_id = p_location_id and status = 'open'),
  'uninvoiced_jobs',
    (select count(*) from jobs
      where location_id = p_location_id and status = 'complete'),
  'invoices_open', (
    select jsonb_build_object(
      'draft_count', count(*) filter (where status = 'draft'),
      'draft_total', coalesce(sum(total) filter (where status = 'draft'), 0),
      'sent_count',  count(*) filter (where status = 'sent'),
      'sent_total',  coalesce(sum(total) filter (where status = 'sent'), 0)
    )
    from invoices
    where location_id = p_location_id and status in ('draft', 'sent')
  ),
  'expiring_quotes', (
    select jsonb_build_object(
      'count', count(*),
      'total', coalesce(sum(total), 0)
    )
    from job_quotes
    where location_id = p_location_id
      and status = 'pending'
      and expires_at <= p_quote_cutoff
  ),
  'attention_vehicles', (
    select coalesce(jsonb_agg(t.v_row order by t.mot_expiry asc nulls last), '[]'::jsonb)
    from (
      select v.mot_expiry,
        jsonb_build_object(
          'id', v.id,
          'registration', v.registration,
          'make', v.make,
          'model', v.model,
          'mot_expiry', v.mot_expiry,
          'service_due', v.service_due,
          'customer', case when c.id is null then null
            else jsonb_build_object('id', c.id, 'full_name', c.full_name) end
        ) as v_row
      from vehicles v
      left join customers c on c.id = v.customer_id
      where v.location_id = p_location_id
        and (v.mot_expiry <= p_due_cutoff or v.service_due <= p_due_cutoff)
      order by v.mot_expiry asc nulls last
      limit 20
    ) t
  ),
  'today_bookings', (
    select coalesce(jsonb_agg(t.b_row order by t.scheduled_at asc), '[]'::jsonb)
    from (
      select b.scheduled_at,
        jsonb_build_object(
          'id', b.id,
          'scheduled_at', b.scheduled_at,
          'duration_minutes', b.duration_minutes,
          'type', b.type,
          'status', b.status,
          'bay_id', b.bay_id,
          'customer', case when c.id is null then null
            else jsonb_build_object('id', c.id, 'full_name', c.full_name) end,
          'vehicle', case when v.id is null then null
            else jsonb_build_object('registration', v.registration) end
        ) as b_row
      from bookings b
      left join customers c on c.id = b.customer_id
      left join vehicles v on v.id = b.vehicle_id
      where b.location_id = p_location_id
        and b.scheduled_at >= p_today_start
        and b.scheduled_at <= p_today_end
    ) t
  ),
  'bays', (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('id', id, 'name', name, 'description', description)
        order by sort_order asc, created_at asc
      ),
      '[]'::jsonb
    )
    from bays
    where location_id = p_location_id
  ),
  'business_hours', (
    select jsonb_build_object(
      'start', business_hours_start,
      'end', business_hours_end
    )
    from locations
    where id = p_location_id
  ),
  'week_revenue_by_day', (
    select coalesce(jsonb_object_agg(t.day, t.revenue), '{}'::jsonb)
    from (
      select to_char(issued_at at time zone 'utc', 'YYYY-MM-DD') as day,
        sum(total) as revenue
      from invoices
      where location_id = p_location_id
        and status = 'paid'
        and issued_at >= p_week_start
        and issued_at <= p_week_end
      group by 1
    ) t
  ),
  'customers_added_per_week', (
    select jsonb_agg(coalesce(b.cnt, 0) order by w.age desc)
    from generate_series(0, 7) as w(age)
    left join (
      select floor(extract(epoch from (p_now - created_at)) / 604800)::int as age,
        count(*) as cnt
      from customers
      where preferred_location_id = p_location_id and created_at >= p_eight_weeks_ago
      group by 1
    ) b on b.age = w.age
  ),
  'vehicles_added_per_week', (
    select jsonb_agg(coalesce(b.cnt, 0) order by w.age desc)
    from generate_series(0, 7) as w(age)
    left join (
      select floor(extract(epoch from (p_now - created_at)) / 604800)::int as age,
        count(*) as cnt
      from vehicles
      where location_id = p_location_id and created_at >= p_eight_weeks_ago
      group by 1
    ) b on b.age = w.age
  ),
  'reminders_per_day', (
    select coalesce(jsonb_agg(coalesce(b.cnt, 0) order by d.idx), '[]'::jsonb)
    from generate_series(
      0,
      greatest(floor(extract(epoch from (p_now - p_month_start)) / 86400)::int, 0)
    ) as d(idx)
    left join (
      select floor(extract(epoch from (sent_at - p_month_start)) / 86400)::int as idx,
        count(*) as cnt
      from reminders
      where location_id = p_location_id and sent_at >= p_month_start
      group by 1
    ) b on b.idx = d.idx
  )
);
$body$;

-- create or replace preserves privileges, but re-assert the service-role-only
-- grant to be explicit (the function takes an arbitrary location_id; tenant
-- isolation is the caller's responsibility).
revoke all on function public.dashboard_stats(uuid, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, date, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.dashboard_stats(uuid, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, date, timestamptz, timestamptz, timestamptz) to service_role;

-- ── 3. Drop the customers org-backfill trigger ──────────────────────────────
-- The expand added a BEFORE INSERT/UPDATE trigger on every org-scoped table to
-- derive organization_id from location_id. Customers no longer have location_id
-- and every customer insert now sets organization_id explicitly, so drop the
-- customers trigger. The shared private.set_org_from_location() function and the
-- triggers on the other six tables (which keep location_id) stay in place.
drop trigger if exists trg_customers_set_org on public.customers;

-- ── 4. Drop customers.location_id ───────────────────────────────────────────
-- DROP COLUMN cascades the legacy UNIQUE(location_id, email) constraint and the
-- FK to locations. The org-level unique index (customers_org_email_key) and
-- preferred_location_id remain. preferred_location_id was backfilled in the
-- expand (coalesce(preferred_location_id, location_id)), so every existing
-- customer keeps a home branch.
alter table public.customers drop column if exists location_id;

-- ── 5. Accountant finance reads across the org ──────────────────────────────
-- finance_applications + standalone_quotes are read by the staff finance pages
-- via the service-role client, but the authenticated RLS path must also let org
-- finance (owner|admin|accountant) read across branches — matching the expand's
-- invoices / credit_notes policies. Additive SELECT policies (OR'd with the
-- existing branch-member policies), so no current access narrows.
drop policy if exists "finance_applications_finance_read" on public.finance_applications;
create policy "finance_applications_finance_read" on public.finance_applications
  for select to authenticated using (private.is_org_finance(organization_id));

drop policy if exists "standalone_quotes_finance_read" on public.standalone_quotes;
create policy "standalone_quotes_finance_read" on public.standalone_quotes
  for select to authenticated using (private.is_org_finance(organization_id));
