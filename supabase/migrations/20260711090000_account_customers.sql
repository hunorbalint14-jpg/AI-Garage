-- Account customers (#504, docs/account-customers-build-spec.md, PR 2).
-- Full schema up front (ledger tables consumed by PRs 3–4): account flag +
-- terms on the customer, consolidated-invoice membership, the payments
-- ledger with allocations, and the amount_paid rollup. No parallel billing
-- system — everything hangs off the existing invoices table.

alter table public.customers
  add column if not exists account_customer boolean not null default false,
  add column if not exists payment_terms_days integer not null default 30,
  add column if not exists credit_limit numeric(10,2),
  add column if not exists consolidated_billing boolean not null default false;

alter table public.organizations
  add column if not exists credit_control_mode text not null default 'warn'
    check (credit_control_mode in ('warn', 'block'));

-- 'paid' still means FULLY covered; partial payments accumulate here while
-- the invoice stays 'sent' — every existing status='paid' read stays correct.
alter table public.invoices
  add column if not exists amount_paid numeric(10,2) not null default 0;

-- Consolidated invoice ↔ member jobs. unique(job_id): a job can never be
-- billed twice; on delete restrict: a billed job can't silently vanish.
create table if not exists public.invoice_jobs (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  job_id     uuid not null references public.jobs(id) on delete restrict,
  amount     numeric(10,2) not null,
  created_at timestamptz not null default now(),
  unique (job_id)
);
create index if not exists invoice_jobs_invoice_idx on public.invoice_jobs (invoice_id);

-- Account payments ledger (bank transfer / cheque / on-account card) and the
-- oldest-first allocations. Stripe per-invoice payments are unchanged.
create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  location_id     uuid not null references public.locations(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  customer_id     uuid not null references public.customers(id) on delete cascade,
  amount          numeric(10,2) not null check (amount > 0),
  method          text not null default 'bank_transfer'
                    check (method in ('bank_transfer', 'card', 'cash', 'cheque', 'other')),
  reference       text,
  received_at     date not null default current_date,
  recorded_by     uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists payments_customer_idx on public.payments (customer_id, received_at desc);
create index if not exists payments_location_idx on public.payments (location_id);

create table if not exists public.payment_allocations (
  id         uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount     numeric(10,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index if not exists payment_allocations_invoice_idx on public.payment_allocations (invoice_id);

create trigger set_org_from_location
  before insert on public.payments
  for each row execute function private.set_org_from_location();

-- RLS: financial pattern — branch members OR org finance (owner/admin/
-- accountant), matching invoices.
alter table public.invoice_jobs enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;

create policy "invoice_jobs_finance" on public.invoice_jobs
  for select to authenticated
  using (exists (
    select 1 from public.invoices i
    where i.id = invoice_id
      and (private.is_location_member(i.location_id) or private.is_org_finance(i.organization_id))
  ));

create policy "payments_finance" on public.payments
  for select to authenticated
  using (private.is_location_member(location_id) or private.is_org_finance(organization_id));

create policy "payment_allocations_finance" on public.payment_allocations
  for select to authenticated
  using (exists (
    select 1 from public.payments p
    where p.id = payment_id
      and (private.is_location_member(p.location_id) or private.is_org_finance(p.organization_id))
  ));
-- Writes go through server actions with the admin client (allocation must be
-- transactional-ish and audited) — no insert/update policies for staff.
