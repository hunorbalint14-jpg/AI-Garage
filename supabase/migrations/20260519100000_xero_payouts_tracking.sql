-- Track Stripe payouts pushed to Xero as bank transactions, keyed on the
-- Stripe payout id so the webhook is idempotent across retries. Each row
-- is one payout-to-bank-transaction mapping.

create table if not exists public.xero_payouts (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stripe_payout_id text not null,
  stripe_account_id text not null,
  xero_bank_transaction_id text,
  amount_pence integer not null,
  arrival_date date not null,
  pushed_at timestamptz not null default now(),
  unique (organization_id, stripe_payout_id)
);

create index if not exists xero_payouts_org_idx on public.xero_payouts (organization_id);
create index if not exists xero_payouts_stripe_idx on public.xero_payouts (stripe_payout_id);

alter table public.xero_payouts enable row level security;

-- Only service role reads/writes; staff don't need direct access (data
-- surfaces via UI through admin client in server actions).
create policy "xero_payouts_service_only" on public.xero_payouts
  for all using (false) with check (false);
