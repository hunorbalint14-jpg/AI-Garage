-- Accounting provider seam (#501): one accounting connection per org
-- (Xero today, QuickBooks next, Sage later) plus a sync log that powers
-- the "books health" panel. Entity mapping columns go provider-neutral —
-- straight renames, so existing Xero ids keep dedupe/idempotency working.

-- 1. Connections: OAuth tokens move off organizations.* into a dedicated
--    service-role-only table so adding a provider is a row, not columns.
create table if not exists public.accounting_connections (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('xero', 'quickbooks', 'sage')),
  external_id text not null, -- Xero tenantId / QuickBooks realmId
  display_name text,
  access_token text,  -- AES-GCM app-layer encrypted (src/lib/encryption.ts)
  refresh_token text, -- AES-GCM app-layer encrypted
  token_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  connected_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.accounting_connections enable row level security;

-- Tokens live here — service role only, same posture as xero_payouts.
-- Staff-facing status reads go through the admin client in server code.
create policy "accounting_connections_service_only" on public.accounting_connections
  for all using (false) with check (false);

grant all on public.accounting_connections to service_role;

-- Carry existing Xero connections over before the columns are dropped.
insert into public.accounting_connections
  (organization_id, provider, external_id, display_name, access_token, refresh_token, token_expires_at, connected_at)
select
  id, 'xero', xero_tenant_id, xero_tenant_name, xero_access_token,
  xero_refresh_token, xero_token_expires_at, coalesce(xero_connected_at, now())
from public.organizations
where xero_tenant_id is not null
on conflict (organization_id) do nothing;

-- platform_org_overview selects xero_tenant_id — drop before the column
-- goes, recreate (with a provider column) at the end of this migration.
drop view if exists public.platform_org_overview;

alter table public.organizations
  drop column if exists xero_tenant_id,
  drop column if exists xero_tenant_name,
  drop column if exists xero_access_token,
  drop column if exists xero_refresh_token,
  drop column if exists xero_token_expires_at,
  drop column if exists xero_connected_at;

-- 2. Entity mappings: provider-neutral names. One provider per org, so a
--    single set of columns is enough; they are wiped when an org switches
--    provider (handled in application code on connect).
alter table public.invoices rename column xero_invoice_id to accounting_invoice_id;
alter table public.invoices rename column xero_payment_id to accounting_payment_id;
alter table public.invoices rename column xero_synced_at to accounting_synced_at;
alter table public.customers rename column xero_contact_id to accounting_contact_id;
alter table public.credit_notes rename column xero_credit_note_id to accounting_credit_note_id;

alter index if exists invoices_xero_invoice_idx rename to invoices_accounting_invoice_idx;
alter index if exists customers_xero_contact_idx rename to customers_accounting_contact_idx;

-- 3. Payout ledger: rename + provider column (idempotency key for payout
--    pushes stays (organization_id, stripe_payout_id)).
alter table public.xero_payouts rename to accounting_payouts;
alter table public.accounting_payouts rename column xero_bank_transaction_id to external_transaction_id;
alter table public.accounting_payouts add column if not exists provider text not null default 'xero';
alter index if exists xero_payouts_org_idx rename to accounting_payouts_org_idx;
alter index if exists xero_payouts_stripe_idx rename to accounting_payouts_stripe_idx;
alter policy "xero_payouts_service_only" on public.accounting_payouts
  rename to "accounting_payouts_service_only";

-- 4. Sync log — one row per push attempt (success or failure). The books
--    health panel reads it; the seam writes it for every provider.
create table if not exists public.accounting_sync_log (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  entity_type text not null check (entity_type in ('invoice', 'payment', 'credit_note', 'payout', 'contact')),
  entity_id uuid,
  external_id text,
  status text not null check (status in ('synced', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

create index if not exists accounting_sync_log_org_idx
  on public.accounting_sync_log (organization_id, created_at desc);

alter table public.accounting_sync_log enable row level security;

-- Owner/admin/accountant read the health panel; writes are service-role only.
create policy "accounting_sync_log_finance_read" on public.accounting_sync_log
  for select to authenticated
  using (private.is_org_finance(organization_id));

grant select on public.accounting_sync_log to authenticated;
grant all on public.accounting_sync_log to service_role;

-- 5. Recreate platform_org_overview: xero_connected boolean becomes
--    accounting_provider text ('xero' | 'quickbooks' | null). Body is
--    otherwise identical to 20260614180000_org_tenancy_contract.sql.
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
